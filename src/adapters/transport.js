import { EventEmitter } from 'node:events';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
async function beforeTimeout(promise, ms) {
  let timer;
  try { return await Promise.race([promise.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), ms); })]); }
  finally { clearTimeout(timer); }
}
export class Transport extends EventEmitter {
  constructor(binary, args, cwd, env = process.env) {
    super();
    this.closed = false;
    this.child = spawn(binary, args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    this.completion = new Promise(resolve => {
      this.child.on('error', error => { this.emit('fault', error); });
      this.child.on('close', (code, signal) => { this.closed = true; const result = { code, signal }; this.emit('close', result); resolve(result); });
    });
    let buffer = '', dropping = false;
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        if (dropping || line.length > 2 * 1024 * 1024) { dropping = false; this.emit('gap', { reason: 'Oversized event skipped.' }); continue; }
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch (error) { this.emit('gap', { reason: `Invalid protocol event: ${error.message}` }); continue; }
        this.emit('message', message);
      }
      if (buffer.length > 2 * 1024 * 1024) { buffer = ''; dropping = true; }
    });
    this.child.stdout.on('end', () => { if (buffer.trim() || dropping) this.emit('gap', { reason: 'Stream ended with an incomplete event.' }); });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', text => this.emit('stderr', text));
    this.child.stdin.on('error', error => this.emit('fault', error));
  }
  send(message) {
    if (this.closed || this.child.stdin.destroyed) throw new Error('Agent transport is closed.');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  async stop() {
    this.stopping ??= this.stopOnce();
    return this.stopping;
  }
  async stopOnce() {
    if (this.closed) return;
    if (process.platform === 'win32') {
      if (this.child.pid) await exec('taskkill.exe', ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true }).catch(error => {
        if (!this.closed) throw new Error(`Could not stop agent process tree: ${error.message}`);
      });
    } else {
      try { process.kill(-this.child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      await beforeTimeout(this.completion, 1500);
      // Kill remaining members of the owned process group, even if the leader exited.
      try { process.kill(-this.child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    const closed = await beforeTimeout(this.completion, 5000);
    if (!closed) throw new Error('Agent process did not exit. Workspace remains locked.');
  }
}

export class Rpc {
  constructor(transport) {
    this.transport = transport; this.pending = new Map(); this.next = 1;
    transport.on('message', message => {
      if (message.method || message.id == null) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
    transport.on('close', () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Agent process exited.')); }
      this.pending.clear();
    });
  }
  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.next++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out.`)); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.transport.send({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
}

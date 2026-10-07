import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';

export const fixture = fileURLToPath(new URL('./fixtures/provider.js', import.meta.url));
export const cli = fileURLToPath(new URL('../bin/goddard.js', import.meta.url));
export function temp(t, beforeCleanup = () => {}) {
  const root = fs.realpathSync.native(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(root, 'goddard-test-'));
  t.after(() => {
    beforeCleanup();
    const resolved = fs.realpathSync.native(dir);
    if (path.dirname(resolved) !== root || !path.basename(resolved).startsWith('goddard-test-')) throw new Error('Unsafe test cleanup path.');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return dir;
}
export function setup(t) {
  let store;
  const dir = temp(t, () => store?.close());
  store = new Store(dir, { create: true });
  const task = store.createTask('Finish the pending implementation and verify it.');
  return { dir, store, task };
}
export function gitSync(dir, args) { return execFileSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true }); }
export function initGit(dir) {
  gitSync(dir, ['init', '-q']);
  gitSync(dir, ['config', 'user.email', 'test@goddard.local']);
  gitSync(dir, ['config', 'user.name', 'Goddard Test']);
  gitSync(dir, ['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(dir, '.gitignore'), '.goddard/\nnode_modules/\n');
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'original\n');
  gitSync(dir, ['add', '.']); gitSync(dir, ['commit', '-qm', 'baseline']);
}

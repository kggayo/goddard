import readline from 'node:readline';
import { PassThrough } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { terminalText } from './terminal.js';

const pasteStart = '\x1b[200~', pasteEnd = '\x1b[201~';
const enableInput = '\x1b[?2004h\x1b[>1u', disableInput = '\x1b[<u\x1b[?2004l';
const charDelay = 8, pasteDelay = 60, enterDelay = 120;
const extendedKeys = { 9: 'tab', 10: 'enter', 13: 'return', 27: 'escape', 127: 'backspace',
  57344: 'escape', 57345: 'return', 57346: 'tab', 57347: 'backspace', 57348: 'insert', 57349: 'delete',
  57350: 'left', 57351: 'right', 57352: 'up', 57353: 'down', 57354: 'pageup', 57355: 'pagedown', 57356: 'home', 57357: 'end' };

export function createInputReader(input, output) {
  return input.isTTY && output.isTTY && process.env.TERM !== 'dumb' ? new TerminalInput(input, output)
    : readline.createInterface({ input, output, terminal: false });
}

// Readline still owns editing, cursor movement and history. Raw input is decoded
// separately so pasted newlines never reach its submit-on-newline write path.
class TerminalInput extends readline.Interface {
  constructor(input, output) {
    super({ input: new PassThrough(), output, terminal: true });
    this.source = input;
    this.wasRaw = Boolean(input.isRaw);
    this.wasFlowing = input.readableFlowing === true;
    this.decoder = new StringDecoder('utf8');
    this.keys = new PassThrough();
    this.buffer = ''; this.burst = ''; this.generation = 0; this.enterUntil = 0;
    readline.emitKeypressEvents(this.keys, { escapeCodeTimeout: 30 });
    this.keys.on('keypress', (text, key) => this.key(text, key));
    this.onData = data => this.receive(typeof data === 'string' ? data : this.decoder.write(data));
    this.onEnd = () => this.close();
    this.onExit = () => this.restore();
    input.setRawMode?.(true);
    input.on('data', this.onData);
    input.once('end', this.onEnd);
    process.once('exit', this.onExit);
    this.once('close', () => this.restore());
    output.write(enableInput);
    input.resume();
  }
  restore() {
    if (this.restored) return;
    this.restored = true;
    clearTimeout(this.burstTimer); clearTimeout(this.escapeTimer); clearTimeout(this.returnTimer);
    this.source.off('data', this.onData); this.source.off('end', this.onEnd);
    process.off('exit', this.onExit);
    this.keys.removeAllListeners('keypress'); this.keys.destroy();
    this.source.setRawMode?.(this.wasRaw);
    if (!this.wasFlowing) this.source.pause();
    this.output.write(disableInput);
  }
  _addHistory() {
    // Readline versions may encode/reverse multiline entries for REPL history.
    // Keep their history bookkeeping, but submit the actual draft unchanged.
    const text = this.line;
    super._addHistory();
    return text;
  }
  reset() {
    this.generation++;
    clearTimeout(this.burstTimer);
    clearTimeout(this.escapeTimer);
    clearTimeout(this.returnTimer); this.returnTimer = null;
    if (!this.pasting) this.buffer = '';
    this.burst = ''; this.enterUntil = 0;
    if (this.closed) return;
    // Clear even a partially typed answer before another prompt can receive it.
    this.write(null, { ctrl: true, name: 'e' });
    this.write(null, { ctrl: true, name: 'u' });
  }
  insert(text) {
    if (this.closed || !text) return;
    // Node's legacy literal-insert hook preserves multiline cursor/history state.
    // Public write(text) would interpret pasted newlines as submitted answers.
    this._insertString(terminalText(text));
  }
  flush() {
    clearTimeout(this.burstTimer);
    const text = this.burst; this.burst = '';
    this.insert(text);
  }
  collect(text, pasted = false) {
    if (this.returnTimer) {
      clearTimeout(this.returnTimer); this.returnTimer = null;
      this.burst += '\n'; pasted = true;
    }
    const active = pasted || this.burst.length > 0 || performance.now() < this.enterUntil;
    this.burst += text;
    if (active) this.enterUntil = performance.now() + enterDelay;
    clearTimeout(this.burstTimer);
    this.burstTimer = setTimeout(() => this.flush(), active ? pasteDelay : charDelay);
  }
  newline() {
    if (this.returnTimer) this.collect('', true);
    this.flush(); this.enterUntil = 0;
    this.insert('\n');
  }
  key(text, key = {}) {
    if (this.closed) return;
    if (text === '\n' && performance.now() < this.skipLFUntil) { this.skipLFUntil = 0; return; }
    this.skipLFUntil = 0;
    if ((key.name === 'return' || key.name === 'enter') && (key.meta || key.shift)) { this.newline(); return; }
    // In raw terminals Ctrl+J is LF; the Enter key is CR.
    if (text === '\n' || (key.ctrl && key.name === 'j')) {
      if (this.burst) this.collect('\n'); else this.newline();
      return;
    }
    if (key.name === 'return') {
      this.skipLFUntil = performance.now() + enterDelay;
      if (this.returnTimer || this.burst || performance.now() < this.enterUntil) { this.collect('\n', true); return; }
      if (this.line.slice(0, this.cursor).endsWith('\\')) {
        this.write(null, { name: 'backspace' }); this.newline();
      } else {
        // Briefly hold Enter too: an unmarked paste can begin with blank lines.
        this.returnTimer = setTimeout(() => {
          this.returnTimer = null;
          if (!this.closed) this.write(null, { name: 'return' });
        }, pasteDelay);
      }
      return;
    }
    if (text && !key.ctrl && !key.meta && !text.includes('\x1b') && (text === '\t' || !/[\x00-\x1f\x7f]/.test(text))) {
      this.collect(text); return;
    }
    this.flush(); this.enterUntil = 0;
    clearTimeout(this.returnTimer); this.returnTimer = null;
    if (key.name === 'v' && (key.meta || key.ctrl)) { this.emit('pasteImage'); return; }
    if (['up', 'down'].includes(key.name) && !key.ctrl && !key.meta && this.line.includes('\n')) {
      const start = this.cursor === 0 ? 0 : this.line.lastIndexOf('\n', this.cursor - 1) + 1;
      const end = this.line.indexOf('\n', this.cursor);
      const column = this.cursor - start;
      if (key.name === 'up' && start > 0) {
        const previous = this.line.lastIndexOf('\n', start - 2) + 1;
        this.moveTo(Math.min(previous + column, start - 1)); return;
      }
      if (key.name === 'down' && end >= 0) {
        const next = this.line.indexOf('\n', end + 1);
        this.moveTo(Math.min(end + 1 + column, next < 0 ? this.line.length : next)); return;
      }
    }
    this.write(text, key);
  }
  moveTo(cursor) {
    // Never split a UTF-16 surrogate pair when moving between logical lines.
    if (cursor > 0 && /[\udc00-\udfff]/.test(this.line[cursor] ?? '') && /[\ud800-\udbff]/.test(this.line[cursor - 1])) cursor--;
    this.cursor = cursor; this.prompt(true);
  }
  extended(sequence) {
    const csi = /^\x1b\[(\d+)(?:;(\d+)(?::([123]))?)?u$/.exec(sequence);
    const xterm = /^\x1b\[27;(\d+);(\d+)~$/.exec(sequence);
    if (!csi && !xterm) return false;
    if (csi?.[3] === '3') return true; // Key release, not another keystroke.
    const code = Number(csi ? csi[1] : xterm[2]);
    const modifiers = Number((csi ? csi[2] : xterm[1]) ?? 1) - 1;
    if (code > 0x10ffff) return true;
    const char = extendedKeys[code] ? undefined : String.fromCodePoint(code);
    this.key(code === 10 ? '\n' : char, { name: extendedKeys[code] ?? char.toLowerCase(),
      ctrl: Boolean(modifiers & 4), meta: Boolean(modifiers & 2), shift: Boolean(modifiers & 1) });
    return true;
  }
  receive(text) {
    if (this.closed) return;
    clearTimeout(this.escapeTimer);
    this.buffer += text;
    while (this.buffer && !this.closed) {
      if (this.pasting) {
        const end = this.buffer.indexOf(pasteEnd);
        if (end < 0) return;
        if (this.pasteGeneration === this.generation) this.insert(this.buffer.slice(0, end));
        this.buffer = this.buffer.slice(end + pasteEnd.length);
        this.pasting = false;
        continue;
      }
      if (this.buffer.startsWith('\x1b')) {
        const match = /^\x1b(?:\[[0-?]*[ -/]*[@-~]|O.|[^\[O])/s.exec(this.buffer);
        if (!match) {
          this.escapeTimer = setTimeout(() => { this.buffer = ''; }, 100);
          return;
        }
        const sequence = match[0]; this.buffer = this.buffer.slice(sequence.length);
        if (sequence === pasteStart) {
          if (this.returnTimer) this.collect('', true);
          this.flush(); this.enterUntil = 0;
          this.pasting = true; this.pasteGeneration = this.generation;
        } else if (sequence !== pasteEnd) {
          // Decode extended keys ourselves: readline doesn't understand CSI-u.
          if (!this.extended(sequence)) this.keys.write(sequence);
        }
        continue;
      }
      const end = this.buffer.indexOf('\x1b');
      let plain = end < 0 ? this.buffer : this.buffer.slice(0, end);
      this.buffer = end < 0 ? '' : this.buffer.slice(end);
      if (plain.startsWith('\n') && performance.now() < this.skipLFUntil) { plain = plain.slice(1); this.skipLFUntil = 0; }
      // A whole multiline chunk is already a paste, including leading blank
      // lines. The timing fallback also catches Windows' one-key-at-a-time form.
      if (plain.length > 1 && plain !== '\r\n' && /[\r\n]/.test(plain) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(plain)) {
        this.skipLFUntil = plain.endsWith('\r') ? performance.now() + enterDelay : 0;
        this.collect(plain.replace(/\r\n?/g, '\n'), true);
      }
      else this.keys.write(plain);
    }
  }
}

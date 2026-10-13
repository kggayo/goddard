import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { createInputReader } from '../src/input.js';
import { Interaction } from '../src/interaction.js';
import { imageFromBytes } from '../src/images.js';

const begin = '\x1b[200~', end = '\x1b[201~';
function terminal(t, interaction = false) {
  const previousTerm = process.env.TERM;
  process.env.TERM = 'xterm-256color';
  t.after(() => { if (previousTerm === undefined) delete process.env.TERM; else process.env.TERM = previousTerm; });
  const input = new PassThrough(), output = new PassThrough();
  input.isTTY = output.isTTY = true; output.columns = 72;
  input.isRaw = false;
  const rawModes = [];
  input.setRawMode = value => { input.isRaw = value; rawModes.push(value); };
  let transcript = '';
  output.on('data', chunk => { transcript += chunk.toString(); });
  const ui = interaction ? new Interaction({ input, output }) : null;
  const reader = ui?.reader ?? createInputReader(input, output);
  const submitted = [];
  reader.on('line', line => submitted.push(line));
  t.after(() => { ui?.close(); reader.close(); input.destroy(); output.destroy(); });
  return { input, output, reader, ui, submitted, rawModes, transcript: () => transcript };
}
const draft = (input, text) => input.write(begin + text + end);
const submit = async input => { input.write('\r'); await delay(80); };

for (const [name, keys] of [['Alt+V', '\x1bv'], ['Ctrl+V', '\x16']]) {
  test(`${name} attaches an image while preserving the unsent draft and cursor`, async t => {
    const { input, reader, ui } = terminal(t, true);
    let reads = 0;
    ui.clipboard = async () => { reads++; return imageFromBytes(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')); };
    let sent = false;
    const answer = ui.request({ kind: 'followup' }).then(value => { sent = true; return value; });
    await delay(0);
    draft(input, 'Explain this\n  screenshot.'); input.write('\x1b[D');
    const cursor = reader.cursor;
    input.write(keys); await delay(20);
    assert.equal(reads, 1); assert.equal(sent, false);
    assert.equal(reader.line, 'Explain this\n  screenshot.'); assert.equal(reader.cursor, cursor);
    await submit(input);
    const result = await answer;
    assert.equal(result.text, 'Explain this\n  screenshot.'); assert.equal(result.images.length, 1);
    const approval = ui.request({ kind: 'approval', title: 'Permission' }); await delay(0);
    input.write(keys); await delay(20);
    assert.equal(reads, 1, 'an approval prompt must not read the clipboard');
    await submit(input); assert.equal(await approval, false);
  });
}

test('bracketed CRLF paste stays editable until a separate Enter submits the entire draft', async t => {
  const { input, reader, submitted, transcript } = terminal(t);
  reader.setPrompt('You: '); reader.prompt();
  draft(input, 'First line\r\n\r\n  second line\rthird line\n');
  assert.deepEqual(submitted, []);
  assert.equal(reader.line, 'First line\n\n  second line\nthird line\n');
  input.write('\x1b[D'); input.write('\x7f');
  assert.equal(reader.line, 'First line\n\n  second line\nthird lin\n');
  await submit(input);
  assert.deepEqual(submitted, ['First line\n\n  second line\nthird lin\n']);
  assert.match(transcript(), /First line/);
});

test('paste markers and UTF-8 text can be split across arbitrary stream chunks', async t => {
  const { input, reader, submitted } = terminal(t);
  const message = 'Hello 👋\r\n你好\n  café';
  for (const byte of Buffer.from(begin + message + end)) input.write(Buffer.from([byte]));
  assert.deepEqual(submitted, []);
  assert.equal(reader.line, 'Hello 👋\n你好\n  café');
  await submit(input);
  assert.deepEqual(submitted, ['Hello 👋\n你好\n  café']);
});

for (const [name, key] of [
  ['Ctrl+J', '\n'], ['Alt+Enter', '\x1b\r'], ['Shift+Enter (CSI-u)', '\x1b[13;2u'],
  ['Shift+Enter (xterm)', '\x1b[27;2;13~'], ['Shift+Enter (kitty press)', '\x1b[13;2:1u'],
  ['backslash then Enter', '\\\r']
]) {
  test(`${name} inserts a newline without sending`, async t => {
    const { input, reader, submitted } = terminal(t);
    draft(input, 'First');
    if (name === 'backslash then Enter') { input.write('\\'); await delay(20); input.write('\r'); }
    else input.write(key);
    assert.deepEqual(submitted, []);
    assert.equal(reader.line, 'First\n');
    draft(input, 'Second'); await submit(input);
    assert.deepEqual(submitted, ['First\nSecond']);
  });
}

test('modified Enter sequences work when split, and kitty key release does not add a newline', t => {
  const { input, reader } = terminal(t);
  draft(input, 'First');
  for (const char of '\x1b[13;2u') input.write(char);
  input.write('\x1b[13;2:3u');
  assert.equal(reader.line, 'First\n');
});

test('extended keyboard mode preserves plain Enter, Ctrl+J, Ctrl+C, and editing keys', async t => {
  const { input, reader, submitted } = terminal(t);
  let interrupts = 0; reader.on('SIGINT', () => interrupts++);
  draft(input, 'first'); input.write('\x1b[106;5u');
  draft(input, 'second!'); input.write('\x1b[127u');
  input.write('\x1b[13u'); await delay(80);
  assert.deepEqual(submitted, ['first\nsecond']);
  input.write('\x1b[99;5u'); input.write('\x1b[99;5:3u');
  assert.equal(interrupts, 1);
});

test('multiline cursor editing and history preserve line order and content', async t => {
  const { input, reader, submitted } = terminal(t);
  draft(input, 'first\nsecond');
  input.write('\x1b[A');
  assert.equal(reader.cursor, 5);
  input.write('\x7f');
  input.write('\x1b[B'); await submit(input);
  assert.deepEqual(submitted, ['firs\nsecond']);
  input.write('\x1b[A'); await submit(input);
  assert.deepEqual(submitted, ['firs\nsecond', 'firs\nsecond']);
});

test('Enter submits normally after typing, and Ctrl+J starts a blank multiline draft', async t => {
  const { input, reader, submitted } = terminal(t);
  input.write('a'); await delay(20); input.write('\r');
  input.write('\n'); // Paired CRLF is still one Enter.
  await delay(80);
  assert.deepEqual(submitted, ['a']);
  assert.equal(reader.line, '');
  input.write('\n');
  assert.equal(reader.line, '\n');
  await submit(input);
  assert.deepEqual(submitted, ['a', '\n']);
});

for (const chunked of [false, true]) {
  test(`unbracketed Windows paste ${chunked ? 'in rapid individual keys' : 'in one chunk'} never submits its newlines`, async t => {
    const { input, reader, submitted } = terminal(t);
    const text = 'one\r\n\r\n  two\rthree\n';
    if (chunked) for (const char of text) { input.write(char); await delay(1); }
    else input.write(text);
    await delay(150);
    assert.deepEqual(submitted, []);
    assert.equal(reader.line, 'one\n\n  two\nthree\n');
    await submit(input);
    assert.deepEqual(submitted, ['one\n\n  two\nthree\n']);
  });
}

test('unbracketed paste keeps leading empty lines and does not exit a blank prompt', async t => {
  const { input, reader, submitted } = terminal(t);
  input.write('\r\n\r\nkeep this\r\n');
  await delay(150);
  assert.deepEqual(submitted, []);
  assert.equal(reader.line, '\n\nkeep this\n');
});

test('a Windows paste arriving as individual keys can start with blank lines', async t => {
  const { input, reader, submitted } = terminal(t);
  for (const char of '\r\n\r\nanswer\r\n') { input.write(char); await delay(1); }
  await delay(150);
  assert.deepEqual(submitted, []);
  assert.equal(reader.line, '\n\nanswer\n');
  await submit(input);
  assert.deepEqual(submitted, ['\n\nanswer\n']);
});

test('extended Enter within an unmarked paste stays part of the draft', async t => {
  const { input, reader, submitted } = terminal(t);
  input.write('first\x1b[13u'); input.write('second');
  await delay(150);
  assert.deepEqual(submitted, []);
  assert.equal(reader.line, 'first\nsecond');
  await submit(input);
  assert.deepEqual(submitted, ['first\nsecond']);
});

test('pasted control characters are text, never interrupts or terminal commands', t => {
  const { input, reader, submitted, transcript } = terminal(t);
  let interrupted = false;
  reader.on('SIGINT', () => { interrupted = true; });
  draft(input, 'one\x03\x04\x1b[2J\ntwo');
  assert.equal(interrupted, false);
  assert.equal(reader.closed, undefined);
  assert.equal(reader.line, 'one\ntwo');
  assert.deepEqual(submitted, []);
  assert.ok(!transcript().includes('\x1b[2J'));
});

test('a large bracketed paste stays intact', async t => {
  const { input, reader, submitted } = terminal(t);
  const text = '  long input 👋\n'.repeat(2000);
  draft(input, text);
  assert.equal(reader.line, text);
  assert.deepEqual(submitted, []);
  await submit(input);
  assert.deepEqual(submitted, [text]);
});

test('EOF cancels an unsubmitted draft and restores raw mode and paste settings', async t => {
  const { input, ui, rawModes, transcript } = terminal(t, true);
  const answer = ui.request({ kind: 'followup' });
  await delay(0);
  draft(input, 'do not send'); input.end();
  assert.equal(await answer, null);
  assert.deepEqual(rawModes, [true, false]);
  assert.equal(input.isPaused(), true);
  assert.ok(transcript().includes('\x1b[?2004h'));
  assert.ok(transcript().includes('\x1b[?2004l'));
});

test('Ctrl+C still interrupts; closing twice restores the original raw state once', t => {
  const { input, reader, rawModes } = terminal(t);
  let interrupts = 0;
  reader.on('SIGINT', () => interrupts++);
  input.write('\x03');
  assert.equal(interrupts, 1);
  reader.close(); reader.close();
  assert.deepEqual(rawModes, [true, false]);
});

test('canceled drafts and an in-progress paste never become an answer to the next approval', async t => {
  const { input, ui, reader } = terminal(t, true);
  const abort = new AbortController();
  const first = ui.request({ kind: 'followup', signal: abort.signal });
  await delay(0);
  input.write(begin + 'yes\n'); abort.abort();
  assert.equal(await first, null);
  const approval = ui.request({ kind: 'approval', title: 'A different request' });
  await delay(0);
  input.write('more text' + end);
  assert.equal(reader.line, '');
  input.write('\r');
  assert.equal(await approval, false);
});

test('a paste cannot approve a request with its first line or answer the next question', async t => {
  const { input, ui } = terminal(t, true);
  const approval = ui.request({ kind: 'approval', title: 'Permission' });
  let settled = false; approval.then(() => { settled = true; });
  await delay(0);
  draft(input, 'yes\nmore context\n');
  await delay(0);
  assert.equal(settled, false);
  input.write('\r');
  assert.equal(await approval, false);
  const next = ui.request({ kind: 'question', questions: [{ id: 'q', question: 'Answer me' }] });
  await delay(0);
  draft(input, 'first\n  second'); input.write('\r');
  assert.deepEqual(await next, { q: ['first\n  second'] });
});

test('nonterminal streams retain their line-oriented behavior without terminal controls', async t => {
  const input = new PassThrough(), output = new PassThrough();
  let written = ''; output.on('data', data => { written += data; });
  const reader = createInputReader(input, output); t.after(() => reader.close());
  const lines = []; reader.on('line', line => lines.push(line));
  input.write('one\ntwo\n');
  assert.deepEqual(lines, ['one', 'two']);
  assert.equal(written, '');
});

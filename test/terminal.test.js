import test from 'node:test';
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import { PassThrough } from 'node:stream';
import stringWidth from 'string-width';
import { TerminalRenderer, TerminalDisplay, terminalText } from '../src/terminal.js';
import { Interaction } from '../src/interaction.js';

const rich = (options = {}) => new TerminalRenderer({ output: { isTTY: true, columns: 72 }, env: {}, ...options });
const plain = stripVTControlCharacters;

test('Markdown formats nested emphasis, links, tasks, lists, and quotes while retaining their content', () => {
  const output = rich().markdown('# Result\n\n**Bold with *emphasis*** and `value`\n\n- [x] Done\n  - Child\n- [ ] Next\n\n> Quoted\n\n[Docs](https://example.com/reference)');
  assert.match(output, /\x1b\[1;36mResult/);
  assert.match(output, /\x1b\[1m/); assert.match(output, /\x1b\[3m/);
  const text = plain(output);
  assert.ok(!text.includes('**')); assert.ok(!text.includes('`value`'));
  for (const value of ['Bold with emphasis', 'value', '[x] Done', 'Child', '[ ] Next', 'Quoted', 'Docs (https://example.com/reference)']) assert.ok(text.includes(value), value);
});

test('syntax highlighting preserves literal code, including HTML, entities, and indentation', () => {
  const code = 'const html = "<span>&lt; &#27;</span>";\n  console.log(html); // unchanged';
  const result = rich().highlight(code, 'javascript');
  assert.match(result, /\x1b\[35mconst/);
  assert.match(result, /\x1b\[32m/);
  assert.equal(plain(result), code);
  assert.equal(rich().highlight(code, 'not-a-language'), code);
  assert.equal(plain(rich().markdown('```javascript\n' + code + '\n```')).split('\n').slice(1, -1).map(line => line.slice(2)).join('\n'), code);
});

test('diffs use red removals and green additions without dropping signs or context', () => {
  const diff = '--- a/file.js\n+++ b/file.js\n@@ -1 +1 @@\n-old();\n+newCall();\n unchanged';
  const output = rich().highlight(diff, 'diff');
  assert.match(output, /\x1b\[31m-old\(\);/);
  assert.match(output, /\x1b\[32m\+newCall\(\);/);
  assert.equal(plain(output), diff);
});

test('tables and prose fit narrow terminals without losing Unicode or cell contents', () => {
  const renderer = rich({ output: { isTTY: true, columns: 24 } });
  const output = plain(renderer.markdown('A paragraph with **bold words** and a longer explanation.\n\n| Name | Status |\n| --- | --- |\n| 日本語 | Complete |\n| Café 🙂 | Pending |'));
  assert.ok(output.split('\n').every(line => stringWidth(line) <= 24));
  for (const value of ['日本語', 'Café 🙂', 'Complete', 'Pending']) assert.ok(output.includes(value));
  const stacked = plain(rich({ output: { isTTY: true, columns: 20 } }).markdown('| First | Second | Third |\n|---|---|---|\n| One | Two | Three |'));
  assert.match(stacked, /First: One/); assert.match(stacked, /Third: Three/);
});

test('plain mode, pipes, dumb terminals, and no-color settings produce no ANSI controls', () => {
  const source = '**Bold**\n\n```js\nconst n = 1;\n```';
  for (const renderer of [rich({ plain: true }), rich({ output: { isTTY: false } }), rich({ env: { TERM: 'dumb' } })]) {
    assert.equal(renderer.markdown(source), source);
    assert.equal(renderer.label('Codex', 'codex'), 'Codex >');
  }
  for (const renderer of [rich({ noColor: true }), rich({ env: { NO_COLOR: '1' } })]) {
    const output = renderer.markdown(source);
    assert.ok(!output.includes('\x1b')); assert.ok(!output.includes('**'));
    assert.ok(output.includes('const n = 1;'));
  }
});

test('provider terminal controls and encoded escapes cannot become terminal commands', () => {
  const hostile = '\x1b[2J\x1b]52;c;Y2xpcGJvYXJk\x07**Visible** &lt;tag&gt; &#x1b;[2J &#x9b;2J\n[link](https://example.com/\x1b]8;;bad\x07)';
  const output = rich().markdown(hostile);
  // Only renderer-generated SGR (styling) sequences may reach the terminal.
  assert.ok(!output.replace(/\x1b\[[\d;]*m/g, '').includes('\x1b'));
  assert.ok(!output.includes('\x9b')); assert.ok(!output.includes('52;c;'));
  assert.match(plain(output), /Visible/);
  assert.equal(terminalText('first\rsecond\x08\x07'), 'first\nsecond');
});

test('approval details remain literal JSON, regardless of Markdown embedded in commands', () => {
  const request = { command: 'echo "**approve**" && test -n "<tag>"', reason: 'Do not hide arguments' };
  const output = plain(rich().detail(request)).split('\n').slice(1, -1).map(line => line.slice(2)).join('\n');
  assert.deepEqual(JSON.parse(output), request);
});

test('status output waits until an active prompt is answered and queued requests still work', async t => {
  const input = new PassThrough(), output = new PassThrough(); let printed = '';
  output.on('data', chunk => { printed += chunk.toString(); });
  const display = new TerminalDisplay({ output });
  const ui = new Interaction({ input, output, display }); t.after(() => ui.close());
  const answer = ui.request({ kind: 'approval', title: 'Run tests?' });
  await new Promise(resolve => setImmediate(resolve));
  display.status('Checkpoint saved.'); display.agent('claude', '**Still working.**');
  assert.ok(!printed.includes('Checkpoint saved.'));
  input.write('yes\n'); assert.equal(await answer, true);
  assert.match(printed, /Goddard > Checkpoint saved/); assert.match(printed, /Claude >/);
  const next = ui.request({ kind: 'followup' }); await new Promise(resolve => setImmediate(resolve));
  input.end(); assert.equal(await next, null);
});

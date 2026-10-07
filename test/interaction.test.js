import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { setup } from './helpers.js';
import { Interaction } from '../src/interaction.js';
import { supervise } from '../src/supervisor.js';
import { CodexAdapter } from '../src/adapters/codex.js';
import { ClaudeAdapter, claudeArgs, claudeEnv } from '../src/adapters/claude.js';
import { TerminalDisplay } from '../src/terminal.js';
import { exportBundle } from '../src/handoff.js';

const fixture = fileURLToPath(new URL('./fixtures/interactive-provider.js', import.meta.url));
const lines = file => fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
function terminal(t, responses, rich = false) {
  const input = new PassThrough(), output = new PassThrough(); let transcript = '';
  output.isTTY = rich; output.columns = 72;
  const display = new TerminalDisplay({ output, env: {} });
  const ui = new Interaction({ input, output, display }); t.after(() => ui.close());
  output.on('data', chunk => {
    const text = chunk.toString(); transcript += text;
    if (/Answer \(|Allow this request|You \(/.test(text)) setImmediate(() => {
      const value = responses.shift();
      if (value === undefined) input.end(); else input.write(value + '\n');
    });
  });
  return { ui, input, transcript: () => transcript };
}
for (const [provider, Provider] of [['codex', CodexAdapter], ['claude', ClaudeAdapter]]) {
  test(`${provider} relays questions, one-request approvals, and follow-ups through the real stream adapter`, async t => {
    const { dir, store, task } = setup(t);
    const { ui, transcript } = terminal(t, ['2', 'yes', 'Use the accessible variant.', '/done'], true);
    const source = new Provider({ workspace: dir, binary: process.execPath, args: [fixture, provider, 'interactive'], interactive: true, model: 'test-model', effort: 'high' });
    const result = await supervise(store, task.id, { provider, adapter: source, interaction: ui, log: () => {} });
    assert.equal(result.status, 'finished');
    const answers = lines(path.join(dir, 'answers.jsonl'));
    assert.equal(answers.length, 2);
    if (provider === 'codex') {
      assert.deepEqual(answers[0].value, { answers: { color: { answers: ['Red'] } } });
      assert.equal(answers[1].value.decision, 'accept');
      const turns = lines(path.join(dir, 'prompts.jsonl')); assert.equal(turns.length, 2);
      assert.ok(turns.every(turn => turn.effort === 'high'));
      const thread = JSON.parse(fs.readFileSync(path.join(dir, 'thread.json')));
      assert.equal(thread.model, 'test-model'); assert.equal(thread.approvalPolicy, 'on-request'); assert.equal(thread.sandbox, 'workspace-write');
    } else {
      assert.equal(answers[0].value.updatedInput.answers['Which color?'], 'Red');
      assert.deepEqual(answers[1].value, { behavior: 'allow', updatedInput: { command: 'npm test' } });
      assert.equal(lines(path.join(dir, 'prompts.jsonl')).length, 2);
    }
    assert.match(transcript(), /npm test/);
    assert.ok(transcript().includes('\x1b['));
    assert.match(stripVTControlCharacters(transcript()), /Saved the checkpoint/);
    assert.ok(!stripVTControlCharacters(transcript()).includes('**Saved**'));
    const message = store.events(task.id).find(event => event.type === 'agent.message').payload.text;
    assert.match(message, /\*\*Saved\*\*/); assert.ok(message.includes('```js'));
    assert.ok(!message.includes('\x1b'));
    assert.ok(!fs.readFileSync(result.handoff, 'utf8').includes('\x1b'));
    const bundleFile = path.join(dir, '.goddard', 'display-test-export.json');
    await exportBundle(store, task.id, bundleFile);
    const exported = JSON.parse(fs.readFileSync(bundleFile, 'utf8'));
    assert.equal(exported.events.find(event => event.type === 'agent.message').payload.text, message);
    assert.ok(store.notes(task.id).some(note => note.text.includes('User answer: Red')));
    assert.ok(store.notes(task.id).some(note => note.text.includes('accessible variant')));
    assert.equal(store.activeRuns().length, 0);
  });
  test(`${provider} declines requests without an interactive terminal`, async t => {
    const { dir, store, task } = setup(t);
    const source = new Provider({ workspace: dir, binary: process.execPath, args: [fixture, provider, 'interactive'] });
    const result = await supervise(store, task.id, { provider, adapter: source, log: () => {} });
    assert.equal(result.status, 'finished');
    const answers = lines(path.join(dir, 'answers.jsonl'));
    assert.equal(provider === 'codex' ? answers[1].value.decision : answers[1].value.behavior, provider === 'codex' ? 'decline' : 'deny');
  });
  test(`${provider} cancels an unanswered prompt when the provider withdraws it`, async t => {
    const { dir, store, task } = setup(t);
    const input = new PassThrough(), output = new PassThrough();
    const ui = new Interaction({ input, output }); t.after(() => ui.close());
    output.on('data', text => { if (text.toString().includes('You (')) setImmediate(() => input.write('/done\n')); });
    const source = new Provider({ workspace: dir, binary: process.execPath, args: [fixture, provider, 'cancel'], interactive: true });
    const result = await supervise(store, task.id, { provider, adapter: source, interaction: ui, log: () => {} });
    assert.equal(result.status, 'finished');
    assert.ok(!fs.existsSync(path.join(dir, 'answers.jsonl')));
  });
}

test('terminal defaults to deny, supports multiple selections, and settles on EOF', async t => {
  const { ui } = terminal(t, ['', '1, 2']);
  assert.equal(await ui.request({ kind: 'approval', title: 'Permission' }), false);
  assert.deepEqual(await ui.request({ kind: 'question', questions: [{ id: 'q', question: 'Choose', multiSelect: true, options: [{ label: 'One' }, { label: 'Two' }] }] }), { q: ['One', 'Two'] });
  assert.equal(await ui.request({ kind: 'approval', title: 'EOF' }), false);
  assert.equal(await ui.request({ kind: 'followup' }), null);
});

test('Claude arguments retain model, effort, and permission settings without changing the parent environment', () => {
  const opts = { model: 'model with spaces', effort: 'high', readOnly: true };
  const claude = claudeArgs(opts);
  assert.equal(claude[claude.indexOf('--model') + 1], 'model with spaces');
  assert.equal(claude[claude.indexOf('--effort') + 1], 'high');
  assert.equal(claude[claude.indexOf('--permission-mode') + 1], 'plan');
  assert.equal(claude[claude.indexOf('--permission-prompt-tool') + 1], 'stdio');
  const previousEffort = process.env.CLAUDE_CODE_EFFORT_LEVEL;
  try {
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'low';
    assert.equal(claudeEnv('high').CLAUDE_CODE_EFFORT_LEVEL, undefined);
    assert.equal(process.env.CLAUDE_CODE_EFFORT_LEVEL, 'low');
    assert.equal(claudeEnv().CLAUDE_CODE_EFFORT_LEVEL, 'low');
  } finally {
    if (previousEffort === undefined) delete process.env.CLAUDE_CODE_EFFORT_LEVEL;
    else process.env.CLAUDE_CODE_EFFORT_LEVEL = previousEffort;
  }
});

test('a run time limit dismisses a pending question and releases the workspace', async t => {
  const { dir, store, task } = setup(t);
  const ui = new Interaction({ input: new PassThrough(), output: new PassThrough() }); t.after(() => ui.close());
  const source = new CodexAdapter({ workspace: dir, binary: process.execPath, args: [fixture, 'codex', 'interactive'], interactive: true });
  const result = await supervise(store, task.id, { adapter: source, interaction: ui, maxSeconds: 0.2, graceSeconds: 0.05, log: () => {} });
  assert.equal(result.status, 'interrupted');
  assert.equal(ui.closed, true);
  assert.equal(store.activeRuns().length, 0);
  assert.ok(fs.existsSync(result.handoff));
});

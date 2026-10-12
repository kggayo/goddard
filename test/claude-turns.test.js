import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeAdapter } from '../src/adapters/claude.js';

function harness() {
  const adapter = new ClaudeAdapter({ workspace: process.cwd() });
  const sent = [], done = [];
  adapter.transport = { send: value => sent.push(value) };
  adapter.on('done', result => done.push(result));
  const result = ids => adapter.onMessage({ type: 'result', is_error: false, user_message_uuid: ids?.at(-1), user_message_uuids: ids });
  return { adapter, sent, done, result };
}

test('Claude retires all prompts answered by a merged turn', () => {
  const { adapter, sent, done, result } = harness();
  for (const text of ['task', 'checkpoint 1', 'checkpoint 2']) adapter.sendPrompt(text);
  assert.equal(new Set(sent.map(m => m.uuid)).size, 3);
  result(sent.map(m => m.uuid));
  assert.deepEqual(done, [{ status: 'finished' }]);
});

test('separate results wait for queued prompts and stale results cannot complete a new turn', () => {
  const { adapter, sent, done, result } = harness();
  adapter.sendPrompt('task'); adapter.sendPrompt('checkpoint');
  result([sent[0].uuid]); assert.equal(done.length, 0);
  result([sent[1].uuid]); assert.equal(done.length, 1);
  adapter.sendPrompt('follow-up');
  result([sent[1].uuid]); assert.equal(done.length, 1);
  result([sent[2].uuid]); assert.equal(done.length, 2);
});

test('unrelated background results do not release user input early', () => {
  const { adapter, sent, done, result } = harness();
  adapter.sendPrompt('task');
  adapter.onMessage({ type: 'result', origin: { kind: 'task-notification' }, is_error: false });
  result(['not-our-message']);
  adapter.onMessage({ type: 'assistant', user_message_uuid: sent[0].uuid, message: { content: [] } });
  result();
  assert.equal(done.length, 0);
  result([sent[0].uuid]); assert.equal(done.length, 1);
});

test('legacy untagged results and singular message attribution remain supported', () => {
  const { adapter, sent, done, result } = harness();
  adapter.sendPrompt('task'); adapter.sendPrompt('checkpoint');
  result(); assert.equal(done.length, 0);
  result(); assert.equal(done.length, 1);
  adapter.sendPrompt('follow-up');
  adapter.onMessage({ type: 'result', is_error: false, user_message_uuid: sent[2].uuid });
  assert.equal(done.length, 2);
});

test('unattributed provider errors still stop the run', () => {
  const { adapter, done } = harness();
  adapter.sendPrompt('task');
  adapter.onMessage({ type: 'result', is_error: true, result: 'Startup failed' });
  assert.deepEqual(done, [{ status: 'failed', reason: 'Startup failed' }]);
});

test('a failed send does not leave a phantom pending message', () => {
  const { adapter, sent, done, result } = harness();
  const send = adapter.transport.send;
  adapter.transport.send = () => { throw new Error('Pipe closed'); };
  assert.throws(() => adapter.sendPrompt('unsent'), /Pipe closed/);
  adapter.transport.send = send;
  adapter.sendPrompt('sent'); result([sent[0].uuid]);
  assert.equal(done.length, 1);
});

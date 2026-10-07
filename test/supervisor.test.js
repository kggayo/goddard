import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, fixture } from './helpers.js';
import { checkpointFile } from '../src/checkpoint.js';
import { supervise } from '../src/supervisor.js';
import { CodexAdapter } from '../src/adapters/codex.js';
import { ClaudeAdapter } from '../src/adapters/claude.js';

function adapter(Provider, provider, scenario, dir, store, task) {
  return new Provider({ workspace: dir, binary: process.execPath, args: [fixture, provider, scenario, checkpointFile(store, task.id)] });
}

test('abrupt Codex loss hands valid context, uncertain work and file changes to Claude', async t => {
  const { dir, store, task } = setup(t);
  const source = adapter(CodexAdapter, 'codex', 'abrupt', dir, store, task);
  const result = await supervise(store, task.id, { provider: 'codex', adapter: source, log: () => {}, snapshotSeconds: 1 });
  assert.equal(result.status, 'interrupted');
  assert.equal(store.latestCheckpoint(task.id).data.nextSteps[0], 'Finish the pending implementation in restored.txt.');
  const handoff = fs.readFileSync(result.handoff, 'utf8');
  assert.match(handoff, /external action with unknown result/);
  assert.ok(!handoff.includes('MUST_NOT_BE_STORED'));
  assert.equal(store.activeRuns().length, 0);
  const destination = adapter(ClaudeAdapter, 'claude', 'destination', dir, store, task);
  const resumed = await supervise(store, task.id, { provider: 'claude', adapter: destination, log: () => {} });
  assert.equal(resumed.status, 'finished');
  assert.equal(store.latestCheckpoint(task.id).data.status, 'complete');
  assert.equal(fs.readFileSync(path.join(dir, 'restored.txt'), 'utf8'), 'completed from handoff\n');
});

test('preflight high quota stops before starting an inference turn', async t => {
  const { dir, store, task } = setup(t);
  const source = adapter(CodexAdapter, 'codex', 'high-usage', dir, store, task);
  const result = await supervise(store, task.id, { adapter: source, log: () => {} });
  assert.equal(result.status, 'limited');
  assert.equal(store.runs(task.id)[0].session, null);
  assert.ok(!fs.existsSync(path.join(dir, 'partial.txt')));
});

test('duration stop steers the agent to save and releases the workspace', async t => {
  const { dir, store, task } = setup(t);
  const source = adapter(CodexAdapter, 'codex', 'hang', dir, store, task);
  const result = await supervise(store, task.id, { adapter: source, maxSeconds: 0.1, graceSeconds: 1, log: () => {} });
  assert.equal(result.status, 'interrupted');
  assert.ok(store.events(task.id).some(event => event.type === 'checkpoint.requested'));
  assert.equal(store.activeRuns().length, 0);
});

test('Claude quota rejection without utilization preserves the handoff', async t => {
  const { dir, store, task } = setup(t);
  const source = adapter(ClaudeAdapter, 'claude', 'rejected', dir, store, task);
  const result = await supervise(store, task.id, { provider: 'claude', adapter: source, log: () => {} });
  assert.equal(result.status, 'limited');
  assert.ok(fs.existsSync(result.handoff));
  assert.equal(store.activeRuns().length, 0);
});

test('launch failures are recorded and do not permanently lock the workspace', async t => {
  const { dir, store, task } = setup(t);
  const source = new CodexAdapter({ workspace: dir, binary: path.join(dir, 'does-not-exist.exe') });
  const result = await supervise(store, task.id, { adapter: source, log: () => {} });
  assert.equal(result.status, 'failed');
  assert.equal(store.activeRuns().length, 0);
});

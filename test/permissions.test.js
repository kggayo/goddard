import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolvePermissions } from '../src/permissions.js';
import { CodexAdapter } from '../src/adapters/codex.js';
import { ClaudeAdapter, claudeArgs } from '../src/adapters/claude.js';
import { supervise } from '../src/supervisor.js';
import { setup, cli } from './helpers.js';

const fixture = fileURLToPath(new URL('./fixtures/interactive-provider.js', import.meta.url));
const mode = options => { const args = claudeArgs(options); return args[args.indexOf('--permission-mode') + 1]; };

test('Claude bypass is explicit and normal edit, auto, and planning modes are preserved', () => {
  assert.equal(mode({}), 'acceptEdits');
  assert.equal(mode({ claudePermissionMode: 'auto' }), 'auto');
  assert.equal(mode({ readOnly: true }), 'plan');
  assert.equal(mode({ bypassPermissions: true }), 'bypassPermissions');
  assert.equal(mode({ claudePermissionMode: 'bypassPermissions' }), 'bypassPermissions');
  assert.equal(mode({ bypassPermissions: true, claudePermissionMode: 'bypassPermissions' }), 'bypassPermissions');
  assert.throws(() => mode({ bypassPermissions: true, claudePermissionMode: 'auto' }), /conflicts/);
  assert.throws(() => mode({ bypassPermissions: true, readOnly: true }), /read-only/);
  assert.throws(() => new CodexAdapter({ readOnly: true, bypassPermissions: true }), /read-only/);
  assert.throws(() => new ClaudeAdapter({ readOnly: true, claudePermissionMode: 'bypassPermissions' }), /read-only/);
  assert.equal(resolvePermissions({ provider: 'codex' }).bypassPermissions, false);
});

for (const [name, flags, expected] of [
  ['read-only plus bypass', ['--read-only', '--dangerously-skip-permissions'], /read-only/],
  ['read-only plus Claude bypass alias', ['--agent', 'claude', '--read-only', '--claude-permission-mode', 'bypassPermissions'], /read-only/],
  ['bypass plus Claude auto', ['--agent', 'claude', '--dangerously-skip-permissions', '--claude-permission-mode', 'auto'], /conflicts/],
  ['bypass plus explicit acceptEdits', ['--agent', 'claude', '--dangerously-skip-permissions', '--claude-permission-mode', 'acceptEdits'], /conflicts/],
  ['Claude mode used for Codex', ['--agent', 'codex', '--claude-permission-mode', 'bypassPermissions'], /requires --agent claude/]
]) {
  test(`CLI refuses ${name} before starting a provider`, t => {
    const { dir, store, task } = setup(t);
    const result = spawnSync(process.execPath, [cli, 'run', task.id, '--workspace', dir, ...flags], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
    assert.equal(store.runs(task.id).length, 0);
  });
}

for (const [name, options, approvalPolicy, sandbox] of [
  ['interactive defaults', { interactive: true }, 'on-request', 'workspace-write'],
  ['noninteractive defaults', {}, 'never', 'workspace-write'],
  ['read-only', { interactive: true, readOnly: true }, 'never', 'read-only'],
  ['explicit bypass', { interactive: true, bypassPermissions: true }, 'never', 'danger-full-access']
]) {
  test(`Codex ${name} sends the intended permissions to App Server`, async t => {
    const { dir } = setup(t);
    const adapter = new CodexAdapter({ workspace: dir, binary: process.execPath, args: [fixture, 'codex', 'interactive'], ...options });
    try {
      await adapter.connect();
      await adapter.startTask('Check configuration only.');
      const thread = JSON.parse(fs.readFileSync(path.join(dir, 'thread.json'), 'utf8'));
      assert.equal(thread.approvalPolicy, approvalPolicy);
      assert.equal(thread.sandbox, sandbox);
    } finally { await adapter.close(); }
  });
}

for (const [provider, Provider] of [['codex', CodexAdapter], ['claude', ClaudeAdapter]]) {
  test(`${provider} bypass keeps questions and unexpected approvals under user control`, async t => {
    const { dir, store, task } = setup(t);
    let transcript = '';
    const adapter = new Provider({ workspace: dir, bypassPermissions: true, binary: process.execPath, args: [fixture, provider, 'interactive'] });
    const result = await supervise(store, task.id, { provider, bypassPermissions: true, adapter, log: text => { transcript += text; } });
    assert.equal(result.status, 'finished');
    const answers = fs.readFileSync(path.join(dir, 'answers.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(answers[0].value, provider === 'codex' ? { answers: {} } : { behavior: 'deny', message: 'Permission or input was not granted in Goddard.' });
    assert.equal(provider === 'codex' ? answers[1].value.decision : answers[1].value.behavior, provider === 'codex' ? 'decline' : 'deny');
    assert.match(transcript, /Permission bypass enabled/);
    assert.equal(store.events(task.id).find(event => event.type === 'run.started').payload.permissions.bypassPermissions, true);
    assert.ok(fs.existsSync(result.handoff));
  });
}

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

test('shared modes normalize identically for both providers and survive repeated normalization', () => {
  for (const permissionMode of ['default', 'auto', 'read-only', 'bypass']) {
    const expected = { permissionMode, readOnly: permissionMode === 'read-only', bypassPermissions: permissionMode === 'bypass' };
    for (const provider of ['codex', 'claude']) {
      const permissions = resolvePermissions({ provider, permissionMode });
      assert.deepEqual(permissions, expected);
      assert.deepEqual(resolvePermissions({ provider, ...permissions }), expected);
    }
  }
});

test('Claude maps Goddard modes to native arguments and retains narrow tool rules', () => {
  for (const [permissionMode, nativeMode] of [['default', 'acceptEdits'], ['auto', 'auto'], ['read-only', 'plan'], ['bypass', 'bypassPermissions']]) {
    const adapter = new ClaudeAdapter({ permissionMode });
    assert.equal(mode(adapter), nativeMode);
    assert.equal(adapter.readOnly, permissionMode === 'read-only');
    assert.equal(adapter.bypassPermissions, permissionMode === 'bypass');
    assert.equal(adapter.claudePermissionMode, undefined);
  }
  const args = claudeArgs({ permissionMode: 'default', allowedTools: ['Bash(npm test)', 'Read'] });
  assert.deepEqual(args.slice(-4), ['--allowedTools', 'Bash(npm test)', '--allowedTools', 'Read']);
});

test('equivalent compatibility aliases are accepted without changing the shared mode', () => {
  for (const provider of ['codex', 'claude']) {
    assert.equal(resolvePermissions({ provider, permissionMode: 'read-only', readOnly: true }).permissionMode, 'read-only');
    assert.equal(resolvePermissions({ provider, permissionMode: 'bypass', bypassPermissions: true }).permissionMode, 'bypass');
  }
  for (const [permissionMode, claudePermissionMode] of [['default', 'acceptEdits'], ['auto', 'auto'], ['bypass', 'bypassPermissions']]) {
    assert.equal(resolvePermissions({ provider: 'claude', permissionMode, claudePermissionMode }).permissionMode, permissionMode);
  }
});

for (const [name, flags, expected] of [
  ['unknown shared mode', ['--permission-mode', 'unknown'], /--permission-mode must be/],
  ['native mode in shared option', ['--agent', 'claude', '--permission-mode', 'acceptEdits'], /--permission-mode must be/],
  ['shared bypass plus read-only', ['--permission-mode', 'bypass', '--read-only'], /conflicts/],
  ['shared read-only plus bypass alias', ['--permission-mode', 'read-only', '--dangerously-skip-permissions'], /conflicts/],
  ['shared auto plus bypass alias', ['--permission-mode', 'auto', '--dangerously-skip-permissions'], /conflicts/],
  ['shared default plus bypass alias', ['--permission-mode', 'default', '--dangerously-skip-permissions'], /conflicts/],
  ['shared auto plus Claude bypass alias', ['--agent', 'claude', '--permission-mode', 'auto', '--claude-permission-mode', 'bypassPermissions'], /conflicts/],
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
    const start = spawnSync(process.execPath, [cli, 'start', 'Do not save an invalid task', '--workspace', dir, ...flags], { encoding: 'utf8', windowsHide: true });
    assert.equal(start.status, 1);
    assert.match(start.stderr, expected);
    assert.equal(store.tasks().length, 1);
  });
}

for (const [name, options, approvalPolicy, sandbox, approvalsReviewer = 'user'] of [
  ['interactive defaults', { interactive: true }, 'on-request', 'workspace-write'],
  ['noninteractive defaults', {}, 'never', 'workspace-write'],
  ['read-only', { interactive: true, readOnly: true }, 'never', 'read-only'],
  ['explicit bypass', { interactive: true, bypassPermissions: true }, 'never', 'danger-full-access'],
  ['shared default', { interactive: true, permissionMode: 'default' }, 'on-request', 'workspace-write'],
  ['shared read-only', { interactive: true, permissionMode: 'read-only' }, 'never', 'read-only'],
  ['shared bypass', { interactive: true, permissionMode: 'bypass' }, 'never', 'danger-full-access'],
  ['shared auto with interactive input', { interactive: true, permissionMode: 'auto' }, 'on-request', 'workspace-write', 'auto_review'],
  ['shared auto without interactive input', { permissionMode: 'auto' }, 'on-request', 'workspace-write', 'auto_review']
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
      assert.equal(thread.approvalsReviewer, approvalsReviewer);
    } finally { await adapter.close(); }
  });
}

for (const [provider, Provider] of [['codex', CodexAdapter], ['claude', ClaudeAdapter]]) {
  for (const permissionMode of ['auto', 'read-only', 'bypass']) test(`${provider} ${permissionMode} keeps questions and unexpected approvals under user control`, async t => {
    const { dir, store, task } = setup(t);
    let transcript = '';
    const adapter = new Provider({ workspace: dir, permissionMode, binary: process.execPath, args: [fixture, provider, 'interactive'] });
    const result = await supervise(store, task.id, { provider, permissionMode, adapter, log: text => { transcript += text; } });
    assert.equal(result.status, 'finished');
    const answers = fs.readFileSync(path.join(dir, 'answers.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(answers[0].value, provider === 'codex' ? { answers: {} } : { behavior: 'deny', message: 'Permission or input was not granted in Goddard.' });
    assert.equal(provider === 'codex' ? answers[1].value.decision : answers[1].value.behavior, provider === 'codex' ? 'decline' : 'deny');
    assert.equal(transcript.includes('Permission bypass enabled'), permissionMode === 'bypass');
    assert.deepEqual(store.events(task.id).find(event => event.type === 'run.started').payload.permissions,
      { mode: permissionMode, bypassPermissions: permissionMode === 'bypass', readOnly: permissionMode === 'read-only' });
    assert.ok(fs.existsSync(result.handoff));
  });

  test(`${provider} a fresh invocation does not inherit bypass from the handoff`, async t => {
    const { dir, store, task } = setup(t);
    const options = { provider, binary: process.execPath, args: [fixture, provider, 'interactive'], log: () => {} };
    await supervise(store, task.id, { ...options, permissionMode: 'bypass' });
    await supervise(store, task.id, options);
    const starts = store.events(task.id, 1000).filter(event => event.type === 'run.started');
    assert.deepEqual(starts.map(event => event.payload.permissions.mode), ['bypass', 'default']);
    assert.equal(starts[1].payload.permissions.bypassPermissions, false);
    if (provider === 'codex') assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'thread.json'), 'utf8')).sandbox, 'workspace-write');
  });
}

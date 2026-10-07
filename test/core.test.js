import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setup, temp, initGit, gitSync, cli } from './helpers.js';
import { emptyCheckpoint, validateCheckpoint, checkpointFile, seedCheckpoint, ingestCheckpoint } from '../src/checkpoint.js';
import { captureWorkspace } from '../src/workspace.js';
import { codexUsage, claudeUsage, usageDecision } from '../src/usage.js';
import { exportBundle, importBundle, unpackBundle, renderHandoff } from '../src/handoff.js';
import { scrub } from '../src/util.js';

test('quota policy handles multiple buckets, stale values, resets, and absent usage', () => {
  const time = 1000000;
  const windows = codexUsage({ rateLimitsByLimitId: { codex: { primary: { usedPercent: 20 }, secondary: { usedPercent: 90 } }, extra: { primary: null } } }, time);
  assert.equal(usageDecision(windows, { time }).action, 'drain');
  assert.equal(usageDecision(windows, { time: time + 120001 }).action, 'unknown');
  assert.equal(usageDecision([{ ...windows[1], resetsAt: 999 }], { time }).action, 'unknown');
  assert.equal(usageDecision(codexUsage({}), { time }).usedPercent, null);
  assert.equal(claudeUsage({ rate_limits: { five_hour: { used_percentage: 80 } } }, time)[0].usedPercent, 80);
  assert.throws(() => usageDecision([], { warn: 90, stop: 80 }));
});

test('invalid and partial checkpoint writes preserve the last good version', t => {
  const { store, task } = setup(t);
  seedCheckpoint(store, task.id);
  assert.equal(ingestCheckpoint(store, task.id).accepted, true);
  const first = store.latestCheckpoint(task.id);
  fs.writeFileSync(checkpointFile(store, task.id), '{"schemaVersion":');
  assert.equal(ingestCheckpoint(store, task.id).accepted, false);
  assert.equal(store.latestCheckpoint(task.id).digest, first.digest);
  assert.throws(() => validateCheckpoint({ ...emptyCheckpoint(), nextSteps: ['ok', 4] }));
  assert.throws(() => validateCheckpoint({ ...emptyCheckpoint(), status: 'done-ish' }));
});

test('Git capture preserves staged, unstaged, deleted, binary and untracked changes', async t => {
  const { dir, store, task } = setup(t); initGit(dir);
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'staged\n'); gitSync(dir, ['add', 'tracked.txt']);
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'original\n'); // Staged and unstaged changes cancel in diff HEAD.
  fs.writeFileSync(path.join(dir, 'new.bin'), Buffer.from([0, 255, 3]));
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=never export me');
  const snapshot = await captureWorkspace(store, task.id);
  assert.match(snapshot.git.stagedPatch, /staged/);
  assert.match(snapshot.git.unstagedPatch, /original/);
  assert.equal(snapshot.files.find(file => file.path === 'tracked.txt')?.deleted, false);
  assert.deepEqual(store.getObject(snapshot.files.find(file => file.path === 'new.bin').hash), Buffer.from([0, 255, 3]));
  assert.ok(snapshot.excluded.some(file => file.path === '.env'));
  assert.ok(!JSON.stringify(snapshot).includes('SECRET='));
  fs.unlinkSync(path.join(dir, 'tracked.txt'));
  assert.ok((await captureWorkspace(store, task.id)).files.some(file => file.path === 'tracked.txt' && file.deleted));
});

test('snapshot excludes symlink escapes and files above its size limit', async t => {
  const { dir, store, task } = setup(t);
  fs.writeFileSync(path.join(dir, 'huge.bin'), Buffer.alloc(2 * 1024 * 1024 + 1));
  const outside = temp(t); fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside');
  try { fs.symlinkSync(outside, path.join(dir, 'escape'), process.platform === 'win32' ? 'junction' : 'dir'); } catch (error) { if (error.code !== 'EPERM') throw error; }
  const snapshot = await captureWorkspace(store, task.id);
  assert.equal(snapshot.files.length, 0);
  assert.ok(snapshot.excluded.some(file => file.path === 'huge.bin'));
});

test('portable export is checked for corruption, traversal, and workspace mismatch', async t => {
  const { dir, store, task } = setup(t);
  fs.writeFileSync(path.join(dir, 'work.txt'), 'keep this work');
  store.checkpoint(task.id, { ...emptyCheckpoint(), nextSteps: ['finish work.txt'] });
  const bundlePath = path.join(temp(t), 'handoff.json');
  await exportBundle(store, task.id, bundlePath);
  const imported = await importBundle(store, bundlePath);
  assert.equal(store.latestCheckpoint(imported.id).data.nextSteps[0], 'finish work.txt');
  const extracted = path.join(temp(t), 'unpacked');
  unpackBundle(bundlePath, extracted);
  assert.equal(fs.readFileSync(path.join(extracted, 'files', 'work.txt'), 'utf8'), 'keep this work');
  assert.throws(() => unpackBundle(bundlePath, extracted), /must not exist/);
  fs.writeFileSync(path.join(dir, 'work.txt'), 'different');
  await assert.rejects(importBundle(store, bundlePath), /Workspace mismatch/);
  fs.writeFileSync(path.join(dir, 'work.txt'), 'keep this work');
  const raw = JSON.parse(fs.readFileSync(bundlePath));
  raw.snapshot.files[0].path = '../escape.txt'; fs.writeFileSync(bundlePath, JSON.stringify(raw));
  await assert.rejects(importBundle(store, bundlePath), /Unsafe bundle path/);
  raw.snapshot.files[0].path = 'work.txt'; raw.objects[raw.snapshot.files[0].hash] = Buffer.from('tampered').toString('base64');
  fs.writeFileSync(bundlePath, JSON.stringify(raw));
  await assert.rejects(importBundle(store, bundlePath), /corrupt object/);
  assert.equal(fs.readFileSync(path.join(dir, 'work.txt'), 'utf8'), 'keep this work');
});

test('unfinished operations and imported user constraints survive later checkpoints', async t => {
  const { store, task } = setup(t);
  store.event(task.id, 'source', 'tool.started', { id: 'external-1', command: 'deploy' });
  store.event(task.id, null, 'user.note', { text: 'Preserve the public API' });
  store.checkpoint(task.id, emptyCheckpoint());
  assert.match(renderHandoff(store, task.id), /deploy/);
  const file = path.join(temp(t), 'bundle.json');
  await exportBundle(store, task.id, file);
  const imported = await importBundle(store, file);
  store.checkpoint(imported.id, { ...emptyCheckpoint(), currentActivity: 'Continuing work' });
  assert.match(renderHandoff(store, imported.id), /Preserve the public API/);
  assert.match(renderHandoff(store, imported.id), /deploy/);
  const secondFile = path.join(temp(t), 'second-handoff.json');
  await exportBundle(store, imported.id, secondFile);
  const secondImport = await importBundle(store, secondFile);
  store.checkpoint(secondImport.id, { ...emptyCheckpoint(), currentActivity: 'Third session' });
  assert.match(renderHandoff(store, secondImport.id), /Preserve the public API/);
  assert.match(renderHandoff(store, secondImport.id), /deploy/);
  store.event(task.id, 'source', 'tool.completed', { id: 'external-1' });
  assert.equal(store.pendingOperations(task.id).length, 0);
});

test('Windows alternate streams, device names, and case-colliding bundle paths are rejected', async t => {
  const { dir, store, task } = setup(t);
  fs.writeFileSync(path.join(dir, 'ok.txt'), 'data');
  const file = path.join(temp(t), 'bundle.json');
  await exportBundle(store, task.id, file);
  const bundle = JSON.parse(fs.readFileSync(file));
  for (const unsafe of ['file:stream', 'CON.txt', 'folder/../out', '.git/config']) {
    const changed = structuredClone(bundle); changed.snapshot.files[0].path = unsafe;
    fs.writeFileSync(file, JSON.stringify(changed));
    await assert.rejects(importBundle(store, file), /Unsafe bundle path/);
  }
  bundle.snapshot.files.push({ ...bundle.snapshot.files[0], path: 'OK.TXT' });
  fs.writeFileSync(file, JSON.stringify(bundle));
  await assert.rejects(importBundle(store, file), /Duplicate bundle path/);
});

test('workspace lock rejects concurrent writers and recovers an abruptly exited owner', t => {
  const { store, task, dir } = setup(t);
  const active = store.startRun(task.id, 'codex');
  assert.throws(() => store.startRun(task.id, 'claude'), /unfinished run/);
  assert.throws(() => store.recover(), /may still be writing/);
  store.endRun(active.id, 'finished');
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/crash-owner.js', import.meta.url)), dir, task.id], { windowsHide: true });
  assert.equal(child.status, 9);
  assert.equal(store.recover().length, 1);
  assert.equal(store.activeRuns().length, 0);
  assert.match(renderHandoff(store, task.id), /unfinished operation/);
});

test('event redaction omits reasoning and common credentials', t => {
  const { store, task } = setup(t);
  store.event(task.id, null, 'sample', { access_token: 'secret', thinking: 'private', text: 'Bearer hidden-token', key: 'sk-abcdefghijklmnopqrstuv' });
  const record = JSON.stringify(store.events(task.id));
  assert.ok(!record.includes('hidden-token')); assert.ok(!record.includes('private')); assert.ok(!record.includes('abcdefghijklmnopqrstuv'));
  assert.equal(scrub({ password: 'secret' }).password, '[REDACTED]');
});

test('CLI initializes and creates a task in a workspace with spaces', t => {
  const dir = temp(t), workspace = path.join(dir, 'project with spaces'); fs.mkdirSync(workspace);
  const invoke = args => spawnSync(process.execPath, [cli, ...args, '--workspace', workspace], { encoding: 'utf8', windowsHide: true });
  assert.equal(invoke(['init']).status, 0);
  const created = invoke(['new', 'Fix the example', '--json']); assert.equal(created.status, 0, created.stderr);
  const task = JSON.parse(created.stdout);
  const listed = invoke(['list', '--json']); assert.equal(JSON.parse(listed.stdout)[0].id, task.id);
  assert.equal(invoke(['note', task.id, 'Keep the public API stable']).status, 0);
  const handoff = invoke(['handoff', task.id]); assert.equal(handoff.status, 0, handoff.stderr);
  assert.match(fs.readFileSync(handoff.stdout.trim(), 'utf8'), /Keep the public API stable/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { main } from '../src/cli.js';
import { checkpointFile, validateCheckpoint } from '../src/checkpoint.js';
import { setup, temp } from './helpers.js';

function harness(t) {
  const state = setup(t);
  const output = [];
  t.mock.method(console, 'log', (...args) => output.push(args.join(' ')));
  const exitCode = process.exitCode;
  t.after(() => { process.exitCode = exitCode; });
  return { ...state, output, invoke: (args, runTask) => main([...args, '--workspace', state.dir, '--non-interactive'], { runTask }) };
}

for (const provider of ['codex', 'claude']) {
  test(`start saves a new goal and launches ${provider} with the same options as run`, async t => {
    const { dir, store, task: existing, output, invoke } = harness(t);
    fs.writeFileSync(path.join(dir, 'pending.txt'), 'Keep this work.');
    let id, startOptions;
    const args = ['--agent', provider, '--model', 'test-model', '--effort', 'high', '--account', 'work',
      '--no-failover', '--plain', '--no-color', '--dangerously-skip-permissions', '--max-seconds', '60'];
    await invoke(['start', 'Fix login and run tests', ...args], async (saved, task, options) => {
      id = task; startOptions = options;
      assert.notEqual(task, existing.id);
      assert.equal(saved.task(task).goal, 'Fix login and run tests');
      assert.ok(validateCheckpoint(JSON.parse(fs.readFileSync(checkpointFile(saved, task), 'utf8'))));
      assert.ok(saved.latestSnapshot(task).data.files.some(file => file.path === 'pending.txt'));
      assert.match(fs.readFileSync(path.join(saved.taskDir(task), 'HANDOFF.md'), 'utf8'), /Fix login and run tests/);
      assert.deepEqual([options.provider, options.model, options.effort, options.account], [provider, 'test-model', 'high', 'work']);
      assert.equal(options.bypassPermissions, true);
      assert.equal(options.noFailover, true);
      assert.equal(options.interactive, false);
      assert.equal(options.maxSeconds, 60);
      assert.match(output.join('\n'), new RegExp(`goddard run ${id} --agent ${provider}`));
      return { status: 'finished' };
    });
    await invoke(['run', id, ...args], async (saved, task, options) => {
      assert.equal(task, id);
      assert.deepEqual(options, startOptions);
      return { status: 'finished' };
    });
    assert.equal(store.tasks().length, 2, 'resuming must not create another task');
  });
}

test('start accepts a goal file and defaults to Codex', async t => {
  const { dir, invoke } = harness(t);
  const file = path.join(dir, 'goal.txt');
  fs.writeFileSync(file, 'Fix login.\nThen verify the tests.\n');
  await invoke(['start', '--goal-file', file], async (store, task, options) => {
    assert.equal(store.task(task).goal, 'Fix login.\nThen verify the tests.');
    assert.equal(options.provider, 'codex');
    assert.equal(options.bypassPermissions, false);
    return { status: 'finished' };
  });
});

test('invalid start input creates no task and never calls a provider', async t => {
  const { store, invoke } = harness(t);
  for (const args of [[], ['   '], ['goal', '--goal-file', 'missing.txt'], ['--goal-file', 'missing.txt'],
    ['goal', '--agent', 'unknown'], ['goal', '--read-only', '--dangerously-skip-permissions'],
    ['goal', '--agent', 'claude', '--effort', 'invalid'], ['goal', '--interactive'],
    ['goal', '--snapshot-seconds', '0'], ['goal', '--warn', '90', '--stop', '80']]) {
    await assert.rejects(invoke(['start', ...args], async () => assert.fail('provider must not launch')));
    assert.equal(store.tasks().length, 1);
  }
});

test('start refuses a workspace with an unfinished run before creating a task', async t => {
  const { store, task, invoke } = harness(t);
  const run = store.startRun(task.id, 'codex');
  try {
    await assert.rejects(invoke(['start', 'Another goal'], async () => assert.fail('provider must not launch')), /unfinished run/);
    assert.equal(store.tasks().length, 1);
  } finally { store.endRun(run.id, 'finished'); }
});

for (const [status, code] of [['finished', 0], ['failed', 1], ['limited', 75], ['interrupted', 130]]) {
  test(`start preserves run exit code ${code} and saved work after ${status}`, async t => {
    const { dir, store, invoke } = harness(t);
    let id;
    await invoke(['start', 'Keep my goal'], async (saved, task) => { id = task; return { status }; });
    assert.equal(process.exitCode, code);
    assert.equal(store.task(id).goal, 'Keep my goal');
    assert.ok(fs.existsSync(path.join(dir, '.goddard', 'tasks', id, 'HANDOFF.md')));
  });
}

test('a launch error leaves the created task recoverable and announces its ID', async t => {
  const { store, output, invoke } = harness(t);
  let id;
  await assert.rejects(invoke(['start', 'Keep my goal'], async (saved, task) => {
    id = task; throw new Error('CLI unavailable');
  }), /CLI unavailable/);
  assert.equal(store.task(id).goal, 'Keep my goal');
  assert.match(output.join('\n'), new RegExp(id));
  assert.ok(fs.existsSync(checkpointFile(store, id)));
});

test('start requires init; new still creates without running and supports JSON', async t => {
  const { invoke, output } = harness(t);
  const empty = temp(t);
  await assert.rejects(main(['start', 'goal', '--workspace', empty]), /init/);
  assert.ok(!fs.existsSync(path.join(empty, '.goddard')));
  await invoke(['new', 'Save for later', '--json'], async () => assert.fail('new must not run'));
  assert.equal(JSON.parse(output.at(-1)).goal, 'Save for later');
});

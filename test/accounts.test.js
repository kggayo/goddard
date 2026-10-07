import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { AccountPool, profileEnv, probeProfile, loginProfile } from '../src/accounts.js';
import { runWithAccounts } from '../src/runner.js';
import { CodexAdapter } from '../src/adapters/codex.js';
import { ClaudeAdapter } from '../src/adapters/claude.js';
import { checkpointFile } from '../src/checkpoint.js';
import { isAlive } from '../src/util.js';
import { temp, setup } from './helpers.js';

const fixture = fileURLToPath(new URL('./fixtures/account-provider.js', import.meta.url));
function poolFor(t, provider = 'codex') {
  let pool;
  const home = temp(t, () => pool?.close());
  pool = new AccountPool({ home, root: path.join(home, '.goddard'), env: { ...process.env, CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude') } });
  const create = (name, config = {}) => {
    const directory = name === 'current' ? path.join(home, `.${provider}`) : path.join(home, name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'fixture.json'), JSON.stringify(config));
    return name === 'current' ? pool.list(provider)[0] : pool.add(provider, name, directory);
  };
  return { pool, home, create };
}
function harness(t, provider, configs, extra = {}) {
  const { dir, store, task } = setup(t);
  const { pool, create } = poolFor(t, provider);
  for (const [name, config] of Object.entries(configs)) create(name, config);
  store.event(task.id, null, 'user.note', { text: 'Preserve my clarification.' });
  const options = { pool, provider, model: 'test-model', effort: 'high', log: () => {}, graceSeconds: 0.2,
    probe: (profile, options) => probeProfile(profile, { ...options, binary: process.execPath, args: [fixture, provider, 'auth'] }),
    adapterFactory: (profile, env) => new (provider === 'codex' ? CodexAdapter : ClaudeAdapter)({ workspace: dir, env, model: 'test-model', effort: 'high',
      binary: process.execPath, args: [fixture, provider, 'run', checkpointFile(store, task.id)] }), ...extra };
  // Codex's auth probe is an app-server; Claude's auth status is a one-shot process.
  if (provider === 'codex') options.probe = (profile, opts) => probeProfile(profile, { ...opts, binary: process.execPath, args: [fixture, provider, 'probe'] });
  return { dir, store, task, pool, options, trace: () => fs.readFileSync(path.join(dir, 'account-trace.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) };
}

test('discovery reuses current env, default and sibling profiles without reading credentials', t => {
  const { pool, home, create } = poolFor(t);
  create('current');
  for (const name of ['.codex', '.codex-work', '.claude-personal']) {
    fs.mkdirSync(path.join(home, name), { recursive: true });
    fs.writeFileSync(path.join(home, name, name.startsWith('.codex') ? 'auth.json' : '.credentials.json'), 'not JSON; never read credentials');
  }
  fs.mkdirSync(path.join(home, '.codex-empty'));
  pool.env.CODEX_HOME = path.join(home, 'custom');
  const codex = pool.list('codex');
  assert.deepEqual(codex.map(p => p.name), ['current', 'default', 'discovered-work']);
  assert.equal(codex[0].path, pool.env.CODEX_HOME);
  assert.deepEqual(pool.list('claude').map(p => p.name), ['current', 'discovered-personal']);
  assert.throws(() => pool.prepareLogin('codex', '../escape'), /profile name/);
});

test('named account env is isolated while current login and parent env are preserved', () => {
  const base = { PATH: 'binary-path', CODEX_HOME: 'old', codex_home: 'another', OPENAI_API_KEY: 'secret', CODEX_ACCESS_TOKEN: 'secret', ANTHROPIC_API_KEY: 'secret', CLAUDE_CODE_OAUTH_TOKEN: 'secret', CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'secret', CLAUDE_CODE_USE_BEDROCK: '1' };
  const codex = profileEnv({ provider: 'codex', path: 'selected', source: 'registered' }, base);
  assert.equal(codex.CODEX_HOME, 'selected'); assert.equal(codex.codex_home, undefined);
  assert.equal(codex.OPENAI_API_KEY, undefined); assert.equal(codex.CODEX_ACCESS_TOKEN, undefined);
  const claude = profileEnv({ provider: 'claude', path: 'selected', source: 'registered' }, base);
  assert.equal(claude.ANTHROPIC_API_KEY, undefined); assert.equal(claude.CLAUDE_CODE_USE_BEDROCK, undefined);
  assert.equal(claude.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(claude.CLAUDE_CODE_OAUTH_REFRESH_TOKEN, undefined);
  assert.equal(profileEnv({ provider: 'codex', path: 'selected', source: 'current' }, base).OPENAI_API_KEY, 'secret');
  assert.equal(base.CODEX_HOME, 'old'); assert.equal(base.OPENAI_API_KEY, 'secret');
});

test('login runs in an isolated profile and removal preserves provider-owned files', async t => {
  const { pool } = poolFor(t);
  const profile = pool.prepareLogin('codex', 'work');
  fs.writeFileSync(path.join(profile.path, 'fixture.json'), '{}');
  assert.match(fs.readFileSync(path.join(profile.path, 'config.toml'), 'utf8'), /cli_auth_credentials_store = "file"/);
  await loginProfile(profile, { binary: process.execPath, args: [fixture, 'codex', 'login'], env: profileEnv(profile, { ...process.env, OPENAI_API_KEY: 'never-pass-this' }) });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile.path, 'login-observed.json'))), { directory: profile.path, keyPresent: false });
  pool.remove('codex', 'work'); assert.ok(fs.existsSync(path.join(profile.path, 'config.toml')));
});

test('quota cache respects all limiting reset windows and falls back to a finite cooldown', t => {
  const { pool, create } = poolFor(t);
  const profile = create('current');
  const time = Date.now();
  const windows = [{ usedPercent: 90, observedAt: time, resetsAt: time / 1000 + 60 }, { usedPercent: 95, observedAt: time, resetsAt: time / 1000 + 120 }];
  assert.equal(pool.record(profile, { windows, time }).blockedUntil, time + 120000);
  assert.equal(pool.record(profile, { limited: true, time }).blockedUntil, time + 300000);
  pool.reset(profile); assert.equal(pool.state(profile).blockedUntil, 0);
});

for (const provider of ['codex', 'claude']) {
  test(`${provider} default failover sends checkpoint, files, instructions and uncertain operations to the next account`, async t => {
    const h = harness(t, provider, { current: { scenario: 'limited' }, second: { scenario: 'destination' } });
    const result = await runWithAccounts(h.store, h.task.id, h.options);
    assert.equal(result.status, 'finished'); assert.deepEqual(result.attempts, ['current', 'second']);
    assert.equal(h.store.latestCheckpoint(h.task.id).data.status, 'complete');
    assert.ok(fs.existsSync(path.join(h.dir, 'restored.txt')));
    const turns = h.trace().filter(row => row.event === 'turn');
    assert.equal(turns.length, 2); assert.match(turns[1].prompt, /external action with uncertain outcome/);
    if (provider === 'codex') for (const turn of turns) { assert.equal(turn.model, 'test-model'); assert.equal(turn.effort, 'high'); }
    assert.ok(!isAlive(turns[0].pid)); assert.ok(!isAlive(turns[1].pid));
    assert.equal(h.store.activeRuns().length, 0);
    assert.equal(h.store.runs(h.task.id).length, 2);
    assert.ok(h.pool.state(h.pool.list(provider)[0]).blockedUntil > Date.now());
    assert.ok(!JSON.stringify(h.store.events(h.task.id, 1000)).includes('DO_NOT_PERSIST_AUTH_RESPONSE'));
  });

  test(`${provider} proactive quota drain switches accounts after checkpoint grace`, async t => {
    const h = harness(t, provider, { current: { scenario: 'threshold' }, second: { scenario: 'destination' } });
    const result = await runWithAccounts(h.store, h.task.id, h.options);
    assert.equal(result.status, 'finished'); assert.equal(result.attempts.length, 2);
    assert.ok(h.store.events(h.task.id, 1000).some(event => event.type === 'checkpoint.requested'));
  });

  test(`${provider} interactive approvals and follow-ups still work after failover`, async t => {
    const input = new PassThrough(), output = new PassThrough(); let text = '', approved = false, completed = false;
    output.on('data', chunk => {
      text += chunk.toString();
      if (!approved && text.includes('Allow this request?')) { approved = true; setImmediate(() => input.write('y\n')); }
      if (!completed && text.includes('You (Enter or /done')) { completed = true; setImmediate(() => input.write('/done\n')); }
    });
    const h = harness(t, provider, { current: { scenario: 'limited' }, second: { scenario: 'destination', interactive: true } }, { interactive: true, input, output, log: undefined });
    const result = await runWithAccounts(h.store, h.task.id, h.options);
    assert.equal(result.status, 'finished'); assert.equal(approved, true); assert.equal(completed, true);
    assert.equal(h.trace().find(row => row.event === 'approval').approved, true);
    input.end(); output.end();
  });
}

test('preflight skips unauthenticated and exhausted accounts without any model turn', async t => {
  const h = harness(t, 'codex', { current: { auth: false }, exhausted: { quota: 95 }, usable: { scenario: 'success' } });
  const result = await runWithAccounts(h.store, h.task.id, h.options);
  assert.deepEqual(result.attempts, ['usable']); assert.equal(result.skipped.length, 2);
  assert.deepEqual(h.trace().filter(row => row.event === 'turn').map(row => row.profile), ['usable']);
});

test('all exhausted accounts stop once with a durable handoff and no inference', async t => {
  const h = harness(t, 'codex', { current: { quota: 95 }, second: { quota: 99 } });
  const result = await runWithAccounts(h.store, h.task.id, h.options);
  assert.equal(result.status, 'limited'); assert.deepEqual(result.attempts, []); assert.ok(fs.existsSync(result.handoff));
  assert.equal(h.trace().filter(row => row.event === 'turn').length, 0); assert.equal(h.store.activeRuns().length, 0);
});

for (const selection of [{ account: 'current' }, { account: 'second' }, { noFailover: true }]) {
  test(`explicit account / no-failover opts out of automatic retry: ${JSON.stringify(selection)}`, async t => {
    const h = harness(t, 'claude', { current: { scenario: 'limited' }, second: { scenario: 'limited' } }, selection);
    const result = await runWithAccounts(h.store, h.task.id, h.options);
    assert.equal(result.status, 'limited'); assert.deepEqual(result.attempts, [selection.account ?? 'current']);
  });
}

for (const scenario of ['error', 'hang']) {
  test(`${scenario} stops instead of treating an unrelated failure as quota exhaustion`, async t => {
    const h = harness(t, 'codex', { current: { scenario }, second: { scenario: 'success' } }, scenario === 'hang' ? { maxSeconds: 0.4 } : {});
    if (scenario === 'hang') h.options.probe = async () => ({ authenticated: true, windows: [] });
    const result = await runWithAccounts(h.store, h.task.id, h.options);
    assert.equal(result.status, scenario === 'hang' ? 'interrupted' : 'failed');
    assert.deepEqual(result.attempts, ['current']);
  });
}

test('workspace ownership is held during next-account probing and Ctrl+C prevents another turn', async t => {
  const h = harness(t, 'claude', { current: { scenario: 'limited' }, second: { scenario: 'success' } });
  const originalProbe = h.options.probe;
  h.options.probe = async (profile, options) => {
    assert.throws(() => h.store.startRun(h.task.id, 'codex'), /unfinished run/);
    if (profile.name === 'second') process.emit('SIGINT');
    return originalProbe(profile, options);
  };
  const result = await runWithAccounts(h.store, h.task.id, h.options);
  assert.equal(result.status, 'interrupted'); assert.deepEqual(result.attempts, ['current']);
  assert.equal(h.store.activeRuns().length, 0);
});

test('cached Claude rejection skips a profile on the next invocation without calling its probe', async t => {
  const h = harness(t, 'claude', { current: { scenario: 'limited' }, second: { scenario: 'success' } });
  h.pool.record(h.pool.list('claude')[0], { limited: true });
  const originalProbe = h.options.probe;
  h.options.probe = (profile, options) => { assert.notEqual(profile.name, 'current'); return originalProbe(profile, options); };
  const result = await runWithAccounts(h.store, h.task.id, h.options);
  assert.equal(result.status, 'finished'); assert.deepEqual(result.attempts, ['second']);
});

test('Claude authentication status with exit code 1 skips a logged-out profile', async t => {
  const h = harness(t, 'claude', { current: { auth: false }, second: { scenario: 'success' } });
  const result = await runWithAccounts(h.store, h.task.id, h.options);
  assert.equal(result.status, 'finished'); assert.deepEqual(result.attempts, ['second']);
  assert.equal(result.skipped[0].reason, 'not logged in');
});

test('every quota-rejected account is attempted at most once, including duplicate directory aliases', async t => {
  const h = harness(t, 'claude', { current: { scenario: 'limited' }, second: { scenario: 'limited' } });
  h.pool.add('claude', 'alias', h.pool.list('claude')[0].path);
  const result = await runWithAccounts(h.store, h.task.id, h.options);
  assert.equal(result.status, 'limited'); assert.deepEqual(result.attempts, ['current', 'second']);
  assert.equal(h.trace().filter(row => row.event === 'turn').length, 2);
});

test('Ctrl+C during a proactive quota drain cancels automatic failover', async t => {
  const h = harness(t, 'codex', { current: { scenario: 'threshold' }, second: { scenario: 'success' } });
  const factory = h.options.adapterFactory;
  h.options.adapterFactory = (...args) => {
    const adapter = factory(...args);
    adapter.on('usage', windows => { if (windows.some(w => w.usedPercent >= 85)) queueMicrotask(() => process.emit('SIGINT')); });
    return adapter;
  };
  const result = await runWithAccounts(h.store, h.task.id, h.options);
  assert.equal(result.status, 'interrupted'); assert.deepEqual(result.attempts, ['current']);
});

test('a failed process shutdown retains the workspace lock and does not start a replacement', async t => {
  const h = harness(t, 'claude', { current: { scenario: 'limited' }, second: { scenario: 'success' } });
  const factory = h.options.adapterFactory;
  h.options.adapterFactory = (...args) => {
    const adapter = factory(...args), close = adapter.close.bind(adapter);
    adapter.close = async () => { await close(); throw new Error('Simulated shutdown verification failure.'); };
    return adapter;
  };
  await assert.rejects(runWithAccounts(h.store, h.task.id, h.options), /Run remains locked/);
  assert.equal(h.store.activeRuns().length, 1);
  assert.equal(h.trace().filter(row => row.event === 'turn').length, 1);
});

test('an unconfirmed account-probe shutdown retains workspace ownership', async t => {
  const h = harness(t, 'codex', { current: {} });
  h.options.probe = async () => { throw new Error('Account probe could not stop its process.'); };
  await assert.rejects(runWithAccounts(h.store, h.task.id, h.options), /Run remains locked/);
  assert.equal(h.store.activeRuns().length, 1);
});

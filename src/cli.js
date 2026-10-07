import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Store } from './store.js';
import { atomicWrite, readJSON, version } from './util.js';
import { checkpointFile, ingestCheckpoint, seedCheckpoint, validateCheckpoint } from './checkpoint.js';
import { captureWorkspace } from './workspace.js';
import { exportBundle, importBundle, unpackBundle, writeHandoff } from './handoff.js';
import { runWithAccounts } from './runner.js';
import { AccountPool, loginProfile, probeProfile, profileEnv } from './accounts.js';
import { CodexAdapter } from './adapters/codex.js';

const help = `Goddard 0.3.0 — durable handoffs between coding agents

Usage: goddard <command> [arguments] [options]

  init                              Initialize a workspace
  new "goal"                        Create a task (or --goal-file PATH)
  list                              List saved tasks
  run TASK --agent codex|claude       Start a fresh session from the handoff
  login NAME --agent codex|claude     Sign in once to an isolated account profile
  accounts [--agent ...] [--probe]   List profiles; optionally check login and quota
  accounts add NAME --path PATH     Register an existing CLI configuration directory
  accounts remove NAME             Forget a registration; keep its files and login
  accounts reset NAME              Clear cached quota cooldown after a login change
  status [TASK]                     Show task state and recent run
  note TASK "instruction"            Record a user update for the next run
  checkpoint TASK --file PATH        Import a structured agent checkpoint
  handoff TASK                      Capture files and write HANDOFF.md
  export TASK --out PATH.json        Export a portable bundle with file contents
  unpack PATH.json --out DIRECTORY   Extract captured files and patches for review
  import PATH.json                  Import into a matching workspace; never overwrite files
  recover                           Recover runs after their processes have exited
  doctor [--probe]                  Check CLIs; --probe checks Codex quota and sandbox

Options:
  --workspace PATH                  Workspace root (default: current directory)
  --model NAME                      Optional provider-specific model override
  --account NAME                    auto (default), current, or a listed profile name
  --no-failover                     Select an account automatically, but stop at its limit
  --effort LEVEL                    Per-run reasoning effort (model dependent)
  --interactive                     Answer questions/approvals and send follow-ups
  --non-interactive                 Disable prompts (default when input is not a TTY)
  --plain                           Show original Markdown without terminal styling
  --no-color                        Render Markdown without colors (also honors NO_COLOR)
  --checkpoint-seconds N            Request progress notes every N seconds (default: 120)
  --snapshot-seconds N              Save workspace evidence every N seconds (default: 15)
  --warn N --stop N                 Usage thresholds, percent consumed (75 / 85)
  --grace-seconds N                 Time allowed for a final checkpoint (default: 30)
  --max-seconds N                   Limit a run's duration (default: unlimited)
  --read-only                       Use the provider's read-only / planning mode
  --claude-permission-mode MODE      acceptEdits (default) or auto
  --allow-tool RULE                 Claude tool permission rule (repeatable)
  --json                            Print machine-readable results (except run)

Provider sign-in stays with the installed CLI. Goddard does not copy credentials.
Automatic selection tries available profiles of the chosen agent; login each account once.
Same workspace: run TASK --agent claude continues a Codex task, and vice versa.
Goddard supervises sessions it launches. It does not attach to desktop chats.
`;

export async function main(argv = process.argv.slice(2)) {
  const { values: flags, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    workspace: { type: 'string', default: process.cwd() }, agent: { type: 'string', default: 'codex' },
    model: { type: 'string' }, file: { type: 'string' }, out: { type: 'string' }, 'goal-file': { type: 'string' },
    account: { type: 'string', default: 'auto' }, path: { type: 'string' }, 'no-failover': { type: 'boolean' },
    effort: { type: 'string' }, interactive: { type: 'boolean' }, 'non-interactive': { type: 'boolean' },
    plain: { type: 'boolean' }, 'no-color': { type: 'boolean' },
    'checkpoint-seconds': { type: 'string', default: '120' }, 'snapshot-seconds': { type: 'string', default: '15' },
    'grace-seconds': { type: 'string', default: '30' }, 'max-seconds': { type: 'string', default: '0' },
    warn: { type: 'string', default: '75' }, stop: { type: 'string', default: '85' },
    'read-only': { type: 'boolean' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, probe: { type: 'boolean' },
    'claude-permission-mode': { type: 'string', default: 'acceptEdits' }, 'allow-tool': { type: 'string', multiple: true, default: [] }
  } });
  const [command, target, ...extra] = positionals;
  const print = value => console.log(flags.json ? JSON.stringify(value, null, 2) : typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  if (!command || flags.help || command === 'help') { console.log(help); return; }
  const workspace = path.resolve(flags.workspace);
  if (command === 'accounts' || command === 'login') {
    if (!['codex', 'claude'].includes(flags.agent)) throw new Error('--agent must be codex or claude.');
    const pool = new AccountPool();
    try {
      if (command === 'login') {
        if (!target || extra.length) throw new Error('Use goddard login NAME --agent codex|claude.');
        const profile = pool.prepareLogin(flags.agent, target);
        console.log(`Signing in to ${flags.agent}/${profile.name}. Choose the intended account in the provider's login flow.`);
        await loginProfile(profile, { env: profileEnv(profile, pool.env) });
        pool.reset(profile); print(`Saved ${flags.agent}/${profile.name}; automatic account selection will include it.`); return;
      }
      if (target === 'add') {
        if (!extra[0] || extra.length !== 1 || !flags.path) throw new Error('Use accounts add NAME --agent codex|claude --path CONFIG_DIRECTORY.');
        print(pool.add(flags.agent, extra[0], flags.path)); return;
      }
      if (target === 'remove' || target === 'reset') {
        if (extra.length !== 1) throw new Error(`Use accounts ${target} NAME --agent codex|claude.`);
        if (target === 'remove') { pool.remove(flags.agent, extra[0]); print('Registration removed. Profile files and login were kept.'); }
        else {
          const profile = pool.list(flags.agent).find(item => item.name === extra[0]);
          if (!profile) throw new Error('Unknown profile. Use goddard accounts to list names.');
          pool.reset(profile); print('Cached quota cooldown cleared.');
        }
        return;
      }
      if ((target && target !== 'list') || extra.length) throw new Error('Use accounts [list|add|remove|reset].');
      const profiles = [];
      for (const profile of pool.list(flags.agent)) {
        const state = pool.state(profile);
        const probe = flags.probe ? await probeProfile(profile, { workspace, env: profileEnv(profile, pool.env) }) : {};
        profiles.push({ ...profile, ...probe, cooldownUntil: state.blockedUntil > Date.now() ? new Date(state.blockedUntil).toISOString() : null });
      }
      print(profiles); return;
    } finally { pool.close(); }
  }
  if (command === 'unpack') {
    if (!target || !flags.out) throw new Error('Specify a bundle path and --out with a new directory.');
    print(unpackBundle(path.resolve(target), path.resolve(flags.out))); return;
  }
  if (command === 'doctor') {
    const result = { node: process.version, workspace, providers: {} };
    for (const name of ['codex', 'claude']) {
      try { result.providers[name] = version(name); } catch (error) { result.providers[name] = { error: error.message }; }
    }
    if (flags.probe && !result.providers.codex.error) {
      const adapter = new CodexAdapter({ workspace });
      adapter.on('fault', () => {});
      try {
        result.providers.codex.quota = await adapter.connect(); result.providers.codex.protocol = 'connected';
        try {
          const command = process.platform === 'win32' ? ['powershell.exe', '-NoProfile', '-Command', 'Write-Output GODDARD_SANDBOX_OK'] : ['/bin/sh', '-c', 'printf GODDARD_SANDBOX_OK'];
          const probe = await adapter.rpc.request('command/exec', { command, cwd: workspace, sandboxPolicy: { type: 'readOnly' }, timeoutMs: 5000 });
          if (probe.exitCode !== 0 || !probe.stdout?.includes('GODDARD_SANDBOX_OK')) throw new Error(probe.stderr || 'Sandbox probe did not return the expected output.');
          result.providers.codex.sandbox = 'working';
        } catch (error) { result.providers.codex.sandboxError = error.message; }
      }
      catch (error) { result.providers.codex.protocolError = error.message; }
      finally { await adapter.close(); }
    }
    print(result); return;
  }
  if (!['init', 'new', 'list', 'run', 'status', 'note', 'checkpoint', 'handoff', 'export', 'import', 'recover'].includes(command)) throw new Error(`Unknown command: ${command}. Use --help.`);
  const store = new Store(workspace, { create: command === 'init' });
  try {
    if (command === 'init') {
      const ignore = path.join(workspace, '.gitignore');
      const existing = fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8') : '';
      if (!existing.split(/\r?\n/).some(line => ['.goddard/', '/.goddard/'].includes(line))) atomicWrite(ignore, existing + (existing && !existing.endsWith('\n') ? '\n' : '') + '.goddard/\n');
      print(`Initialized Goddard in ${workspace}`); return;
    }
    if (command === 'new') {
      const goal = flags['goal-file'] ? fs.readFileSync(path.resolve(flags['goal-file']), 'utf8') : [target, ...extra].filter(Boolean).join(' ');
      const task = store.createTask(goal); seedCheckpoint(store, task.id); await captureWorkspace(store, task.id); writeHandoff(store, task.id);
      print(task); return;
    }
    if (command === 'list') { print(store.tasks().map(task => ({ ...task, checkpointStatus: store.latestCheckpoint(task.id)?.data.status ?? 'not_started', lastRun: store.runs(task.id)[0]?.status ?? null }))); return; }
    if (command === 'recover') {
      const recovered = store.recover();
      for (const run of recovered) { ingestCheckpoint(store, run.task); await captureWorkspace(store, run.task); writeHandoff(store, run.task); }
      print({ recovered: recovered.map(run => run.id) }); return;
    }
    if (command === 'import') { if (!target) throw new Error('Specify a bundle JSON path.'); print(await importBundle(store, path.resolve(target))); return; }
    const task = target ?? store.tasks()[0]?.id;
    if (!task) throw new Error('Specify a task ID; create one with goddard new "goal".');
    store.task(task);
    if (command === 'status') {
      print({ ...store.task(task), checkpoint: store.latestCheckpoint(task), snapshot: store.latestSnapshot(task)?.at ?? null,
        lastRun: store.runs(task)[0] ?? null, handoff: path.join(store.taskDir(task), 'HANDOFF.md') }); return;
    }
    if (command === 'note') {
      const text = extra.join(' ').trim(); if (!text) throw new Error('Provide the instruction text.');
      if (store.activeRuns().length) throw new Error('Stop the active run before changing its instructions.');
      store.event(task, null, 'user.note', { text }); print(writeHandoff(store, task)); return;
    }
    if (command === 'checkpoint') {
      if (!flags.file) throw new Error('Specify --file with checkpoint JSON.');
      if (store.activeRuns().length) throw new Error('Manual checkpoint import requires the active run to stop.');
      const data = validateCheckpoint(readJSON(path.resolve(flags.file)));
      atomicWrite(checkpointFile(store, task), JSON.stringify(data, null, 2)); store.checkpoint(task, data); print(writeHandoff(store, task)); return;
    }
    if (command === 'handoff') {
      if (store.activeRuns().length) throw new Error('Stop the active run before preparing a handoff.');
      ingestCheckpoint(store, task); await captureWorkspace(store, task); print(writeHandoff(store, task)); return;
    }
    if (command === 'export') {
      if (!flags.out) throw new Error('Specify --out with a new bundle JSON filename.');
      print(await exportBundle(store, task, path.resolve(flags.out))); return;
    }
    if (!['codex', 'claude'].includes(flags.agent)) throw new Error('--agent must be codex or claude.');
    if (!['acceptEdits', 'auto'].includes(flags['claude-permission-mode'])) throw new Error('--claude-permission-mode must be acceptEdits or auto.');
    if (flags.interactive && flags['non-interactive']) throw new Error('Choose either --interactive or --non-interactive.');
    if (flags.effort && !/^[a-z][a-z0-9_-]{0,49}$/.test(flags.effort)) throw new Error('--effort must be a provider effort level, such as low, medium, or high.');
    if (flags.agent === 'claude' && flags.effort && !['low', 'medium', 'high', 'xhigh', 'max'].includes(flags.effort)) throw new Error('Claude --effort must be low, medium, high, xhigh, or max (subject to model support).');
    if (flags.interactive && !(process.stdin.isTTY && process.stdout.isTTY)) throw new Error('--interactive requires a terminal. Use --non-interactive for redirected input.');
    const numeric = (key, min, max) => { const value = Number(flags[key]); if (!Number.isFinite(value) || value < min || value > max) throw new Error(`--${key} must be between ${min} and ${max}.`); return value; };
    const options = { provider: flags.agent, account: flags.account, noFailover: flags['no-failover'], model: flags.model, effort: flags.effort, readOnly: flags['read-only'],
      plain: flags.plain, noColor: flags['no-color'],
      interactive: !flags['non-interactive'] && Boolean(flags.interactive || (process.stdin.isTTY && process.stdout.isTTY)),
      claudePermissionMode: flags['claude-permission-mode'], allowedTools: flags['allow-tool'],
      checkpointSeconds: numeric('checkpoint-seconds', 5, 86400), snapshotSeconds: numeric('snapshot-seconds', 1, 3600),
      graceSeconds: numeric('grace-seconds', 0, 300), maxSeconds: numeric('max-seconds', 0, 604800), warn: numeric('warn', 1, 99), stop: numeric('stop', 2, 100) };
    const result = await runWithAccounts(store, task, options);
    process.exitCode = result.status === 'failed' ? 1 : result.status === 'interrupted' ? 130 : result.status === 'limited' ? 75 : 0;
  } finally { store.close(); }
}

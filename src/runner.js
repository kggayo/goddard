import { AccountPool, probeProfile, profileEnv } from './accounts.js';
import { supervise } from './supervisor.js';
import { usageDecision } from './usage.js';
import { writeHandoff } from './handoff.js';
import { TerminalDisplay, terminalText } from './terminal.js';

export async function runWithAccounts(store, task, options = {}) {
  const { provider = 'codex', account = 'auto', warn = 75, stop = 85 } = options;
  usageDecision([], { warn, stop });
  const pool = options.pool ?? new AccountPool();
  const display = options.display ?? new TerminalDisplay({ output: options.output, write: options.log, plain: options.plain, noColor: options.noColor });
  const log = text => display.status(terminalText(text));
  const abort = new AbortController();
  const onSignal = () => abort.abort();
  let run, result, safeToRelease = true;
  const attempts = [], skipped = [];
  const deadline = options.maxSeconds > 0 ? Date.now() + options.maxSeconds * 1000 : Infinity;
  try {
    const candidates = pool.list(provider).filter(profile => account === 'auto' || profile.name === account);
    if (!candidates.length) throw new Error(`Unknown ${provider} account profile: ${account}. Use goddard accounts --agent ${provider}.`);
    run = store.startRun(task, provider);
    process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
    const seen = new Set();
    for (const profile of candidates) {
      if (abort.signal.aborted || Date.now() >= deadline) break;
      const key = pool.key(profile);
      if (seen.has(key)) continue;
      seen.add(key);
      const cached = pool.state(profile);
      if (cached.blockedUntil > Date.now()) {
        const reason = `quota cooldown until ${new Date(cached.blockedUntil).toISOString()}`;
        skipped.push({ account: profile.name, reason }); log(`Skipping ${provider}/${profile.name}: ${reason}.`); continue;
      }
      log(`Checking ${provider}/${profile.name}…`);
      const env = profileEnv(profile, pool.env);
      safeToRelease = false;
      const probe = await (options.probe ?? probeProfile)(profile, { workspace: store.workspace, env, signal: abort.signal, onSpawn: pid => store.child(run.id, pid) });
      safeToRelease = true;
      if (abort.signal.aborted || Date.now() >= deadline) break;
      if (probe.authenticated === false) {
        skipped.push({ account: profile.name, reason: 'not logged in' }); log(`Skipping ${provider}/${profile.name}: not logged in.`); continue;
      }
      if (usageDecision(probe.windows ?? [], { warn, stop }).action === 'drain') {
        pool.record(profile, { windows: probe.windows, stop });
        skipped.push({ account: profile.name, reason: 'quota threshold reached' }); log(`Skipping ${provider}/${profile.name}: quota threshold reached.`); continue;
      }
      if (probe.error) log(probe.error);
      if (attempts.length) run = store.startRun(task, provider, { id: run.id, status: result.status });
      store.event(task, run.id, 'account.selected', { provider, account: profile.name, source: profile.source, previous: attempts.at(-1) ?? null });
      log(`Using ${provider}/${profile.name}${probe.windows?.length ? '' : ' (quota unknown)'}.`);
      attempts.push(profile.name);
      safeToRelease = false;
      result = await supervise(store, task, { ...options, env, display, run, holdLock: true, accountName: profile.name,
        maxSeconds: Number.isFinite(deadline) ? Math.max(0.001, (deadline - Date.now()) / 1000) : 0,
        adapter: options.adapterFactory?.(profile, env) });
      safeToRelease = true;
      pool.record(profile, { windows: result.windows, limited: result.status === 'limited', limitInfo: result.limitInfo, stop });
      if (result.status !== 'limited' || account !== 'auto' || options.noFailover || abort.signal.aborted) break;
      log('Quota stop saved. Looking for another account to continue from the handoff.');
    }
    if (abort.signal.aborted || Date.now() >= deadline) result = { ...result, status: 'interrupted', reason: abort.signal.aborted ? 'User interrupted account selection or handoff.' : 'Run time limit reached.' };
    else if (!result) {
      const quota = skipped.some(item => item.reason.startsWith('quota'));
      result = { status: quota ? 'limited' : 'failed', reason: quota ? 'No account below the quota threshold is available.' : `No authenticated account available. Run goddard login main --agent ${provider}.` };
    }
    store.event(task, run.id, 'accounts.ended', { attempts, skipped, status: result.status });
    store.endRun(run.id, result.status);
    const handoff = writeHandoff(store, task);
    if (!attempts.length || result.status === 'limited') log(`${result.reason ?? 'No further account is available.'} Handoff: ${handoff}`);
    return { ...result, attempts, skipped, runId: run.id, handoff };
  } catch (error) {
    // A failed shutdown deliberately leaves ownership locked for explicit recovery.
    if (run && safeToRelease) { store.endRun(run.id, 'failed'); writeHandoff(store, task); }
    if (run && !safeToRelease && !error.message.includes('Run remains locked')) throw new Error(`${error.message} Run remains locked because process shutdown could not be confirmed; use goddard recover after its processes exit.`);
    throw error;
  } finally {
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    if (!options.pool) pool.close();
  }
}

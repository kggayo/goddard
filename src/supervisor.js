import { CodexAdapter } from './adapters/codex.js';
import { ClaudeAdapter } from './adapters/claude.js';
import { seedCheckpoint, ingestCheckpoint, checkpointFile } from './checkpoint.js';
import { captureWorkspace } from './workspace.js';
import { buildPrompt, writeHandoff } from './handoff.js';
import { usageDecision } from './usage.js';
import { Interaction } from './interaction.js';
import { TerminalDisplay, terminalText } from './terminal.js';

export async function supervise(store, task, options = {}) {
  const { provider = 'codex', checkpointSeconds = 120, snapshotSeconds = 15, graceSeconds = 30,
    warn = 75, stop = 85, maxSeconds = 0, adapter: suppliedAdapter } = options;
  usageDecision([], { warn, stop });
  const adapter = suppliedAdapter ?? (provider === 'codex' ? new CodexAdapter({ workspace: store.workspace, ...options }) : new ClaudeAdapter({ workspace: store.workspace, ...options }));
  const run = options.run ?? store.startRun(task, provider);
  const display = options.display ?? options.interaction?.display ?? new TerminalDisplay({ output: options.output, write: options.log, plain: options.plain, noColor: options.noColor });
  const log = text => display.status(text);
  const interaction = options.interaction ?? (options.interactive ? new Interaction({ display, input: options.input }) : null);
  const lifetime = new AbortController();
  const interactions = new Set();
  let waiting = 0, betweenTurns = false;
  let outcome, draining = false, ready = false, ending = false, busy = false, windows = [], lastRequest = Date.now(), lastWarningRequest = 0, lastSnapshot = 0, lastPoll = Date.now();
  let drainTimer, tickTimer, maxTimer, snapshotPromise, tickPromise, drainStatus, limitInfo;
  const checkpointRequests = new Set();
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const finish = result => { if (outcome) return; outcome = result; lifetime.abort(); interaction?.close(); resolveDone(result); };
  const evidence = (type, payload) => {
    store.event(task, run.id, type, payload);
    if (type === 'agent.message') display.agent(provider, payload.text);
    if (type === 'interaction.unsupported') log('An unsupported interaction could not be handled and was recorded in the handoff.');
    if (type === 'interaction.unavailable') log(terminalText(payload.reason));
  };
  async function capture() {
    // Serialize snapshots so the final capture cannot be overwritten by an older one.
    if (snapshotPromise) await snapshotPromise;
    snapshotPromise = captureWorkspace(store, task);
    try { await snapshotPromise; lastSnapshot = Date.now(); } finally { snapshotPromise = null; }
  }
  const requestCheckpoint = (reason, stopAfter = false) => {
    if (ending || outcome || betweenTurns || (waiting && !stopAfter)) return Promise.resolve();
    lastRequest = Date.now();
    const prompt = `Goddard checkpoint request (${reason}). At the next safe boundary, update ${checkpointFile(store, task)} with actual progress, verification, next steps, and uncertain operations. ${stopAfter ? 'Stop starting new work; finish the checkpoint and end this turn for a handoff.' : 'Then continue the task.'}`;
    evidence('checkpoint.requested', { reason, stopAfter });
    const request = Promise.resolve().then(() => adapter.requestCheckpoint(prompt))
      .catch(error => evidence('checkpoint.request_failed', { message: error.message }))
      .finally(() => checkpointRequests.delete(request));
    checkpointRequests.add(request);
    return request;
  };
  const drain = async (reason, status = 'handoff_ready') => {
    if (draining || ending || outcome) return;
    draining = true;
    drainStatus = status;
    lifetime.abort(); interaction?.close();
    evidence('run.draining', { reason });
    log(`Preparing handoff: ${reason}`);
    drainTimer = setTimeout(() => finish({ status, reason: `${reason}; checkpoint grace period ended` }), graceSeconds * 1000);
    if (betweenTurns) finish({ status, reason });
    else if (ready) await requestCheckpoint(reason, true);
    else finish({ status, reason });
  };
  const onSignal = () => {
    // An interrupt must override an in-progress quota drain; it must never launch another account.
    if (draining && drainStatus === 'limited') { drainStatus = 'interrupted'; finish({ status: 'interrupted', reason: 'User interrupted the account handoff' }); return; }
    if (draining) finish({ status: 'interrupted', reason: 'Second interrupt' });
    else void drain('User interrupted the run', 'interrupted');
  };
  adapter.on('spawn', pid => { if (pid) store.child(run.id, pid); });
  adapter.on('session', session => store.session(run.id, session));
  adapter.on('evidence', evidence);
  adapter.on('request', request => {
    waiting++;
    evidence('interaction.requested', { kind: request.kind, title: request.title, detail: request.detail, questions: request.questions });
    const pending = (async () => {
      await Promise.resolve();
      try {
        let answer = null;
        if (interaction && !draining && !outcome) answer = await interaction.request(request);
        else log(`${request.title}: no interactive input available; request declined. Use --interactive in a terminal.`);
        if (!request.signal.aborted && !outcome) {
          request.respond(answer);
          evidence('interaction.answered', { kind: request.kind, title: request.title, answer });
          if (request.kind === 'question' && answer) evidence('user.note', { text: (request.questions ?? []).map(q => `${q.question}\nUser answer: ${(answer[q.id] ?? []).join(', ')}`).join('\n\n') });
        }
      } catch (error) {
        request.respond(null); evidence('interaction.error', { message: error.message });
      } finally { waiting--; interactions.delete(pending); }
    })();
    interactions.add(pending);
  });
  adapter.on('usage', values => {
    windows = values;
    evidence('usage.observed', { windows });
    const decision = usageDecision(windows, { warn, stop });
    if (ready && decision.action === 'drain') void drain(`Usage reached ${decision.usedPercent.toFixed(1)}%`, 'limited');
    else if (ready && decision.action === 'checkpoint' && Date.now() - lastWarningRequest > 30000) { lastWarningRequest = Date.now(); void requestCheckpoint('usage warning'); }
  });
  adapter.on('warning', detail => { if (ready && Date.now() - lastWarningRequest > 30000) { lastWarningRequest = Date.now(); void requestCheckpoint(detail.message); } });
  adapter.on('limited', detail => { limitInfo = detail.info; evidence('run.limited', detail); finish({ status: 'limited', reason: detail.message }); });
  adapter.on('fault', error => { evidence('run.error', { message: error.message }); finish({ status: 'failed', reason: error.message }); });
  adapter.on('done', result => {
    if (!interaction || draining || outcome || result.status !== 'finished') {
      finish(draining && result.status === 'finished' ? { ...result, status: drainStatus } : result); return;
    }
    if (betweenTurns) return;
    betweenTurns = true;
    const pending = (async () => {
      try {
        ingestCheckpoint(store, task); await capture(); writeHandoff(store, task);
        const input = await interaction.request({ kind: 'followup', signal: lifetime.signal });
        if (outcome || draining) return;
        if (!input?.trim() || input.trim() === '/done') { finish(result); return; }
        evidence('user.note', { text: input });
        betweenTurns = false; lastRequest = Date.now();
        await adapter.sendPrompt(input);
      } catch (error) { finish({ status: 'failed', reason: error.message }); }
      finally { interactions.delete(pending); }
    })();
    interactions.add(pending);
  });
  adapter.on('exit', result => { if (!ending) finish({ status: 'interrupted', reason: `Agent exited without a final result (code ${result.code}, signal ${result.signal}).` }); });
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  try {
    seedCheckpoint(store, task);
    await capture();
    evidence('run.started', { provider, account: options.accountName ?? 'current', model: options.model ?? null, effort: options.effort ?? null, interactive: Boolean(interaction), checkpointSeconds, snapshotSeconds, warn, stop });
    log(`Task ${task}\nAgent: ${provider}\nWorkspace: ${store.workspace}\nPress Ctrl+C to prepare a handoff; press again to stop immediately.`);
    windows = await adapter.connect();
    const preflight = usageDecision(windows, { warn, stop });
    if (preflight.action === 'drain') finish({ status: 'limited', reason: `Usage is already ${preflight.usedPercent.toFixed(1)}%; no task turn started.` });
    if (!outcome) {
      await adapter.startTask(buildPrompt(store, task));
      ready = true;
      const decision = usageDecision(windows, { warn, stop });
      if (!outcome && decision.action === 'drain') void drain('Usage threshold reached', 'limited');
      else if (!outcome && decision.action === 'checkpoint') { lastWarningRequest = Date.now(); void requestCheckpoint('usage warning'); }
      tickTimer = setInterval(() => {
        if (busy || ending || outcome) return;
        busy = true;
        tickPromise = (async () => {
          try {
            const accepted = ingestCheckpoint(store, task);
            if (accepted.changed) { log('Checkpoint saved.'); writeHandoff(store, task); }
            if (Date.now() - lastSnapshot >= snapshotSeconds * 1000) await capture();
            if (!ending && !outcome && !draining && !waiting && !betweenTurns && Date.now() - lastRequest >= checkpointSeconds * 1000) await requestCheckpoint('periodic progress save');
            if (!ending && !outcome && adapter.readUsage && !draining && Date.now() - lastPoll >= 30000) { lastPoll = Date.now(); await adapter.readUsage(); }
          } catch (error) { evidence('capture.error', { message: error.message }); }
          finally { busy = false; }
        })();
      }, 1000);
      if (maxSeconds > 0) maxTimer = setTimeout(() => void drain('Run time limit reached', 'interrupted'), maxSeconds * 1000);
    }
    await done;
  } catch (error) {
    evidence('run.error', { message: error.message });
    finish({ status: 'failed', reason: error.message });
  } finally {
    ending = true;
    lifetime.abort(); interaction?.close();
    clearInterval(tickTimer); clearTimeout(maxTimer); clearTimeout(drainTimer);
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    // Do not release the workspace lock before the owned process has actually exited.
    try {
      if (outcome?.status !== 'finished' && adapter.interrupt) await Promise.race([adapter.interrupt().catch(() => {}), new Promise(resolve => { const timer = setTimeout(resolve, 2000); timer.unref(); })]);
      await adapter.close();
      await Promise.allSettled([...interactions]);
      await Promise.allSettled([...checkpointRequests]);
      if (tickPromise) await tickPromise;
      if (snapshotPromise) await snapshotPromise.catch(() => {});
      const accepted = ingestCheckpoint(store, task);
      if (!accepted.accepted) evidence('checkpoint.unavailable', { reason: accepted.reason });
      await capture().catch(error => evidence('capture.error', { message: error.message }));
      evidence('run.ended', outcome ?? { status: 'failed' });
      if (!options.holdLock) store.endRun(run.id, outcome?.status ?? 'failed');
      const file = writeHandoff(store, task);
      log(`Run ${outcome?.status ?? 'failed'}. Handoff: ${file}`);
      if (outcome?.reason) log(outcome.reason);
    } catch (error) {
      evidence('shutdown.error', { message: error.message });
      throw new Error(`${error.message} Run remains locked; use goddard recover only after its processes have exited.`);
    }
  }
  return { ...outcome, windows, limitInfo, runId: run.id, handoff: writeHandoff(store, task) };
}

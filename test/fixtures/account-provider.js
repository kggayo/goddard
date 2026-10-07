import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { emptyCheckpoint } from '../../src/checkpoint.js';

const [provider, mode, checkpoint] = process.argv.slice(2);
const directory = process.env[provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'];
const config = JSON.parse(fs.readFileSync(path.join(directory, 'fixture.json'), 'utf8'));
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
if (mode === 'auth') {
  send({ loggedIn: config.auth !== false, authMethod: 'claude.ai', secret: 'DO_NOT_PERSIST_AUTH_RESPONSE' });
  process.exit(config.auth === false ? 1 : 0);
}
if (mode === 'login') {
  fs.writeFileSync(path.join(directory, 'login-observed.json'), JSON.stringify({ directory, keyPresent: Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY) }));
  process.exit(0);
}
let model, effort, prompt, phase;
const trace = data => fs.appendFileSync('account-trace.jsonl', JSON.stringify({ profile: path.basename(directory), pid: process.pid, ...data }) + '\n');
const done = error => provider === 'codex'
  ? send({ method: 'turn/completed', params: { turn: { id: 'turn', status: error ? 'failed' : 'completed', error } } })
  : send({ type: 'result', is_error: Boolean(error), result: error?.message ?? 'Done.' });
const save = status => fs.writeFileSync(checkpoint, JSON.stringify({ ...emptyCheckpoint(), status,
  completed: ['Implemented partial account work.'], decisions: ['Keep the partial work.'], currentActivity: 'Account transition test.',
  nextSteps: status === 'complete' ? [] : ['Finish partial account work without restarting.'] }));
function complete() {
  fs.writeFileSync('restored.txt', 'Account handoff completed.'); save('complete'); done();
}
function work(text) {
  prompt = text; trace({ event: 'turn', prompt, model, effort });
  if (config.scenario === 'hang') return;
  if (config.scenario === 'error') { done({ message: 'Sandbox setup failed.', codexErrorInfo: 'sandboxError' }); return; }
  if (config.scenario === 'destination') {
    if (!prompt.includes('Finish partial account work without restarting.') || !prompt.includes('Preserve my clarification.') || !fs.existsSync('partial.txt')) {
      done({ message: 'Missing saved context or files.' }); return;
    }
    if (config.interactive) {
      phase = 'approval';
      if (provider === 'codex') send({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { command: 'verify preserved files' } });
      else send({ type: 'control_request', request_id: 'approval', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'verify preserved files' } } });
      return;
    }
    complete(); return;
  }
  if (config.scenario === 'success') { done(); return; }
  fs.writeFileSync('partial.txt', 'work saved before quota'); save('in_progress');
  if (provider === 'codex') send({ method: 'item/started', params: { item: { id: 'pending', type: 'commandExecution', command: 'external action with uncertain outcome' } } });
  else send({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'pending', name: 'Bash', input: { command: 'external action with uncertain outcome' } }] } });
  if (config.scenario === 'threshold') {
    if (provider === 'codex') send({ method: 'account/rateLimits/updated', params: { rateLimits: { primary: { usedPercent: 90, resetsAt: Date.now() / 1000 + 600 } } } });
    else send({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', utilization: 0.9, rateLimitType: 'five_hour', resetsAt: Date.now() / 1000 + 600 } });
  } else if (provider === 'codex') done({ message: 'Quota exhausted.', codexErrorInfo: 'usageLimitExceeded' });
  else send({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: Date.now() / 1000 + 600 } });
}
trace({ event: 'spawn' });
readline.createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (phase === 'approval' && (message.id === 'approval' || message.response?.request_id === 'approval')) {
    const approved = provider === 'codex' ? message.result?.decision === 'accept' : message.response?.response?.behavior === 'allow';
    trace({ event: 'approval', approved }); phase = null;
    if (approved) complete(); else done({ message: 'Expected user approval after account switch.' });
    return;
  }
  if (provider === 'claude') {
    if (message.type === 'control_request') send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: {} } });
    if (message.type === 'user') {
      if (message.message.content.startsWith('Goddard checkpoint request')) { save('in_progress'); done(); done(); }
      else work(message.message.content);
    }
    return;
  }
  if (!message.method || message.id == null) return;
  const reply = result => send({ id: message.id, result });
  switch (message.method) {
    case 'initialize': reply({}); break;
    case 'account/read': reply({ account: config.auth === false ? null : { type: 'chatgpt' }, requiresOpenaiAuth: true }); break;
    case 'account/rateLimits/read': reply({ rateLimits: { primary: { usedPercent: config.quota ?? 10, resetsAt: Date.now() / 1000 + 600 } } }); break;
    case 'thread/start': model = message.params.model; reply({ thread: { id: `session-${path.basename(directory)}` } }); break;
    case 'turn/start': effort = message.params.effort; reply({ turn: { id: 'turn' } }); setTimeout(() => work(message.params.input[0].text), 20); break;
    case 'turn/steer': reply({}); save('in_progress'); done(); break;
    case 'turn/interrupt': reply({}); break;
    default: send({ id: message.id, error: { message: 'Unsupported method' } });
  }
});

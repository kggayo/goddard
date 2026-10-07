import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { emptyCheckpoint } from '../../src/checkpoint.js';

const [provider, scenario, checkpoint] = process.argv.slice(2);
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const save = status => {
  const value = { ...emptyCheckpoint(), status, currentActivity: status === 'complete' ? 'Verified the restored work.' : 'Editing partial.txt.',
    completed: ['Created partial.txt'], decisions: ['Preserve the partial implementation.'], nextSteps: status === 'complete' ? [] : ['Finish the pending implementation in restored.txt.'] };
  fs.writeFileSync(checkpoint, JSON.stringify(value));
};
function work(prompt) {
  if (scenario === 'hang') return;
  if (scenario === 'destination') {
    if (!prompt.includes('Finish the pending implementation in restored.txt.') || !fs.existsSync('partial.txt')) {
      send({ type: 'result', is_error: true, errors: ['Missing handoff context or source changes.'] }); return;
    }
    fs.writeFileSync('restored.txt', 'completed from handoff\n'); save('complete');
    send({ type: 'assistant', session_id: 'claude-destination', message: { content: [{ type: 'text', text: 'Continued from the saved next step.' }] } });
    send({ type: 'result', session_id: 'claude-destination', is_error: false, result: 'Done.' }); return;
  }
  if (scenario === 'rejected') {
    send({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' } }); return;
  }
  fs.writeFileSync('partial.txt', 'work survives the source agent\n'); save('in_progress');
  send({ method: 'item/completed', params: { item: { id: 'tool-1', type: 'commandExecution', command: 'write partial.txt', status: 'completed', exitCode: 0 } } });
  send({ method: 'item/reasoning/textDelta', params: { delta: 'MUST_NOT_BE_STORED' } });
  if (scenario === 'abrupt') {
    setTimeout(() => {
      fs.writeFileSync(checkpoint, '{"schemaVersion":');
      send({ method: 'item/started', params: { item: { id: 'pending-2', type: 'commandExecution', command: 'external action with unknown result' } } });
      process.exit(9);
    }, 1600);
  } else send({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } });
}
readline.createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (provider === 'claude') {
    if (message.type === 'control_request') send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: {} } });
    if (message.type === 'user') work(message.message.content);
    return;
  }
  if (!message.method || message.id == null) return;
  const respond = result => send({ id: message.id, result });
  switch (message.method) {
    case 'initialize': respond({ userAgent: 'fixture' }); break;
    case 'account/rateLimits/read': respond({ rateLimitsByLimitId: { codex: { primary: { usedPercent: scenario === 'high-usage' ? 95 : 10, resetsAt: Math.floor(Date.now() / 1000) + 3600 } } } }); break;
    case 'thread/start':
      if (!['read-only', 'workspace-write'].includes(message.params.sandbox)) { send({ id: message.id, error: { message: 'Invalid sandbox mode' } }); break; }
      respond({ thread: { id: 'codex-source' } }); break;
    case 'turn/start': respond({ turn: { id: 'turn-1' } }); setTimeout(() => work(message.params.input[0].text), 50); break;
    case 'turn/steer': respond({ turnId: 'turn-1' });
      if (scenario === 'hang') { save('in_progress'); send({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } }); }
      break;
    case 'turn/interrupt': respond({}); send({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'interrupted' } } }); break;
    default: send({ id: message.id, error: { message: 'Unsupported fixture method' } });
  }
});

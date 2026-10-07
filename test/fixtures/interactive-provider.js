import fs from 'node:fs';
import readline from 'node:readline';

const [provider, scenario] = process.argv.slice(2);
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
let turns = 0;
function done() {
  send(provider === 'codex' ? { method: 'turn/completed', params: { turn: { id: `turn-${turns}`, status: 'completed' } } } : { type: 'result', is_error: false, result: 'Done' });
}
function ask() {
  if (turns > 1) { done(); return; }
  const text = '## Progress\n\n**Saved** the checkpoint.\n\n```js\nconst ready = true;\n```';
  send(provider === 'codex' ? { method: 'item/completed', params: { item: { type: 'agentMessage', text } } } : { type: 'assistant', message: { content: [{ type: 'text', text }] } });
  if (provider === 'codex') send({ id: 'question', method: 'item/tool/requestUserInput', params: { questions: [{ id: 'color', question: 'Which color?', options: [{ label: 'Blue', description: 'Cool' }, { label: 'Red', description: 'Warm' }] }] } });
  else send({ type: 'control_request', request_id: 'question', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions: [{ question: 'Which color?', options: [{ label: 'Blue' }, { label: 'Red' }] }] } } });
  if (scenario === 'cancel') setTimeout(() => {
    send(provider === 'codex' ? { method: 'serverRequest/resolved', params: { requestId: 'question' } } : { type: 'control_cancel_request', request_id: 'question' });
    done();
  }, 50);
}
function receiveAnswer(id, value) {
  fs.appendFileSync('answers.jsonl', JSON.stringify({ id, value }) + '\n');
  if (id === 'question') {
    if (provider === 'codex') send({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { command: 'npm test', cwd: process.cwd(), reason: 'Verify the implementation', availableDecisions: ['accept', 'decline'] } });
    else send({ type: 'control_request', request_id: 'approval', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'npm test' } } });
  } else done();
}
readline.createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  if (provider === 'claude') {
    if (m.type === 'control_request') send({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: {} } });
    if (m.type === 'user') { turns++; fs.appendFileSync('prompts.jsonl', JSON.stringify(m.message.content) + '\n'); ask(); }
    if (m.type === 'control_response') receiveAnswer(m.response.request_id, m.response.response);
    return;
  }
  const reply = value => send({ id: m.id, result: value });
  if (!m.method) { receiveAnswer(m.id, m.result); return; }
  if (m.method === 'initialize') reply({});
  if (m.method === 'account/rateLimits/read') reply({});
  if (m.method === 'thread/start') { fs.writeFileSync('thread.json', JSON.stringify(m.params)); reply({ thread: { id: 'interactive' } }); }
  if (m.method === 'turn/start') {
    turns++; fs.appendFileSync('prompts.jsonl', JSON.stringify(m.params) + '\n'); reply({ turn: { id: `turn-${turns}` } }); setTimeout(ask, 10);
  }
  if (m.method === 'turn/steer') reply({});
  if (m.method === 'turn/interrupt') { reply({}); done(); }
});

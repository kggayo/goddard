import { EventEmitter } from 'node:events';
import { Transport, Rpc } from './transport.js';
import { executable } from '../util.js';
import { codexUsage } from '../usage.js';
import { requestUser, cancelRequests } from './requests.js';

export class CodexAdapter extends EventEmitter {
  constructor({ workspace, model, effort, interactive = false, readOnly = false, binary, env, args = ['app-server', '--listen', 'stdio://'] }) {
    super(); Object.assign(this, { workspace, model, effort, interactive, readOnly, binary, args, env }); this.fileChanges = new Map();
  }
  async connect() {
    this.transport = new Transport(this.binary ?? executable('codex'), this.args, this.workspace, this.env);
    this.rpc = new Rpc(this.transport);
    this.emit('spawn', this.transport.child.pid);
    this.transport.on('fault', error => this.emit('fault', error));
    this.transport.on('gap', detail => this.emit('evidence', 'stream.gap', detail));
    this.transport.on('stderr', text => this.emit('evidence', 'agent.stderr', { text }));
    this.transport.on('close', result => { cancelRequests(this); this.emit('exit', result); });
    this.transport.on('message', message => this.onMessage(message));
    const info = await this.rpc.request('initialize', { clientInfo: { name: 'goddard', title: 'Goddard', version: '0.3.0' }, capabilities: { experimentalApi: true } });
    this.transport.send({ method: 'initialized', params: {} });
    this.emit('evidence', 'provider.connected', { provider: 'codex', info });
    return this.readUsage();
  }
  async readUsage() {
    try {
      const result = await this.rpc.request('account/rateLimits/read');
      const windows = codexUsage(result); this.emit('usage', windows); return windows;
    } catch (error) { this.emit('evidence', 'usage.unavailable', { message: error.message }); return []; }
  }
  async startTask(prompt) {
    const params = { cwd: this.workspace, approvalPolicy: this.interactive && !this.readOnly ? 'on-request' : 'never', sandbox: this.readOnly ? 'read-only' : 'workspace-write' };
    if (this.model) params.model = this.model;
    const result = await this.rpc.request('thread/start', params);
    this.thread = result.thread.id; this.emit('session', this.thread);
    await this.sendPrompt(prompt);
  }
  async sendPrompt(prompt) {
    const turn = await this.rpc.request('turn/start', { threadId: this.thread, input: [{ type: 'text', text: prompt }], ...(this.effort ? { effort: this.effort } : {}) });
    this.turn = turn.turn.id;
  }
  async requestCheckpoint(prompt) {
    if (!this.thread || !this.turn) throw new Error('No active turn to checkpoint.');
    await this.rpc.request('turn/steer', { threadId: this.thread, expectedTurnId: this.turn, input: [{ type: 'text', text: prompt }] });
  }
  async interrupt() {
    if (this.thread && this.turn && !this.transport.closed) await this.rpc.request('turn/interrupt', { threadId: this.thread, turnId: this.turn });
  }
  async close() { cancelRequests(this); await this.transport?.stop(); }
  onMessage(message) {
    const { method, params: p = {} } = message;
    if (!method) return;
    if (message.id != null) {
      const reply = result => this.transport.send({ id: message.id, result });
      if (method === 'item/tool/requestUserInput') {
        requestUser(this, message.id, { kind: 'question', title: 'Codex has a question', questions: p.questions }, answers =>
          reply({ answers: Object.fromEntries(Object.entries(answers ?? {}).map(([key, value]) => [key, { answers: value }])) }));
      } else if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(method)) {
        if (this.readOnly || (p.availableDecisions && !p.availableDecisions.includes('accept'))) {
          this.emit('evidence', 'interaction.unavailable', { method, reason: this.readOnly ? 'Read-only mode disallows permission escalation.' : 'The provider did not offer approval for this request.' });
          reply({ decision: 'decline' });
        }
        else requestUser(this, message.id, { kind: 'approval', title: `Codex: ${method}`, detail: { ...p, ...(this.fileChanges.has(p.itemId) ? { changes: this.fileChanges.get(p.itemId) } : {}) } }, allowed =>
          reply({ decision: allowed === true ? 'accept' : 'decline' }));
      } else if (method === 'item/permissions/requestApproval') {
        if (this.readOnly) reply({ permissions: {}, scope: 'turn' });
        else requestUser(this, message.id, { kind: 'approval', title: 'Codex requests additional permissions for this turn', detail: p }, allowed => reply({ permissions: allowed === true ? p.permissions : {}, scope: 'turn' }));
      } else {
        this.emit('evidence', 'interaction.unsupported', { method });
        this.transport.send({ id: message.id, error: { code: -32601, message: 'This interactive request type is not supported by Goddard.' } });
      }
      return;
    }
    if (method === 'serverRequest/resolved') cancelRequests(this, p.requestId);
    if (method === 'account/rateLimits/updated') this.emit('usage', codexUsage(p));
    if (method === 'turn/started') this.turn = p.turn.id;
    if (method === 'turn/completed') { this.turn = null; cancelRequests(this);
      const limited = ['usageLimitExceeded', 'rateLimitExceeded'].includes(p.turn.error?.codexErrorInfo);
      this.emit('done', { status: limited ? 'limited' : p.turn.status === 'completed' ? 'finished' : p.turn.status === 'interrupted' ? 'interrupted' : 'failed', error: p.turn.error,
      ...(p.turn.error?.message ? { reason: p.turn.error.message } : {}) }); }
    if (method === 'item/started' || method === 'item/completed') {
      const item = p.item;
      if (!item || /reasoning/i.test(item.type) || item.type === 'userMessage') return;
      if (item.type === 'fileChange' && method === 'item/started') this.fileChanges.set(item.id, item.changes);
      if (method === 'item/completed') this.fileChanges.delete(item.id);
      if (item.type === 'agentMessage') {
        if (method === 'item/completed') this.emit('evidence', 'agent.message', { text: item.text });
      } else this.emit('evidence', method === 'item/started' ? 'tool.started' : 'tool.completed', item);
    }
    if (method === 'item/commandExecution/outputDelta') this.emit('evidence', 'tool.output', { itemId: p.itemId, text: p.delta });
    if (method === 'error') this.emit('evidence', 'provider.error', p);
    if (method === 'thread/tokenUsage/updated') this.emit('evidence', 'tokens.observed', p);
  }
}

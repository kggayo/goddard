import { EventEmitter } from 'node:events';
import { Transport } from './transport.js';
import { executable, id } from '../util.js';
import { requestUser, cancelRequests } from './requests.js';
import { resolvePermissions } from '../permissions.js';

export function claudeArgs({ model, effort, readOnly, bypassPermissions, claudePermissionMode, allowedTools = [] }) {
  const permissions = resolvePermissions({ provider: 'claude', readOnly, bypassPermissions, claudePermissionMode });
  return ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio',
    '--permission-mode', readOnly ? 'plan' : permissions.claudePermissionMode,
    ...allowedTools.flatMap(tool => ['--allowedTools', tool]), ...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : [])];
}

export function claudeEnv(effort, base = process.env) {
  if (!effort) return base;
  const env = { ...base };
  // Let the explicit per-run --effort override an inherited effort setting.
  for (const key of Object.keys(env)) if (key.toUpperCase() === 'CLAUDE_CODE_EFFORT_LEVEL') delete env[key];
  return env;
}

export class ClaudeAdapter extends EventEmitter {
  constructor({ workspace, model, effort, readOnly = false, bypassPermissions = false, claudePermissionMode, allowedTools = [], binary, args, env }) {
    super(); Object.assign(this, { workspace, model, effort, readOnly, allowedTools, binary, args, env },
      resolvePermissions({ provider: 'claude', readOnly, bypassPermissions, claudePermissionMode }));
    this.pendingPrompts = new Set(); this.hasMessageAttribution = false;
    this.windows = new Map();
  }
  async connect() {
    const args = this.args ?? claudeArgs(this);
    this.transport = new Transport(this.binary ?? executable('claude'), args, this.workspace, claudeEnv(this.effort, this.env));
    this.emit('spawn', this.transport.child.pid);
    this.transport.on('fault', error => this.emit('fault', error));
    this.transport.on('gap', detail => this.emit('evidence', 'stream.gap', detail));
    this.transport.on('stderr', text => this.emit('evidence', 'agent.stderr', { text }));
    this.transport.on('close', result => { this.initializeReject?.(new Error('Claude exited before initialization.')); cancelRequests(this); this.emit('exit', result); });
    this.transport.on('message', message => this.onMessage(message));
    let timer;
    try {
      await new Promise((resolve, reject) => {
        this.initializeResolve = resolve; this.initializeReject = reject;
        timer = setTimeout(() => reject(new Error('Claude control initialization timed out.')), 30000);
        this.transport.send({ type: 'control_request', request_id: 'goddard-init', request: { subtype: 'initialize', hooks: null } });
      });
    } finally { clearTimeout(timer); this.initializeResolve = null; this.initializeReject = null; }
    return [];
  }
  async startTask(prompt) { this.sendPrompt(prompt); }
  sendPrompt(prompt) {
    const uuid = id();
    this.pendingPrompts.add(uuid);
    try {
      this.transport.send({ type: 'user', uuid, message: { role: 'user', content: prompt }, parent_tool_use_id: null, session_id: this.session ?? '' });
    } catch (error) { this.pendingPrompts.delete(uuid); throw error; }
  }
  async requestCheckpoint(prompt) { this.sendPrompt(prompt); }
  async interrupt() { await this.close(); }
  async close() { cancelRequests(this); await this.transport?.stop(); }
  onMessage(message) {
    const answeredIds = [...new Set([message.user_message_uuid, ...(Array.isArray(message.user_message_uuids) ? message.user_message_uuids : [])]
      .filter(value => typeof value === 'string' && value))];
    if (answeredIds.some(uuid => this.pendingPrompts.has(uuid))) this.hasMessageAttribution = true;
    if (message.type === 'control_response' && message.response?.request_id === 'goddard-init') {
      if (message.response.subtype === 'error') this.initializeReject?.(new Error(message.response.error));
      else this.initializeResolve?.(message.response.response);
      return;
    }
    if (message.type === 'control_cancel_request') { cancelRequests(this, message.request_id); return; }
    if (message.type === 'control_request') {
      const request = message.request ?? {};
      const reply = response => this.transport.send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response } });
      const deny = { behavior: 'deny', message: 'Permission or input was not granted in Goddard.' };
      if (request.subtype !== 'can_use_tool') {
        this.emit('evidence', 'interaction.unsupported', { subtype: request.subtype });
        this.transport.send({ type: 'control_response', response: { subtype: 'error', request_id: message.request_id, error: 'This control request type is not supported by Goddard.' } });
      } else if (request.tool_name === 'AskUserQuestion') {
        const questions = (request.input?.questions ?? []).map(q => ({ ...q, id: q.question }));
        requestUser(this, message.request_id, { kind: 'question', title: 'Claude has a question', questions }, answers => reply(answers ? {
          behavior: 'allow', updatedInput: { ...request.input, answers: Object.fromEntries(Object.entries(answers).map(([key, values]) => [key, values.join(', ')])) }
        } : deny));
      } else if (this.readOnly) reply(deny);
      else requestUser(this, message.request_id, { kind: 'approval', title: `Claude requests ${request.tool_name}`, detail: request }, allowed =>
        reply(allowed === true ? { behavior: 'allow', updatedInput: request.input } : deny));
      return;
    }
    if (message.session_id && message.session_id !== this.session) { this.session = message.session_id; this.emit('session', this.session); }
    if (message.type === 'rate_limit_event') {
      const info = message.rate_limit_info ?? {};
      this.emit('evidence', 'usage.provider', info);
      if (typeof info.utilization === 'number' && Number.isFinite(info.utilization)) {
        const window = info.rateLimitType ?? 'unknown';
        this.windows.set(window, { bucket: 'claude', window, usedPercent: info.utilization * 100, resetsAt: info.resetsAt ?? null, observedAt: Date.now() });
        this.emit('usage', [...this.windows.values()]);
      }
      if (info.status === 'rejected') this.emit('limited', { message: 'Claude reported a rejected quota window.', info });
      if (info.status === 'allowed_warning') this.emit('warning', { message: 'Claude reported a usage warning.', info });
    }
    if (message.type === 'assistant' || message.type === 'user') {
      for (const block of Array.isArray(message.message?.content) ? message.message.content : []) {
        if (block.type === 'text' && message.type === 'assistant') this.emit('evidence', 'agent.message', { text: block.text });
        if (block.type === 'tool_use') this.emit('evidence', 'tool.started', { id: block.id, name: block.name, input: block.input });
        if (block.type === 'tool_result') this.emit('evidence', 'tool.completed', { id: block.tool_use_id, result: block.content, isError: block.is_error });
      }
    }
    if (message.type === 'result') {
      if (message.is_error) this.initializeReject?.(new Error(message.result ?? message.errors?.join('; ') ?? 'Claude initialization failed.'));
      // Claude can consume the task and several checkpoint prompts in one turn.
      // Retire every echoed message, not one counter entry per result. Unrelated
      // background/duplicate results must not consume a later user message.
      let answered = false;
      for (const uuid of answeredIds) if (this.pendingPrompts.delete(uuid)) answered = true;
      if (!answeredIds.length && !this.hasMessageAttribution && (!message.origin || message.origin.kind === 'human')) {
        const oldest = this.pendingPrompts.values().next().value;
        if (oldest) { this.pendingPrompts.delete(oldest); answered = true; }
      }
      this.emit('evidence', 'provider.result', { subtype: message.subtype, isError: message.is_error,
        errors: message.errors, result: message.result, usage: message.usage, permissionDenials: message.permission_denials,
        userMessageIds: answeredIds, pendingMessages: this.pendingPrompts.size });
      if (message.is_error || (answered && this.pendingPrompts.size === 0)) this.emit('done', { status: message.is_error ? 'failed' : 'finished',
        ...(message.is_error ? { reason: message.result ?? message.errors?.join('; ') ?? 'Claude returned an error.' } : {}) });
    }
    if (message.type === 'system') this.emit('evidence', 'provider.system', { subtype: message.subtype, message: message.message });
  }
}

import readline from 'node:readline';
import { TerminalDisplay } from './terminal.js';

export class Interaction {
  constructor({ input = process.stdin, display, output = display?.output ?? process.stdout, plain = false, noColor = false } = {}) {
    this.output = output;
    this.display = display ?? new TerminalDisplay({ output, plain, noColor });
    this.queue = Promise.resolve();
    this.closed = false;
    this.reader = readline.createInterface({ input, output, terminal: Boolean(input.isTTY && output.isTTY) });
    this.reader.on('line', line => this.pending?.(line));
    this.reader.on('close', () => { this.closed = true; this.pending?.(null); });
    this.reader.on('SIGINT', () => process.emit('SIGINT'));
  }
  log(text) { this.display.text(text); }
  ask(prompt, signal) {
    if (this.closed || signal?.aborted) return Promise.resolve(null);
    return new Promise(resolve => {
      const complete = value => {
        this.pending = null; signal?.removeEventListener('abort', abort);
        if (value === null) this.output.write('\n');
        this.display.release(); resolve(value);
      };
      const abort = () => complete(null);
      this.pending = complete;
      signal?.addEventListener('abort', abort, { once: true });
      this.display.hold();
      this.reader.setPrompt(this.display.prompt(prompt));
      this.reader.prompt();
    });
  }
  request(request) {
    const next = this.queue.then(() => this.handle(request));
    this.queue = next.catch(() => {});
    return next;
  }
  async handle({ kind, title, detail, questions = [], signal }) {
    if (this.closed || signal?.aborted) return null;
    if (kind === 'followup') return this.ask('\nYou (Enter or /done to save and exit): ', signal);
    this.display.question(title, kind);
    if (detail) this.display.detail(detail);
    if (kind === 'approval') return /^y(?:es)?$/i.test((await this.ask('Allow this request? [y/N] ', signal))?.trim() ?? '');
    const answers = {};
    for (const q of questions) {
      if (q.isSecret) { this.log('Secret input is unsupported in Goddard. This question will be left unanswered.'); return null; }
      this.log(q.question);
      const choices = q.options ?? [];
      choices.forEach((choice, i) => this.log(`  ${i + 1}. ${choice.label}${choice.description ? ` — ${choice.description}` : ''}`));
      const answer = await this.ask(q.multiSelect ? 'Answer (comma-separated numbers, or text; /cancel to skip): ' : 'Answer (number or text; /cancel to skip): ', signal);
      if (answer === null || answer.trim() === '/cancel' || !answer.trim()) return null;
      const values = q.multiSelect ? answer.split(',').map(value => value.trim()) : [answer.trim()];
      answers[q.id] = values.map(value => /^\d+$/.test(value) && choices[Number(value) - 1] ? choices[Number(value) - 1].label : value);
    }
    return answers;
  }
  close() { this.pending?.(null); this.reader.close(); }
}

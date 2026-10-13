import { createInputReader } from './input.js';
import { TerminalDisplay } from './terminal.js';
import { checkImageLimits, readClipboardImage, readImage } from './images.js';

export class Interaction {
  constructor({ input = process.stdin, display, output = display?.output ?? process.stdout, plain = false, noColor = false,
    workspace = process.cwd(), existingImages = () => [], clipboard = readClipboardImage } = {}) {
    Object.assign(this, { workspace, existingImages, clipboard });
    this.output = output;
    this.display = display ?? new TerminalDisplay({ output, plain, noColor });
    this.queue = Promise.resolve();
    this.closed = false;
    this.reader = createInputReader(input, output);
    this.reader.on('line', line => {
      if (this.pending) this.pending(line);
      else if (line.trim()) this.display.status('Input was not sent. Wait for the You prompt to send a follow-up, or answer an active question or approval prompt.');
    });
    this.reader.on('close', () => { this.closed = true; this.pending?.(null); });
    this.reader.on('SIGINT', () => process.emit('SIGINT'));
    this.reader.on('pasteImage', () => {
      if (this.imagePrompt && this.pending) this.pending({ clipboard: true, draft: this.reader.line, cursor: this.reader.cursor });
      else this.display.status('Attach images at the You prompt using /image PATH or /paste.');
    });
  }
  log(text) { this.display.text(text); }
  ask(prompt, signal, { images = false, draft = '', cursor } = {}) {
    if (this.closed || signal?.aborted) return Promise.resolve(null);
    if (this.reader.terminal && !this.inputHintShown) {
      this.display.status('Enter submits; Ctrl+J or \\ then Enter adds a newline. Pasted text waits for Enter.');
      this.inputHintShown = true;
    }
    return new Promise(resolve => {
      this.reader.reset?.();
      this.imagePrompt = images;
      const complete = value => {
        this.pending = null; this.imagePrompt = false; signal?.removeEventListener('abort', abort);
        if (typeof value !== 'string') { this.reader.reset?.(); this.output.write('\n'); }
        this.display.release(); resolve(value);
      };
      const abort = () => complete(null);
      this.pending = complete;
      signal?.addEventListener('abort', abort, { once: true });
      this.display.hold();
      this.reader.setPrompt(this.display.prompt(prompt));
      this.reader.prompt();
      if (draft) { this.reader.insert?.(draft); if (cursor !== undefined) this.reader.moveTo?.(cursor); }
    });
  }
  request(request) {
    const next = this.queue.then(() => this.handle(request));
    this.queue = next.catch(() => {});
    return next;
  }
  async handle({ kind, title, detail, questions = [], signal }) {
    if (this.closed || signal?.aborted) return null;
    if (kind === 'followup') return this.followup(signal);
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
      const values = answer.includes('\n') ? [answer] : q.multiSelect ? answer.split(',').map(value => value.trim()) : [answer.trim()];
      answers[q.id] = values.map(value => /^\d+$/.test(value) && choices[Number(value) - 1] ? choices[Number(value) - 1].label : value);
    }
    return answers;
  }
  async followup(signal) {
    const images = [];
    let draft = '', cursor;
    if (!this.imageHintShown) {
      this.display.status('Images: /image PATH attaches a file; /paste or Alt+V pastes a Windows clipboard image. /images lists pending attachments; /remove-image N removes one.');
      this.imageHintShown = true;
    }
    while (!this.closed && !signal?.aborted) {
      const hint = images.length ? `${images.length} image(s); Enter sends; /done saves and exits` : 'Enter or /done to save and exit';
      const answer = await this.ask(`\nYou (${hint}): `, signal, { images: true, draft, cursor });
      if (answer === null || answer?.trim?.() === '/done') return answer;
      const shortcut = typeof answer === 'object' && answer.clipboard;
      draft = shortcut ? answer.draft : ''; cursor = shortcut ? answer.cursor : undefined;
      const text = shortcut ? '/paste' : answer.trim();
      if (text === '/images') {
        this.display.status(images.length ? images.map((image, i) => `${i + 1}. ${image.name}`).join('\n') : 'No pending images.');
        continue;
      }
      if (/^\/remove-image(?:\s|$)/.test(text)) {
        const number = text.slice('/remove-image'.length).trim();
        if (/^[1-9]\d*$/.test(number) && images[Number(number) - 1]) {
          const [image] = images.splice(Number(number) - 1, 1); this.display.status(`Removed ${image.name}.`);
        } else this.display.status('Use /remove-image N with a number from /images.');
        continue;
      }
      if (text === '/paste' || /^\/image(?:\s|$)/.test(text)) {
        try {
          const image = text === '/paste' ? await this.clipboard({ signal }) : readImage(text.slice(6).trim(), this.workspace);
          if (this.closed || signal?.aborted) return null;
          checkImageLimits([...this.existingImages(), ...images, image]);
          if (images.some(item => item.hash === image.hash)) this.display.status('That image is already attached.');
          else { images.push(image); this.display.status(`Attached image ${images.length}: ${image.name}. Type your message and press Enter to send.`); }
        } catch (error) { if (!this.closed && !signal?.aborted) this.display.status(error.message); }
        continue;
      }
      return images.length ? { text: answer, images } : answer;
    }
    return null;
  }
  close() { this.pending?.(null); this.reader.close(); }
}

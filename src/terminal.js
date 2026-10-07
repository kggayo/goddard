import { stripVTControlCharacters } from 'node:util';
import { Lexer } from 'marked';
import hljs from 'highlight.js';
import wrapAnsi from 'wrap-ansi';
import stringWidth from 'string-width';

// Provider text is data. Only this renderer may introduce terminal controls.
export const terminalText = value => stripVTControlCharacters(String(value ?? '').replace(/\r\n?/g, '\n'))
  .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '');
const reset = '\x1b[0m';
const palette = { heading: '1;36', bold: '1', italic: '3', strike: '9', code: '33', muted: '90', link: '4;36',
  codex: '1;36', claude: '1;35', user: '1;32', status: '90', question: '1;33',
  keyword: '35', string: '32', number: '33', comment: '90', title: '36', attr: '36', literal: '33',
  addition: '32', deletion: '31', meta: '36' };
const indent = (text, prefix) => text.split('\n').map(line => prefix + line).join('\n');

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return terminalText(text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (!entity.startsWith('#')) return named[entity.toLowerCase()];
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  }));
}

export class TerminalRenderer {
  constructor({ output = process.stdout, plain = false, noColor = false, env = process.env } = {}) {
    this.output = output;
    this.rich = Boolean(output.isTTY && env.TERM !== 'dumb' && !plain);
    this.color = this.rich && !noColor && !env.NO_COLOR && env.NODE_DISABLE_COLORS !== '1';
  }
  get width() { return Math.max(10, Math.min(120, this.output.columns || 80)); }
  paint(style, text) {
    if (!this.color || !text) return text;
    const start = `\x1b[${palette[style] ?? palette.code}m`;
    return start + text.replaceAll(reset, reset + start) + reset;
  }
  wrap(text, width = this.width) { return wrapAnsi(text, Math.max(1, width), { hard: true, trim: false }); }
  label(name, style = 'status') { return this.paint(style, `${terminalText(name)} >`); }
  markdown(value) {
    const text = terminalText(value);
    if (!this.rich) return text;
    // Very large or malformed messages remain readable without delaying handoff work.
    if (text.length > 100000) return text;
    try { return this.blocks(Lexer.lex(text, { gfm: true }), this.width).trimEnd(); }
    catch { return text; }
  }
  inline(tokens = []) {
    return tokens.map(token => {
      const child = () => this.inline(token.tokens ?? []);
      switch (token.type) {
        case 'strong': return this.paint('bold', child());
        case 'em': return this.paint('italic', child());
        case 'del': return this.paint('strike', child());
        case 'codespan': return this.paint('code', terminalText(token.text));
        case 'br': return '\n';
        case 'link': {
          const label = child(), href = decodeEntities(token.href ?? '');
          return this.paint('link', label) + (stripVTControlCharacters(label) === href ? '' : ` (${href})`);
        }
        case 'image': return `[Image: ${decodeEntities(token.text ?? '')}] (${decodeEntities(token.href ?? '')})`;
        case 'text': return token.tokens ? child() : decodeEntities(token.text ?? '').replace(/\n/g, ' ');
        default: return decodeEntities(token.text ?? token.raw ?? '');
      }
    }).join('');
  }
  blocks(tokens, width) {
    return tokens.map(token => {
      switch (token.type) {
        case 'space': return '';
        case 'def': case 'checkbox': return '';
        case 'heading': return this.wrap(this.paint('heading', this.inline(token.tokens)), width) + '\n\n';
        case 'paragraph': return this.wrap(this.inline(token.tokens), width) + '\n\n';
        case 'text': return this.wrap(token.tokens ? this.inline(token.tokens) : decodeEntities(token.text), width) + '\n';
        case 'code': return this.code(token.text, token.lang, width) + '\n\n';
        case 'blockquote': return indent(this.blocks(token.tokens, Math.max(1, width - 2)).trimEnd(), this.paint('muted', '│ ')) + '\n\n';
        case 'hr': return this.paint('muted', '─'.repeat(Math.min(width, 60))) + '\n\n';
        case 'list': return token.items.map((item, index) => {
          const prefix = item.task ? `[${item.checked ? 'x' : ' '}] ` : token.ordered ? `${Number(token.start) + index}. ` : '• ';
          const body = this.blocks(item.tokens, Math.max(1, width - prefix.length)).trimEnd().split('\n');
          return this.paint(item.task && item.checked ? 'addition' : 'muted', prefix) + body[0] +
            body.slice(1).map(line => '\n' + ' '.repeat(prefix.length) + line).join('');
        }).join('\n') + '\n\n';
        case 'table': return this.table(token, width) + '\n\n';
        default: return this.wrap(terminalText(token.text ?? token.raw ?? ''), width) + '\n';
      }
    }).join('');
  }
  table(token, width) {
    const rows = [token.header, ...token.rows].map(row => row.map(cell => this.inline(cell.tokens)));
    const columns = token.header.length, available = width - 3 * (columns - 1);
    if (available < columns * 6) {
      return rows.slice(1).map(row => row.map((cell, i) => this.wrap(`${this.paint('bold', rows[0][i])}: ${cell}`, width)).join('\n')).join('\n\n');
    }
    const widths = rows[0].map((_, index) => Math.max(1, ...rows.map(row => Math.max(...row[index].split('\n').map(line => stringWidth(line))))));
    while (widths.reduce((sum, value) => sum + value, 0) > available) {
      const largest = widths.indexOf(Math.max(...widths)); widths[largest]--;
    }
    const renderRow = (row, heading) => {
      const cells = row.map((cell, i) => this.wrap(cell, widths[i]).split('\n'));
      return Array.from({ length: Math.max(...cells.map(cell => cell.length)) }, (_, line) => cells.map((cell, i) => {
        const text = cell[line] ?? '', padding = ' '.repeat(Math.max(0, widths[i] - stringWidth(text)));
        const content = token.align[i] === 'right' ? padding + text : text + padding;
        return heading ? this.paint('bold', content) : content;
      }).join(this.paint('muted', ' │ '))).join('\n');
    };
    return [renderRow(rows[0], true), this.paint('muted', widths.map(size => '─'.repeat(size)).join('─┼─')),
      ...rows.slice(1).map(row => renderRow(row, false))].join('\n');
  }
  highlight(value, language = '') {
    const text = terminalText(value), lang = language.toLowerCase().split(/\s+/)[0];
    if (!this.color || text.length > 30000) return text;
    if (lang === 'diff' || lang === 'patch') return text.split('\n').map(line => {
      const style = /^(@@|diff |index |--- |\+\+\+ )/.test(line) ? 'meta' : line.startsWith('+') ? 'addition' : line.startsWith('-') ? 'deletion' : null;
      return style ? this.paint(style, line) : line;
    }).join('\n');
    if (!lang || !hljs.getLanguage(lang)) return text;
    try {
      // highlight.js's public HTML result contains escaped code and nested span tags.
      // Decode only text nodes once, so literal HTML/entities in code stay literal.
      const html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
      const stack = [];
      return [...html.matchAll(/<span class="([\w -]+)">|<\/span>|([^<]+)|</g)].map(match => {
        if (match[1]) { stack.push(match[1].replace(/^hljs-/, '').split(/[ _]/)[0]); return ''; }
        if (match[0] === '</span>') { stack.pop(); return ''; }
        const decoded = decodeEntities(match[3] ?? match[0]);
        return stack.length ? this.paint(stack.at(-1), decoded) : decoded;
      }).join('');
    } catch { return text; }
  }
  code(value, language = '', width = this.width) {
    const text = terminalText(value);
    if (!this.rich) return text;
    const lang = terminalText(language ?? '').split(/\s+/)[0] || 'code';
    const border = this.paint('muted', '│ ');
    // Keep code characters and indentation intact; the terminal handles long lines.
    return this.paint('muted', `┌ ${lang}`) + '\n' + indent(this.highlight(text, lang), border) + '\n' + this.paint('muted', '└' + '─'.repeat(Math.min(width - 1, 28)));
  }
  detail(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return this.rich && typeof value !== 'string' ? this.code(text, 'json') : terminalText(text);
  }
}

export class TerminalDisplay {
  constructor({ output = process.stdout, write, ...options } = {}) {
    this.renderer = new TerminalRenderer({ output, ...options });
    this.output = output;
    this.write = write ?? (text => output.write(text + '\n'));
    this.buffer = [];
  }
  emit(text) { if (this.held) this.buffer.push(text); else this.write(text); }
  hold() { this.held = true; }
  release() { this.held = false; for (const text of this.buffer.splice(0)) this.write(text); }
  status(text) { this.emit(`${this.renderer.label('Goddard')} ${terminalText(text)}`); }
  agent(provider, text) {
    const name = provider === 'claude' ? 'Claude' : 'Codex';
    this.emit(`\n${this.renderer.label(name, provider)}\n\n${this.renderer.markdown(text)}\n`);
  }
  question(title, kind = 'question') { this.emit(`\n${this.renderer.label(kind === 'approval' ? 'Approval' : 'Question', 'question')} ${terminalText(title)}`); }
  text(text) { this.emit(terminalText(text)); }
  detail(value) { this.emit(this.renderer.detail(value)); }
  prompt(text) { return this.renderer.paint('user', terminalText(text)); }
}

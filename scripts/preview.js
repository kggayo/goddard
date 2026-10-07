import { TerminalDisplay } from '../src/terminal.js';

// This is a display-only sample: no provider process, credentials, or model calls.
const display = new TerminalDisplay({ plain: process.argv.includes('--plain'), noColor: process.argv.includes('--no-color') });
display.status('Display preview · no model calls');
display.agent('codex', [
  '## Login callback updated',
  '',
  'The **expired-session** case now returns a useful message. The public API stays *unchanged*.',
  '',
  '- [x] Reproduce the failed callback',
  '- [x] Update `refreshSession()`',
  '- [ ] Run the integration tests',
  '',
  '```typescript',
  '// Handle an expired session before redirecting.',
  'export async function refreshSession(token: string) {',
  '  const session = await client.refresh(token);',
  '  return session ?? { error: "Session expired" };',
  '}',
  '```',
  '',
  '```diff',
  '--- a/auth.ts',
  '+++ b/auth.ts',
  '@@ -12,1 +12,1 @@',
  '-return session.user;',
  '+return session?.user ?? null;',
  '```',
  '',
  '| Check | Result |',
  '| --- | --- |',
  '| Unit tests | Passed |',
  '| Integration tests | Pending |',
  '',
  '> The checkpoint includes the remaining verification step.'
].join('\n'));
display.question('Claude requests a verification command', 'approval');
display.detail({ tool: 'Bash', input: { command: 'npm test' }, reason: 'Verify the callback before finishing.' });
display.text(display.renderer.color ? '' : 'Colors appear when this preview runs in a color-capable terminal.');
process.stdout.write(display.prompt('You (sample prompt): ') + 'Run the integration tests, then update the checkpoint.\n');

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { checkpointFile } from '../src/checkpoint.js';
import { supervise } from '../src/supervisor.js';
import { exportBundle } from '../src/handoff.js';
import { CodexAdapter } from '../src/adapters/codex.js';
import { ClaudeAdapter } from '../src/adapters/claude.js';
import { git } from '../src/workspace.js';

const workspace = path.resolve('.tmp', `demo-${Date.now()}`);
fs.mkdirSync(workspace, { recursive: true });
// A demo inside a cloned checkout must own its Git root, not capture the parent repository.
await git(workspace, ['init', '--quiet']);
fs.writeFileSync(path.join(workspace, '.gitignore'), '.goddard/\n');
const store = new Store(workspace, { create: true });
try {
  const task = store.createTask('Finish the pending implementation and verify it.');
  const fixture = fileURLToPath(new URL('../test/fixtures/provider.js', import.meta.url));
  const create = (Provider, provider, scenario) => new Provider({ workspace, binary: process.execPath, args: [fixture, provider, scenario, checkpointFile(store, task.id)] });
  console.log('Offline demonstration: simulated provider processes; no model calls or account usage.\n');
  const first = await supervise(store, task.id, { provider: 'codex', adapter: create(CodexAdapter, 'codex', 'abrupt'), snapshotSeconds: 1 });
  if (first.status !== 'interrupted') throw new Error('Expected the source to stop abruptly.');
  console.log('\nContinuing with the Claude adapter and saved handoff...\n');
  const second = await supervise(store, task.id, { provider: 'claude', adapter: create(ClaudeAdapter, 'claude', 'destination') });
  if (second.status !== 'finished' || !fs.existsSync(path.join(workspace, 'restored.txt'))) throw new Error('Recovery demonstration failed.');
  const output = path.join(store.root, 'demo-bundle.json');
  await exportBundle(store, task.id, output);
  console.log(`\nRecovered successfully.\nWorkspace: ${workspace}\nBundle: ${output}`);
} finally { store.close(); }

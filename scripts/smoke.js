// Explicit live smoke test. Uses the selected CLI's existing authentication and quota.
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.js';
import { supervise } from '../src/supervisor.js';
import { git } from '../src/workspace.js';

const provider = process.argv[2];
if (!['codex', 'claude'].includes(provider)) throw new Error('Usage: node scripts/smoke.js codex|claude');
const workspace = path.resolve('.tmp', `live-${provider}-${Date.now()}`);
fs.mkdirSync(workspace, { recursive: true });
await git(workspace, ['init', '--quiet']);
fs.writeFileSync(path.join(workspace, '.gitignore'), '.goddard/\n');
const store = new Store(workspace, { create: true });
try {
  const task = store.createTask('Create smoke.txt containing exactly GODDARD_OK followed by a newline. Verify it by reading the file. Update the Goddard checkpoint with the verification and set status complete. Only modify smoke.txt and the assigned checkpoint. Do not use subagents, install packages, or access the network.');
  const result = await supervise(store, task.id, { provider, maxSeconds: 90, graceSeconds: 10 });
  const file = path.join(workspace, 'smoke.txt');
  const verified = result.status === 'finished' && fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim() === 'GODDARD_OK' && store.latestCheckpoint(task.id)?.data.status === 'complete';
  console.log(JSON.stringify({ provider, result, verified, workspace }, null, 2));
  if (!verified) process.exitCode = 1;
} finally { store.close(); }

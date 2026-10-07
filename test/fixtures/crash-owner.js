import { Store } from '../../src/store.js';
const store = new Store(process.argv[2]);
const run = store.startRun(process.argv[3], 'codex');
store.event(run.task, run.id, 'tool.started', { command: 'unfinished operation' });
// Deliberately omit close and finalization to exercise WAL recovery.
process.exit(9);

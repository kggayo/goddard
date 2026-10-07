import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite, readJSON } from './util.js';

const lists = ['plan', 'completed', 'decisions', 'nextSteps', 'blockers', 'verification', 'uncertainOperations'];
export function validateCheckpoint(data) {
  if (JSON.stringify(data)?.length > 1024 * 1024) throw new Error('Checkpoint exceeds 1 MiB.');
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.schemaVersion !== 1) throw new Error('Checkpoint requires schemaVersion: 1.');
  if (typeof data.currentActivity !== 'string' || data.currentActivity.length > 20000) throw new Error('currentActivity must be a string of at most 20,000 characters.');
  for (const key of lists) {
    if (!Array.isArray(data[key]) || data[key].length > 100 || data[key].some(item => typeof item !== 'string' || item.length > 10000)) {
      throw new Error(`${key} must be an array of up to 100 strings (10,000 characters each).`);
    }
  }
  if (!['in_progress', 'blocked', 'complete'].includes(data.status)) throw new Error('Checkpoint status must be in_progress, blocked, or complete.');
  return { schemaVersion: 1, status: data.status, currentActivity: data.currentActivity,
    ...Object.fromEntries(lists.map(key => [key, data[key]])) };
}
export function emptyCheckpoint() {
  return { schemaVersion: 1, status: 'in_progress', currentActivity: 'Not started. Inspect the workspace and establish a plan.',
    plan: [], completed: [], decisions: [], nextSteps: ['Inspect the project and establish an implementation plan.'], blockers: [], verification: [], uncertainOperations: [] };
}
export function checkpointFile(store, task) { return path.join(store.taskDir(task), 'checkpoint.json'); }
export function seedCheckpoint(store, task) {
  atomicWrite(checkpointFile(store, task), JSON.stringify(store.latestCheckpoint(task)?.data ?? emptyCheckpoint(), null, 2) + '\n');
}
export function ingestCheckpoint(store, task) {
  const file = checkpointFile(store, task);
  if (!fs.existsSync(file)) return { accepted: false, reason: 'No agent checkpoint yet.' };
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Checkpoint must be a regular file smaller than 1 MiB.');
    const data = validateCheckpoint(readJSON(file));
    const previous = store.latestCheckpoint(task);
    const saved = store.checkpoint(task, data);
    return { accepted: true, changed: previous?.digest !== saved.digest, checkpoint: saved };
  } catch (error) { return { accepted: false, reason: error.message }; }
}

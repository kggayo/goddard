import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { atomicWrite, hash, id, isAlive, now, scrub } from './util.js';

export class Store {
  constructor(workspace, { create = false } = {}) {
    this.workspace = fs.realpathSync.native(workspace);
    this.root = path.join(this.workspace, '.goddard');
    if (!create && !fs.existsSync(path.join(this.root, 'state.sqlite'))) throw new Error('Workspace is not initialized. Run goddard init first.');
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(this.root).isSymbolicLink()) throw new Error('.goddard must not be a symlink.');
    this.db = new DatabaseSync(path.join(this.root, 'state.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, goal TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, task TEXT NOT NULL, run TEXT, at TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS checkpoints (seq INTEGER PRIMARY KEY AUTOINCREMENT, task TEXT NOT NULL, at TEXT NOT NULL, digest TEXT NOT NULL, data TEXT NOT NULL, event_seq INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshots (seq INTEGER PRIMARY KEY AUTOINCREMENT, task TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, task TEXT NOT NULL, provider TEXT NOT NULL, pid INTEGER NOT NULL, child_pid INTEGER, started TEXT NOT NULL, ended TEXT, status TEXT NOT NULL, session TEXT);
      CREATE INDEX IF NOT EXISTS events_task ON events(task, seq);
      CREATE INDEX IF NOT EXISTS checkpoints_task ON checkpoints(task, seq);
      CREATE INDEX IF NOT EXISTS snapshots_task ON snapshots(task, seq);`);
  }
  close() { this.db.close(); }
  taskDir(task) { this.task(task); return path.join(this.root, 'tasks', task); }
  createTask(goal) {
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 100000) throw new Error('Goal must be nonempty and at most 100,000 characters.');
    const task = { id: id(), goal: goal.trim(), created: now() };
    this.db.prepare('INSERT INTO tasks VALUES (?, ?, ?)').run(task.id, task.goal, task.created);
    fs.mkdirSync(this.taskDir(task.id), { recursive: true });
    this.event(task.id, null, 'task.created', { goal: task.goal });
    return task;
  }
  task(task) {
    const value = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(task);
    if (!value) throw new Error(`Unknown task: ${task}`);
    return value;
  }
  tasks() { return this.db.prepare('SELECT * FROM tasks ORDER BY created DESC').all(); }
  event(task, run, type, payload) {
    return Number(this.db.prepare('INSERT INTO events(task, run, at, type, payload) VALUES (?, ?, ?, ?, ?)')
      .run(task, run, now(), type, JSON.stringify(scrub(payload))).lastInsertRowid);
  }
  events(task, limit = 100, after = 0) {
    return this.db.prepare('SELECT * FROM (SELECT * FROM events WHERE task = ? AND seq > ? ORDER BY seq DESC LIMIT ?) ORDER BY seq')
      .all(task, after, limit).map(row => ({ ...row, payload: JSON.parse(row.payload) }));
  }
  pendingOperations(task) {
    const events = this.db.prepare("SELECT * FROM events WHERE task = ? AND type IN ('tool.started', 'tool.completed', 'handoff.imported') ORDER BY seq").all(task);
    const pending = new Map();
    for (const event of events) {
      const data = JSON.parse(event.payload), key = `${event.run}:${data.id ?? data.itemId ?? event.seq}`;
      if (event.type === 'handoff.imported') {
        for (const item of data.pendingOperations ?? []) pending.set(`${item.run}:${item.id ?? item.itemId ?? JSON.stringify(item)}`, item);
      } else if (event.type === 'tool.started') pending.set(key, { at: event.at, run: event.run, ...data });
      else pending.delete(key);
    }
    return [...pending.values()];
  }
  notes(task) {
    return this.db.prepare("SELECT type, payload FROM events WHERE task = ? AND type IN ('user.note', 'handoff.imported') ORDER BY seq").all(task)
      .flatMap(event => {
        const payload = JSON.parse(event.payload);
        return event.type === 'user.note' ? [{ ...payload, imported: false }] : (payload.sourceNotes ?? []).map(note => ({ ...note, imported: true }));
      });
  }
  checkpoint(task, data) {
    const json = JSON.stringify(data), digest = hash(json);
    const latest = this.latestCheckpoint(task);
    if (latest?.digest === digest) return latest;
    const eventSeq = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE task = ?').get(task).seq;
    this.db.prepare('INSERT INTO checkpoints(task, at, digest, data, event_seq) VALUES (?, ?, ?, ?, ?)').run(task, now(), digest, json, eventSeq);
    this.event(task, null, 'checkpoint.saved', { digest });
    return this.latestCheckpoint(task);
  }
  latestCheckpoint(task) {
    const row = this.db.prepare('SELECT * FROM checkpoints WHERE task = ? ORDER BY seq DESC LIMIT 1').get(task);
    return row ? { ...row, data: JSON.parse(row.data) } : null;
  }
  snapshot(task, data) {
    this.db.prepare('INSERT INTO snapshots(task, at, data) VALUES (?, ?, ?)').run(task, now(), JSON.stringify(data));
  }
  latestSnapshot(task) {
    const row = this.db.prepare('SELECT * FROM snapshots WHERE task = ? ORDER BY seq DESC LIMIT 1').get(task);
    return row ? { ...row, data: JSON.parse(row.data) } : null;
  }
  putObject(bytes) {
    const digest = hash(bytes), file = path.join(this.root, 'objects', digest);
    if (!fs.existsSync(file)) atomicWrite(file, bytes);
    return digest;
  }
  getObject(digest) {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid object digest.');
    const bytes = fs.readFileSync(path.join(this.root, 'objects', digest));
    if (hash(bytes) !== digest) throw new Error(`Corrupt workspace object: ${digest}`);
    return bytes;
  }
  activeRuns() { return this.db.prepare("SELECT * FROM runs WHERE status = 'running'").all(); }
  runs(task) { return this.db.prepare('SELECT * FROM runs WHERE task = ? ORDER BY started DESC').all(task); }
  startRun(task, provider, previous = null) {
    this.task(task);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const active = this.activeRuns();
      if (previous) {
        if (active.length !== 1 || active[0].id !== previous.id || active[0].pid !== process.pid || active[0].task !== task) throw new Error('Account handoff lost workspace ownership.');
        // Transition only after the previous child has exited. No unlocked gap between accounts.
        this.endRun(previous.id, previous.status);
      } else if (active.length) throw new Error(`Workspace already has an unfinished run (${active[0].id}). Stop it or use goddard recover after its processes exit.`);
      const run = { id: id(), task, provider, pid: process.pid, started: now() };
      this.db.prepare("INSERT INTO runs(id, task, provider, pid, started, status) VALUES (?, ?, ?, ?, ?, 'running')")
        .run(run.id, task, provider, run.pid, run.started);
      this.db.exec('COMMIT');
      return run;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  child(run, pid) { this.db.prepare('UPDATE runs SET child_pid = ? WHERE id = ?').run(pid, run); }
  session(run, session) { this.db.prepare('UPDATE runs SET session = ? WHERE id = ?').run(session, run); }
  endRun(run, status) { this.db.prepare('UPDATE runs SET status = ?, ended = ? WHERE id = ?').run(status, now(), run); }
  recover() {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const runs = this.activeRuns();
      for (const run of runs) if (isAlive(run.pid) || isAlive(run.child_pid)) {
        throw new Error(`Run ${run.id} may still be writing (supervisor PID ${run.pid}, child PID ${run.child_pid ?? 'unknown'}). Verify and stop those processes before recovering. Goddard will not kill an old PID automatically.`);
      }
      for (const run of runs) {
        this.endRun(run.id, 'interrupted');
        this.event(run.task, run.id, 'run.recovered', { message: 'Supervisor disappeared. Reconcile pending commands and external actions before repeating them.' });
      }
      this.db.exec('COMMIT'); return runs;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

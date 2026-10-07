import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { now, safeRelative, samePath, within } from './util.js';

const exec = promisify(execFile);
const ignoredDirs = new Set(['.git', '.goddard', '.tmp', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', 'coverage', '.next']);
export function excluded(name) {
  return !safeRelative(name) || name.split('/').some(part => ignoredDirs.has(part)) ||
    /(^|\/)(\.env(?:\..*)?|\.npmrc|\.pypirc|credentials(?:\.json)?|auth\.json|id_rsa|id_ed25519)$/i.test(name) ||
    /\.(pem|key|p12|pfx)$/i.test(name);
}
export async function git(workspace, args, { optional = false } = {}) {
  try {
    const { stdout } = await exec('git', ['-c', 'core.quotepath=false', ...args], {
      cwd: workspace, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 20000, windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
    });
    return stdout;
  } catch (error) {
    if (optional) return null;
    throw new Error(`Git ${args[0]} failed: ${error.stderr?.trim() || error.message}`);
  }
}
export async function captureWorkspace(store, task) {
  const workspace = store.workspace;
  const root = await git(workspace, ['rev-parse', '--show-toplevel'], { optional: true });
  if (root && !samePath(fs.realpathSync.native(root.trim()), workspace)) throw new Error('Use the Git repository root as the Goddard workspace.');
  const snapshot = { schemaVersion: 1, capturedAt: now(), git: null, files: [], excluded: [], warnings: [] };
  let names = [];
  if (root) {
    const head = (await git(workspace, ['rev-parse', '--verify', 'HEAD'], { optional: true }))?.trim() ?? null;
    const branch = (await git(workspace, ['symbolic-ref', '--short', 'HEAD'], { optional: true }))?.trim() ?? null;
    const staged = await git(workspace, ['diff', '--cached', '--name-only', '-z', '--no-renames', '--']);
    const changed = await git(workspace, ['diff', '--name-only', '-z', '--no-renames', '--']);
    const untracked = await git(workspace, ['ls-files', '--others', '--exclude-standard', '-z']);
    names = [...new Set([...staged.split('\0'), ...changed.split('\0'), ...untracked.split('\0')].filter(Boolean))];
    snapshot.git = { head, branch, stagedPatch: '', unstagedPatch: '' };
  } else {
    function walk(folder, prefix = '') {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        if (names.length >= 10000) throw new Error('Workspace has over 10,000 files. Use Git or exclude generated directories.');
        const name = prefix + entry.name;
        if (excluded(name)) { snapshot.excluded.push({ path: name, reason: 'default exclusion' }); continue; }
        if (entry.isDirectory()) walk(path.join(folder, entry.name), name + '/');
        else names.push(name);
      }
    }
    walk(workspace);
  }
  let bytesTotal = 0;
  for (const name of names) {
    if (excluded(name)) { snapshot.excluded.push({ path: name, reason: 'default exclusion' }); continue; }
    const file = path.join(workspace, ...name.split('/'));
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) { snapshot.excluded.push({ path: name, reason: 'symlink, submodule, or nonregular file' }); continue; }
      const resolved = fs.realpathSync.native(file);
      if (!within(workspace, resolved)) throw new Error('File resolves outside workspace.');
      if (stat.size > 2 * 1024 * 1024 || bytesTotal + stat.size > 32 * 1024 * 1024) { snapshot.excluded.push({ path: name, reason: 'snapshot size limit (2 MiB/file, 32 MiB total)' }); continue; }
      const bytes = fs.readFileSync(file);
      const after = fs.statSync(file);
      if (stat.mtimeMs !== after.mtimeMs || stat.size !== after.size) { snapshot.warnings.push(`${name} changed during capture; verify it before recovery.`); continue; }
      bytesTotal += bytes.length;
      snapshot.files.push({ path: name, hash: store.putObject(bytes), mode: stat.mode & 0o777, size: bytes.length, deleted: false });
    } catch (error) {
      if (error.code === 'ENOENT') snapshot.files.push({ path: name, deleted: true });
      else snapshot.warnings.push(`${name}: ${error.message}`);
    }
  }
  if (snapshot.git) {
    const included = snapshot.files.map(file => file.path);
    // Literal pathspecs prevent filenames from becoming Git patterns or options.
    const pathspecs = included.map(name => `:(literal)${name}`);
    if (pathspecs.length) {
      try {
        snapshot.git.stagedPatch = await git(workspace, ['diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv', '--no-renames', '--', ...pathspecs]);
        snapshot.git.unstagedPatch = await git(workspace, ['diff', '--binary', '--no-ext-diff', '--no-textconv', '--no-renames', '--', ...pathspecs]);
      } catch (error) { snapshot.warnings.push(`Patch unavailable: ${error.message}. Captured file contents remain available.`); }
    }
  }
  if (snapshot.excluded.length) snapshot.warnings.push('Some paths were excluded. This snapshot is not a complete backup; see the exclusions.');
  store.snapshot(task, snapshot);
  return snapshot;
}

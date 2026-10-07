import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export const hash = value => createHash('sha256').update(value).digest('hex');
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const normalizePath = value => process.platform === 'win32' ? value.toLowerCase() : value;
export const samePath = (left, right) => normalizePath(left) === normalizePath(right);
export const within = (root, file) => normalizePath(file).startsWith(normalizePath(root + path.sep));
export const isAlive = pid => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};
export function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${id()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(temp, file); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
export function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
export function safeRelative(name) {
  return typeof name === 'string' && name.length > 0 && !name.includes('\0') &&
    !name.includes('\\') && !path.posix.isAbsolute(name) && !/^[A-Za-z]:/.test(name) &&
    name.split('/').every(part => part && part !== '.' && part !== '..' && !/[<>:"|?*]/.test(part) && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) &&
    !name.split('/').some(part => ['.goddard', '.git'].includes(part));
}
export function scrub(value) {
  if (typeof value === 'string') return value
    .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_\-]{16,}\b/g, '[REDACTED]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED]')
    .slice(0, 32000);
  if (Array.isArray(value)) return value.slice(0, 200).map(scrub);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/^(thinking|reasoning|signature|encrypted_content)$/i.test(key))
    .map(([key, item]) => [key, /^(authorization|api_?key|access_?token|refresh_?token|password|secret)$/i.test(key) ? '[REDACTED]' : scrub(item)]));
  return value;
}
export function executable(name) {
  const override = process.env[`GODDARD_${name.toUpperCase()}_BIN`];
  if (override) {
    if (!fs.existsSync(override) || !path.isAbsolute(override)) throw new Error(`GODDARD_${name.toUpperCase()}_BIN must be an existing absolute executable path.`);
    if (/\.(cmd|bat|ps1)$/i.test(override)) throw new Error('Use a native executable, not a shell wrapper.');
    return override;
  }
  const extensions = process.platform === 'win32' ? ['.exe', ''] : [''];
  for (const folder of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const ext of extensions) {
      const candidate = path.join(folder.replace(/^"|"$/g, ''), name + ext);
      try { fs.accessSync(candidate, fs.constants.X_OK); if (fs.statSync(candidate).isFile()) return candidate; } catch {}
    }
  }
  throw new Error(`${name} executable not found on PATH. Install it and sign in first.`);
}
export function version(name) {
  const binary = executable(name);
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr);
  return { binary, version: result.stdout.trim() };
}

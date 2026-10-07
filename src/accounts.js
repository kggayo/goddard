import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CodexAdapter } from './adapters/codex.js';
import { executable, normalizePath } from './util.js';
import { usageDecision } from './usage.js';

const exec = promisify(execFile);
const envKey = provider => provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR';
const getEnv = (env, key) => Object.entries(env).find(([name]) => name.toUpperCase() === key)?.[1];
const canonical = directory => {
  try { return normalizePath(fs.realpathSync.native(directory)); } catch { return normalizePath(path.resolve(directory)); }
};
const providerName = provider => {
  if (!['codex', 'claude'].includes(provider)) throw new Error('--agent must be codex or claude.');
  return provider;
};
const profileName = name => {
  if (!/^[a-z][a-z0-9_-]{0,49}$/.test(name ?? '') || /^(auto|current|default|con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(name) || name.startsWith('discovered-')) {
    throw new Error('Use a profile name of 1–50 lowercase letters, digits, hyphens or underscores; auto, current, default and discovered-* are reserved.');
  }
};

export function profileEnv(profile, base = process.env) {
  const env = { ...base }, key = envKey(profile.provider);
  for (const name of Object.keys(env)) {
    const upper = name.toUpperCase();
    if (upper === key) delete env[name];
    // The current profile intentionally retains API-key / external-provider setups.
    // Named profiles must not silently inherit a different account's auth override.
    if (profile.source !== 'current' && (profile.provider === 'codex'
      ? /^(OPENAI_API_KEY|CODEX_API_KEY|CODEX_ACCESS_TOKEN|CODEX_CHATGPT_ACCOUNT_ID)$/.test(upper)
      : /^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_OAUTH_REFRESH_TOKEN|CLAUDE_CODE_OAUTH_SCOPES|CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR|CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|CLAUDE_CODE_USE_FOUNDRY)$/.test(upper))) delete env[name];
  }
  env[key] = profile.path;
  return env;
}

export class AccountPool {
  constructor({ home = os.homedir(), root = process.env.GODDARD_HOME || path.join(home, '.goddard'), env = process.env } = {}) {
    this.home = path.resolve(home); this.root = path.resolve(root); this.env = env;
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(this.root, 'accounts.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS profiles (provider TEXT NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY(provider, name));
      CREATE TABLE IF NOT EXISTS availability (key TEXT PRIMARY KEY, windows TEXT NOT NULL, blocked_until INTEGER NOT NULL, reason TEXT);`);
  }
  close() { this.db.close(); }
  key(profile) { return `${profile.provider}:${canonical(profile.path)}`; }
  list(provider) {
    providerName(provider);
    const defaultPath = path.join(this.home, `.${provider}`);
    const current = path.resolve(getEnv(this.env, envKey(provider)) || defaultPath);
    const result = [{ provider, name: 'current', path: current, source: 'current' }];
    const registered = this.db.prepare('SELECT * FROM profiles WHERE provider = ? ORDER BY name').all(provider);
    result.push(...registered.map(item => ({ ...item, source: 'registered' })));
    const marker = directory => (provider === 'codex' ? ['auth.json', 'config.toml'] : ['.credentials.json', 'settings.json', 'claude.json'])
      .some(file => fs.existsSync(path.join(directory, file)));
    if (canonical(defaultPath) !== canonical(current) && marker(defaultPath)) result.push({ provider, name: 'default', path: defaultPath, source: 'discovered' });
    for (const entry of fs.readdirSync(this.home, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || !entry.name.startsWith(`.${provider}-`)) continue;
      const directory = path.join(this.home, entry.name);
      if (marker(directory) && !result.some(item => canonical(item.path) === canonical(directory))) {
        result.push({ provider, name: `discovered-${entry.name.slice(provider.length + 2)}`, path: directory, source: 'discovered' });
      }
    }
    return result;
  }
  add(provider, name, directory) {
    providerName(provider); profileName(name);
    const resolved = fs.realpathSync.native(path.resolve(directory));
    if (!fs.statSync(resolved).isDirectory()) throw new Error('A profile path must be a CLI configuration directory.');
    const existing = this.db.prepare('SELECT path FROM profiles WHERE provider = ? AND name = ?').get(provider, name);
    if (existing && canonical(existing.path) !== canonical(resolved)) throw new Error(`Profile ${name} already points elsewhere. Remove its registration first.`);
    this.db.prepare('INSERT OR IGNORE INTO profiles VALUES (?, ?, ?)').run(provider, name, resolved);
    return { provider, name, path: resolved, source: 'registered' };
  }
  prepareLogin(provider, name) {
    providerName(provider); profileName(name);
    const existing = this.db.prepare('SELECT * FROM profiles WHERE provider = ? AND name = ?').get(provider, name);
    const directory = existing?.path ?? path.join(this.root, 'profiles', provider, name);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    // Only initialize a new managed profile; never change an imported provider configuration.
    if (!existing && provider === 'codex') {
      const config = path.join(directory, 'config.toml');
      try { fs.writeFileSync(config, 'cli_auth_credentials_store = "file"\n', { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    return this.add(provider, name, directory);
  }
  remove(provider, name) {
    providerName(provider);
    if (!this.db.prepare('DELETE FROM profiles WHERE provider = ? AND name = ?').run(provider, name).changes) throw new Error('No registered profile with that name.');
  }
  state(profile) {
    const row = this.db.prepare('SELECT * FROM availability WHERE key = ?').get(this.key(profile));
    return row ? { windows: JSON.parse(row.windows), blockedUntil: row.blocked_until, reason: row.reason } : { windows: [], blockedUntil: 0, reason: null };
  }
  reset(profile) { this.db.prepare('DELETE FROM availability WHERE key = ?').run(this.key(profile)); }
  record(profile, { windows = [], limited = false, limitInfo, stop = 85, time = Date.now() } = {}) {
    const limiting = windows.filter(window => window.usedPercent >= stop);
    const blocked = limited || usageDecision(windows, { warn: Math.min(75, stop - 1), stop, time }).action === 'drain';
    const resetTimes = [...limiting.map(window => window.resetsAt), ...(limited ? [limitInfo?.resetsAt] : [])]
      .filter(value => Number.isFinite(value) && value * 1000 > time).map(value => value * 1000);
    // A missing reset is unknown, not immediately reusable. Recheck after five minutes.
    const blockedUntil = blocked ? Math.max(time + (resetTimes.length ? 0 : 300000), ...resetTimes) : 0;
    this.db.prepare('INSERT OR REPLACE INTO availability VALUES (?, ?, ?, ?)').run(this.key(profile), JSON.stringify(windows), blockedUntil, blocked ? 'quota' : null);
    return this.state(profile);
  }
}

export async function probeProfile(profile, { workspace = process.cwd(), env = profileEnv(profile), signal, binary, args, onSpawn } = {}) {
  if (profile.provider === 'claude') {
    let stdout;
    try { ({ stdout } = await exec(binary ?? executable('claude'), args ?? ['auth', 'status', '--json'], { cwd: workspace, env, signal, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true })); }
    catch (error) {
      if (!error.stdout) return { authenticated: null, windows: [], error: 'Claude login status is unavailable; run goddard login to sign in if needed.' };
      stdout = error.stdout;
    }
    try {
      const status = JSON.parse(stdout);
      return { authenticated: typeof status.loggedIn === 'boolean' ? status.loggedIn : null, windows: [], method: status.authMethod ?? null };
    } catch { return { authenticated: null, windows: [], error: 'Claude auth status did not return supported JSON.' }; }
  }
  const adapter = new CodexAdapter({ workspace, env, binary, args });
  adapter.on('fault', () => {});
  adapter.on('spawn', pid => onSpawn?.(pid));
  const abort = () => { void adapter.close().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    const windows = await adapter.connect();
    const { account, requiresOpenaiAuth } = await adapter.rpc.request('account/read', { refreshToken: false });
    return { authenticated: account ? true : requiresOpenaiAuth === true ? false : null, windows, method: account?.type ?? null };
  } catch { return { authenticated: null, windows: [], error: 'Codex account probe is unavailable; the run will check again.' }; }
  finally { signal?.removeEventListener('abort', abort); await adapter.close(); }
}

export async function loginProfile(profile, { env = profileEnv(profile), binary = executable(profile.provider), args } = {}) {
  const command = args ?? (profile.provider === 'codex' ? ['login'] : ['auth', 'login', '--claudeai']);
  const child = spawn(binary, command, { env, stdio: 'inherit', windowsHide: true });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`${profile.provider} login did not complete (${signal ?? code}). Run the login command again to retry.`)));
  });
}

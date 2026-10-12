import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { packageVersion, readJSON, samePath } from './util.js';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const repository = 'https://github.com/kggayo/goddard';
const latestRelease = 'https://api.github.com/repos/kggayo/goddard/releases/latest';
export const manualUpdate = `npm install --global ${repository}/releases/latest/download/goddard.tgz`;

function versionParts(value) {
  if (typeof value !== 'string' || value.length > 80 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('Expected a stable Goddard version (X.Y.Z).');
  return value.split('.').map(BigInt);
}

export function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export function installedPrefix(root = packageRoot, platform = process.platform) {
  const unsupported = () => new Error('Automatic updates require a global npm installation. For a source checkout or npm link, update the checkout yourself. To install a release, see https://github.com/kggayo/goddard/blob/main/docs/installing.md.');
  root = fs.realpathSync(root);
  const modules = path.dirname(root), parent = path.dirname(modules);
  if (path.basename(root) !== 'goddard' || path.basename(modules) !== 'node_modules' || (platform !== 'win32' && path.basename(parent) !== 'lib')) throw unsupported();
  const prefix = platform === 'win32' ? parent : path.dirname(parent);
  try {
    const entry = path.join(root, 'bin/goddard.js');
    if (platform === 'win32') {
      const shim = fs.readFileSync(path.join(prefix, 'goddard.cmd'), 'utf8');
      if (!/%(?:dp0|~dp0)%?[\\/]+node_modules[\\/]+goddard[\\/]+bin[\\/]+goddard\.js/i.test(shim)) throw unsupported();
    } else if (!samePath(fs.realpathSync(path.join(prefix, 'bin/goddard')), fs.realpathSync(entry))) throw unsupported();
    if (readJSON(path.join(root, 'package.json')).name !== 'goddard') throw unsupported();
  } catch { throw unsupported(); }
  return prefix;
}

export function findNpmCli({ env = process.env, node = process.execPath } = {}) {
  const folders = [path.dirname(node), path.dirname(fs.realpathSync(node)), ...(env.PATH ?? '').split(path.delimiter).filter(Boolean).map(folder => folder.replace(/^"|"$/g, ''))];
  const candidates = [env.npm_execpath];
  for (const folder of folders) {
    candidates.push(path.join(folder, 'node_modules/npm/bin/npm-cli.js'), path.resolve(folder, '../lib/node_modules/npm/bin/npm-cli.js'));
    try { candidates.push(fs.realpathSync(path.join(folder, 'npm'))); } catch {}
  }
  for (const candidate of candidates) {
    if (candidate && path.isAbsolute(candidate) && path.basename(candidate) === 'npm-cli.js' && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`Could not locate npm. Install Node.js with npm, or update manually: ${manualUpdate}`);
}

async function download(url, limit, fetcher) {
  try {
    const response = await fetcher(url, { headers: { 'User-Agent': `goddard/${packageVersion}` }, credentials: 'omit', signal: AbortSignal.timeout(120000) });
    if (!response.ok) {
      if ([403, 429].includes(response.status)) throw new Error(`GitHub refused the request (HTTP ${response.status}); try again later.`);
      throw new Error(`GitHub returned HTTP ${response.status}.`);
    }
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('Release download exceeds the size limit.'); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw new Error('Release download exceeds the size limit.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (error) { throw new Error(`Could not download the Goddard release: ${error.message}`); }
}

export async function updateGoddard({ check = false, log = console.log, root = packageRoot, currentVersion = packageVersion,
  fetcher = globalThis.fetch, execute = spawnSync, npmCli, env = process.env } = {}) {
  // Identify the running installation, not a different npm prefix on PATH.
  const prefix = check ? null : installedPrefix(root);
  versionParts(currentVersion);
  log('Checking the latest Goddard release...');
  let release;
  try { release = JSON.parse((await download(latestRelease, 1024 * 1024, fetcher)).toString('utf8')); }
  catch (error) { throw new Error(`Update check failed. ${error.message}`); }
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string' || !release.tag_name.startsWith('v')) throw new Error('GitHub did not return a stable Goddard release.');
  const latestVersion = release.tag_name.slice(1);
  const comparison = compareVersions(latestVersion, currentVersion);
  const result = { currentVersion, latestVersion, releaseUrl: `${repository}/releases/tag/${release.tag_name}` };
  if (comparison <= 0) return { ...result, status: comparison === 0 ? 'up_to_date' : 'ahead' };
  if (check) return { ...result, status: 'available' };

  const base = `${repository}/releases/download/${release.tag_name}`;
  for (const name of ['goddard.tgz', 'SHA256SUMS']) {
    const assets = Array.isArray(release.assets) ? release.assets.filter(asset => asset.name === name) : [];
    if (assets.length !== 1 || assets[0].browser_download_url !== `${base}/${name}`) throw new Error(`Release is missing the expected ${name} asset. Nothing was installed.`);
  }
  npmCli ??= findNpmCli({ env });
  log(`Downloading Goddard ${latestVersion}...`);
  const sums = (await download(`${base}/SHA256SUMS`, 16384, fetcher)).toString('utf8').trim();
  const expected = /^([a-fA-F0-9]{64})[ \t]+\*?goddard\.tgz$/.exec(sums)?.[1]?.toLowerCase();
  if (!expected) throw new Error('Invalid release checksum file. Nothing was installed.');
  const archive = await download(`${base}/goddard.tgz`, 64 * 1024 * 1024, fetcher);
  if (createHash('sha256').update(archive).digest('hex') !== expected) throw new Error('Release checksum mismatch. Nothing was installed.');

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'goddard-update-'));
  try {
    const tarball = path.join(temporary, 'goddard.tgz');
    fs.writeFileSync(tarball, archive, { mode: 0o600 });
    const npm = args => {
      const result = execute(process.execPath, [npmCli, ...args, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--update-notifier=false'],
        { cwd: temporary, env, encoding: 'utf8', windowsHide: true, timeout: 300000, maxBuffer: 4 * 1024 * 1024 });
      if (result.error || result.status !== 0) throw new Error(`npm could not update Goddard: ${result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status}`}. Check permissions for ${prefix}. Retry with: ${manualUpdate}`);
      return result.stdout;
    };
    // Inspect the archive before npm can replace anything in the installation.
    const packed = JSON.parse(npm(['pack', tarball, '--dry-run', '--json']));
    if (packed.length !== 1 || packed[0].name !== 'goddard' || packed[0].version !== latestVersion) throw new Error('Release package name or version does not match. Nothing was installed.');
    log(`Installing Goddard ${latestVersion} into ${prefix}...`);
    // Invoke npm's JS entry through Node: no shell, .cmd quoting, or lifecycle scripts.
    npm(['install', '--global', '--prefix', prefix, tarball]);
    const updated = readJSON(path.join(root, 'package.json'));
    if (updated.name !== 'goddard' || updated.version !== latestVersion) throw new Error(`npm finished, but this installation is not version ${latestVersion}. Check goddard --version and your PATH.`);
    return { ...result, status: 'updated', prefix };
  } finally {
    if (path.dirname(path.resolve(temporary)) === path.resolve(os.tmpdir()) && path.basename(temporary).startsWith('goddard-update-')) fs.rmSync(temporary, { recursive: true, force: true });
  }
}

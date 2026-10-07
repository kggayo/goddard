import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000, ...options });
  if (result.error || result.status !== 0) throw new Error(`${binary} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  return result.stdout.trim();
}

export function npm(args, options) {
  assert.ok(process.env.npm_execpath, 'Run this script through npm run.');
  return run(process.execPath, [process.env.npm_execpath, ...args], options);
}

export function validatePack(pack, pkg) {
  assert.equal(pack.name, pkg.name);
  assert.equal(pack.version, pkg.version);
  const files = new Set(pack.files.map(file => file.path));
  for (const file of ['package.json', 'bin/goddard.js', 'src/cli.js', 'src/store.js', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/usage.md']) {
    assert.ok(files.has(file), `Missing package file: ${file}`);
  }
  for (const dependency of Object.keys(pkg.dependencies)) {
    assert.ok(pack.bundled.includes(dependency), `Missing bundled dependency: ${dependency}`);
    assert.ok(files.has(`node_modules/${dependency}/package.json`), `Missing dependency files: ${dependency}`);
  }
  const topLevel = new Set(['package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'ROADMAP.md']);
  for (const file of files) {
    const allowed = topLevel.has(file) || file === 'bin/goddard.js' || /^src\/(?:[\w-]+\/)*[\w-]+\.js$/.test(file) || /^docs\/(?:[\w-]+\/)*[\w.-]+\.(md|png)$/.test(file) || file.startsWith('node_modules/');
    assert.ok(allowed, `Unexpected package file: ${file}`);
    assert.ok(!/(^|\/)(\.git|\.goddard|\.tmp|\.env(?:\.[^/]*)?|auth\.json|\.?credentials\.json)(\/|$)/i.test(file), `Private file in package: ${file}`);
    assert.ok(!file.split('/').includes('..'), `Unsafe package path: ${file}`);
  }
}

export function verifyPackage(directory) {
  const file = path.join(directory, 'goddard.tgz');
  assert.equal(fs.readFileSync(path.join(directory, 'SHA256SUMS'), 'utf8'), `${sha256(file)}  goddard.tgz\n`, 'Package checksum does not match.');
  return file;
}

export function buildPackage() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, pkg.version, 'Run npm install --package-lock-only after changing the version.');
  // Check installed versions before bundling; CI always starts from npm ci.
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!location || entry.dev) continue;
    const installed = JSON.parse(fs.readFileSync(path.join(root, location, 'package.json'), 'utf8'));
    assert.equal(installed.version, entry.version, `Run npm ci: ${location} differs from the lockfile.`);
  }
  const directory = path.join(root, 'dist');
  fs.mkdirSync(directory, { recursive: true });
  const [pack] = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', directory]));
  validatePack(pack, pkg);
  const file = path.join(directory, 'goddard.tgz');
  fs.renameSync(path.join(directory, pack.filename), file);
  fs.writeFileSync(path.join(directory, 'SHA256SUMS'), `${sha256(file)}  goddard.tgz\n`);
  console.log(`Built ${pkg.name} ${pkg.version}: ${file} (${pack.size} bytes, dependencies included).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildPackage();

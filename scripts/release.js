import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { root, run, verifyPackage } from './package.js';

const repository = 'kggayo/goddard';

export function validateRelease(tag, { command = run, directory = root } = {}) {
  assert.match(tag ?? '', /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Release from a version tag such as v0.3.0.');
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(directory, 'package-lock.json'), 'utf8'));
  assert.equal(tag, `v${pkg.version}`, 'Tag must match package.json.');
  assert.equal(lock.version, pkg.version, 'Lockfile version must match package.json.');
  const notes = path.join(directory, 'docs/releases', `${tag}.md`);
  assert.ok(fs.existsSync(notes) && fs.readFileSync(notes, 'utf8').trim(), `Missing release notes: ${notes}`);
  const git = args => command('git', args, { cwd: directory });
  const commit = git(['rev-parse', 'HEAD']);
  assert.equal(git(['rev-parse', `refs/tags/${tag}^{commit}`]), commit, 'Checkout must match the release tag.');
  git(['merge-base', '--is-ancestor', commit, 'origin/main']);
  assert.equal(git(['status', '--porcelain', '--untracked-files=normal']), '', 'Release checkout must be clean.');
  return { tag, notes, commit };
}

export function publishRelease(tag) {
  const { notes } = validateRelease(tag);
  const file = verifyPackage(path.join(root, 'dist'));
  const gh = args => run('gh', [...args, '--repo', repository]);
  const existing = spawnSync('gh', ['release', 'view', tag, '--repo', repository, '--json', 'isDraft,assets'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (existing.error) throw existing.error;
  if (existing.status === 0) {
    const release = JSON.parse(existing.stdout);
    assert.ok(release.isDraft, 'This release is already public. Publish a new version instead of replacing it.');
    assert.ok(release.assets.every(asset => ['goddard.tgz', 'SHA256SUMS'].includes(asset.name)), 'Draft has unexpected assets; inspect it before retrying.');
  } else {
    assert.match(existing.stderr, /release not found|HTTP 404/i, 'Could not read release state; refusing to guess.');
    gh(['release', 'create', tag, '--draft', '--verify-tag', '--title', `Goddard ${tag}`, '--notes-file', notes]);
  }
  gh(['release', 'upload', tag, file, path.join(root, 'dist/SHA256SUMS'), '--clobber']);
  gh(['release', 'edit', tag, '--draft=false', '--verify-tag', '--title', `Goddard ${tag}`, '--notes-file', notes]);
  console.log(`Published https://github.com/${repository}/releases/tag/${tag}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, tag] = process.argv.slice(2);
  if (command === 'validate') { validateRelease(tag); console.log(`Validated ${tag}: version, notes, tag, and main ancestry.`); }
  else if (command === 'publish') publishRelease(tag);
  else throw new Error('Usage: node scripts/release.js validate|publish vX.Y.Z');
}

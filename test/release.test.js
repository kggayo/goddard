import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePack, verifyPackage, sha256, run } from '../scripts/package.js';
import { validateRelease } from '../scripts/release.js';

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'goddard-release-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('goddard-release-test-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

test('package guard rejects missing dependencies and accidentally packed private files', () => {
  const pkg = { name: 'goddard', version: '0.3.0', dependencies: { marked: '18.1.0' } };
  const pack = {
    name: pkg.name, version: pkg.version, bundled: ['marked'],
    files: ['package.json', 'bin/goddard.js', 'src/cli.js', 'src/store.js', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/usage.md', 'node_modules/marked/package.json'].map(path => ({ path }))
  };
  assert.doesNotThrow(() => validatePack(pack, pkg));
  assert.throws(() => validatePack({ ...pack, bundled: [] }, pkg), /Missing bundled dependency/);
  for (const file of ['.goddard/state.sqlite', 'src/auth.json', 'docs/.env', 'node_modules/marked/.env', '.github/workflows/release.yml']) {
    assert.throws(() => validatePack({ ...pack, files: [...pack.files, { path: file }] }, pkg), /Unexpected package file|Private file/);
  }
});

test('changed tarball is rejected before installation or publication', t => {
  const directory = temporary(t);
  const tarball = path.join(directory, 'goddard.tgz');
  fs.writeFileSync(tarball, 'original package');
  fs.writeFileSync(path.join(directory, 'SHA256SUMS'), `${sha256(tarball)}  goddard.tgz\n`);
  assert.equal(verifyPackage(directory), tarball);
  fs.appendFileSync(tarball, 'changed');
  assert.throws(() => verifyPackage(directory), /checksum does not match/);
});

test('release validation requires a matching version tag on reviewed main history', t => {
  const directory = temporary(t);
  const git = args => run('git', args, { cwd: directory });
  git(['init', '--quiet', '--initial-branch=main']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'user.name', 'Release test']);
  git(['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(directory, 'docs/releases'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version: '0.3.0' }));
  fs.writeFileSync(path.join(directory, 'package-lock.json'), JSON.stringify({ version: '0.3.0' }));
  fs.writeFileSync(path.join(directory, 'docs/releases/v0.3.0.md'), 'First release.');
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'Reviewed release']);
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  git(['tag', 'v0.3.0']);
  assert.equal(validateRelease('v0.3.0', { directory }).commit, git(['rev-parse', 'HEAD']));
  assert.throws(() => validateRelease('main', { directory }), /Release from a version tag/);
  assert.throws(() => validateRelease('v0.3.1', { directory }), /Tag must match/);
  fs.writeFileSync(path.join(directory, 'private.txt'), 'Unreviewed work');
  assert.throws(() => validateRelease('v0.3.0', { directory }), /checkout must be clean/);
  git(['switch', '--quiet', '-c', 'unreviewed']);
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'Not on main']);
  assert.throws(() => validateRelease('v0.3.0', { directory }), /Checkout must match/);
  git(['tag', '-f', 'v0.3.0']);
  assert.throws(() => validateRelease('v0.3.0', { directory }), /git failed/);
});

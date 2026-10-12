import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { npm, root, run, verifyPackage } from './package.js';

const tarball = verifyPackage(path.join(root, 'dist'));
// An empty npm cache and a workspace outside the checkout catch accidental reliance
// on the developer's dependencies, global install, Git root, or provider accounts.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'goddard package test '));
const prefix = path.join(temp, 'install');
const workspace = path.join(temp, 'project');
fs.mkdirSync(workspace);
try {
  npm(['install', '--global', '--prefix', prefix, '--cache', path.join(temp, 'empty-cache'), '--offline', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: temp });
  const shim = path.join(prefix, process.platform === 'win32' ? 'goddard.cmd' : 'bin/goddard');
  assert.ok(fs.existsSync(shim), 'npm did not create the command shim.');
  const cli = (args, expectEmptyStderr = false, env = {}) => {
    const options = { cwd: workspace, env: { ...process.env, NO_COLOR: '1', ...env }, expectEmptyStderr, timeout: 300000 };
    if (process.platform !== 'win32') return run(shim, args, options);
    // Pass arguments as data rather than interpolating paths or user text into shell code.
    options.env.GODDARD_TEST_SHIM = shim;
    options.env.GODDARD_TEST_ARGS = JSON.stringify(args);
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$cliArgs = @(ConvertFrom-Json $env:GODDARD_TEST_ARGS); & $env:GODDARD_TEST_SHIM @cliArgs; exit $LASTEXITCODE'], options);
  };
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const args of [['--version'], ['-v']]) assert.equal(cli(args, true), pkg.version);
  for (const args of [['--help'], ['-h'], ['help'], []]) {
    const help = cli(args, true);
    assert.match(help, /durable handoffs between coding agents/);
    assert.match(help, /--dangerously-skip-permissions/);
    assert.match(help, /start "goal"/);
    assert.match(help, /update \[--check\]/);
  }
  assert.ok(!fs.existsSync(path.join(workspace, '.goddard')), 'Version/help must not initialize workspace state.');
  cli(['init']);
  fs.writeFileSync(path.join(workspace, 'hello.txt'), 'Packaged installation works.\n');
  const task = JSON.parse(cli(['new', 'Check the installed package', '--json']));
  cli(['note', task.id, 'Keep this clarification in the handoff']);
  const tasks = JSON.parse(cli(['list', '--json']));
  assert.ok(tasks.some(item => item.id === task.id));
  const handoff = cli(['handoff', task.id]);
  assert.match(fs.readFileSync(handoff, 'utf8'), /Keep this clarification in the handoff/);
  const bundle = path.join(temp, 'handoff.json');
  cli(['export', task.id, '--out', bundle]);
  assert.match(fs.readFileSync(bundle, 'utf8'), /Check the installed package/);
  const installedRoot = path.join(prefix, process.platform === 'win32' ? 'node_modules/goddard' : 'lib/node_modules/goddard');
  assert.ok(fs.existsSync(path.join(installedRoot, 'docs/usage.md')));
  assert.ok(fs.existsSync(path.join(installedRoot, 'THIRD_PARTY_NOTICES.md')));

  // Run the actual installed command and npm, replacing this installation while
  // it runs. Only HTTP is simulated so CI needs no published future release.
  const releaseFixture = path.join(temp, 'update-release.json');
  fs.writeFileSync(releaseFixture, JSON.stringify({ version: pkg.version, tarball }));
  const wrongPrefix = path.join(temp, 'different npm default');
  const updateEnv = {
    NODE_OPTIONS: `--import=${pathToFileURL(path.join(root, 'test/fixtures/update-release.mjs')).href}`,
    GODDARD_TEST_UPDATE_RELEASE: releaseFixture, NPM_CONFIG_PREFIX: wrongPrefix
  };
  const installedManifest = path.join(installedRoot, 'package.json');
  const previous = JSON.parse(fs.readFileSync(installedManifest, 'utf8'));
  fs.writeFileSync(installedManifest, JSON.stringify({ ...previous, version: '0.0.0' }));
  const check = JSON.parse(cli(['update', '--check', '--json'], true, updateEnv));
  assert.equal(check.status, 'available');
  assert.equal(JSON.parse(fs.readFileSync(installedManifest)).version, '0.0.0', '--check must not install');
  const updated = JSON.parse(cli(['update', '--json'], true, updateEnv));
  assert.equal(updated.status, 'updated');
  assert.equal(fs.realpathSync(updated.prefix), fs.realpathSync(prefix));
  assert.equal(cli(['--version'], true), pkg.version);
  assert.equal(JSON.parse(cli(['update', '--json'], true, updateEnv)).status, 'up_to_date');
  assert.ok(!fs.existsSync(wrongPrefix), 'update must not target another npm prefix');
  assert.ok(JSON.parse(cli(['list', '--json'])).some(item => item.id === task.id), 'saved tasks must survive the update');
  assert.equal(fs.readFileSync(path.join(workspace, 'hello.txt'), 'utf8'), 'Packaged installation works.\n');
  console.log(`Package installed offline and passed CLI, SQLite, task, note, snapshot, handoff, and self-update checks on ${process.platform}.`);
} finally {
  // temp is the exact directory returned by mkdtemp, outside the user's workspace.
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temp).startsWith('goddard package test '));
  fs.rmSync(temp, { recursive: true, force: true });
}

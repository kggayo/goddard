import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  const cli = args => {
    const options = { cwd: workspace, env: { ...process.env, NO_COLOR: '1' } };
    if (process.platform !== 'win32') return run(shim, args, options);
    // Pass arguments as data rather than interpolating paths or user text into shell code.
    options.env.GODDARD_TEST_SHIM = shim;
    options.env.GODDARD_TEST_ARGS = JSON.stringify(args);
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$cliArgs = @(ConvertFrom-Json $env:GODDARD_TEST_ARGS); & $env:GODDARD_TEST_SHIM @cliArgs; exit $LASTEXITCODE'], options);
  };
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(cli(['--version']), pkg.version);
  assert.match(cli(['--help']), /durable handoffs between coding agents/);
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
  console.log(`Package installed offline and passed CLI, SQLite, task, note, snapshot, and handoff checks on ${process.platform}.`);
} finally {
  // temp is the exact directory returned by mkdtemp, outside the user's workspace.
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temp).startsWith('goddard package test '));
  fs.rmSync(temp, { recursive: true, force: true });
}

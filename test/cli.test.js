import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'goddard.js');
const sqliteRejectingLoader = pathToFileURL(path.join(root, 'test', 'fixtures', 'reject-sqlite-loader.mjs')).href;
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

for (const args of [['--version'], ['-v'], ['--help'], ['-h'], ['help'], []]) {
  test(`lightweight command ${args.join(' ') || '(no arguments)'} does not load SQLite`, () => {
    for (const nodeArgs of [[], ['--import', sqliteRejectingLoader]]) {
      const result = spawnSync(process.execPath, [...nodeArgs, cli, ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      if (args[0] === '--version' || args[0] === '-v') assert.equal(result.stdout.trim(), packageVersion);
      else assert.match(result.stdout, /Usage: goddard/);
    }
  });
}

test('the regression hook rejects a real SQLite import', () => {
  const result = spawnSync(process.execPath, ['--import', sqliteRejectingLoader, '--input-type=module', '--eval', "await import('node:sqlite')"],
    { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SQLite must not be loaded/);
});

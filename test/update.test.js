import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { updateGoddard, installedPrefix, compareVersions, findNpmCli } from '../src/update.js';
import { main } from '../src/cli.js';

const repo = 'https://github.com/kggayo/goddard';
const metadataUrl = 'https://api.github.com/repos/kggayo/goddard/releases/latest';
const archive = Buffer.from('test archive');
const checksum = createHash('sha256').update(archive).digest('hex');
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'goddard updater test '));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('goddard updater test '));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
function installation(t, platform = process.platform) {
  const prefix = temporary(t);
  const root = path.join(prefix, platform === 'win32' ? 'node_modules/goddard' : 'lib/node_modules/goddard');
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'goddard', version: '0.5.2' }));
  fs.writeFileSync(path.join(root, 'bin/goddard.js'), '');
  if (platform === 'win32') fs.writeFileSync(path.join(prefix, 'goddard.cmd'), '"%dp0%\\node_modules\\goddard\\bin\\goddard.js" %*');
  else { fs.mkdirSync(path.join(prefix, 'bin')); fs.symlinkSync(path.join(root, 'bin/goddard.js'), path.join(prefix, 'bin/goddard')); }
  return { prefix, root };
}
function remote({ version = '0.6.0', metadata = {}, sums = `${checksum}  goddard.tgz\n`, bytes = archive } = {}) {
  const requests = [];
  const release = { tag_name: `v${version}`, draft: false, prerelease: false,
    assets: ['goddard.tgz', 'SHA256SUMS'].map(name => ({ name, browser_download_url: `${repo}/releases/download/v${version}/${name}` })), ...metadata };
  return { requests, fetcher: async (url, options) => {
    requests.push(url); assert.equal(options.credentials, 'omit'); assert.equal(options.headers.Authorization, undefined);
    if (url === metadataUrl) return new Response(JSON.stringify(release));
    if (url.endsWith('/SHA256SUMS')) return new Response(sums);
    assert.equal(url, `${repo}/releases/download/v${version}/goddard.tgz`);
    return new Response(bytes);
  } };
}
const defaults = { log: () => {}, currentVersion: '0.5.2', npmCli: '/test/npm-cli.js', execute: () => assert.fail('npm must not run') };

test('update --check works without an installation and never installs or downloads assets', async () => {
  const server = remote();
  const result = await updateGoddard({ ...defaults, ...server, root: '/not/an/install', check: true });
  assert.equal(result.status, 'available');
  assert.deepEqual(server.requests, [metadataUrl]);
});

test('updates do nothing when current or newer, with numeric version comparisons', async t => {
  const install = installation(t);
  for (const [version, status] of [['0.5.2', 'up_to_date'], ['0.5.1', 'ahead']]) {
    const server = remote({ version });
    assert.equal((await updateGoddard({ ...defaults, ...install, ...server })).status, status);
    assert.deepEqual(server.requests, [metadataUrl]);
  }
  assert.equal(compareVersions('0.10.0', '0.9.99'), 1);
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
});

test('update verifies and installs into the running prefix without a shell, then verifies the result', async t => {
  const install = installation(t), server = remote();
  const calls = [];
  const result = await updateGoddard({ ...defaults, ...install, ...server, execute: (binary, args, options) => {
    calls.push({ binary, args, options });
    assert.equal(binary, process.execPath); assert.equal(options.shell, undefined);
    for (const flag of ['--offline', '--ignore-scripts', '--no-audit', '--no-fund']) assert.ok(args.includes(flag));
    const file = args.find(arg => arg.endsWith('goddard.tgz'));
    assert.deepEqual(fs.readFileSync(file), archive);
    if (args[1] === 'pack') return { status: 0, stdout: JSON.stringify([{ name: 'goddard', version: '0.6.0' }]) };
    assert.equal(args[args.indexOf('--prefix') + 1], install.prefix);
    fs.writeFileSync(path.join(install.root, 'package.json'), JSON.stringify({ name: 'goddard', version: '0.6.0' }));
    return { status: 0, stdout: '' };
  } });
  assert.equal(result.status, 'updated'); assert.equal(calls.length, 2);
  assert.ok(!fs.existsSync(calls[0].options.cwd), 'temporary download must be removed');
});

test('source checkouts, development links and local installs are not replaced', async t => {
  const source = temporary(t);
  assert.throws(() => installedPrefix(source), /global npm installation/);
  const local = path.join(source, 'node_modules/goddard');
  fs.mkdirSync(local, { recursive: true });
  assert.throws(() => installedPrefix(local), /global npm installation/);
  const linked = path.join(source, 'linked');
  fs.symlinkSync(source, linked, 'junction');
  assert.throws(() => installedPrefix(linked), /global npm installation/);
  await assert.rejects(updateGoddard({ ...defaults, root: source, fetcher: () => assert.fail('no network before installation guard') }), /global npm installation/);
});

test('Windows global layout is recognized without using npm.cmd or evaluating shim contents', t => {
  const install = installation(t, 'win32');
  assert.equal(installedPrefix(install.root, 'win32'), install.prefix);
});

test('invalid release metadata and checksum fail before npm runs', async t => {
  const install = installation(t);
  for (const options of [{ metadata: { prerelease: true } }, { version: '../../other' }, { metadata: { assets: [] } },
    { metadata: { assets: [{ name: 'goddard.tgz', browser_download_url: 'https://example.invalid/package.tgz' }] } },
    { sums: 'bad checksum' }, { bytes: Buffer.from('changed') }]) {
    await assert.rejects(updateGoddard({ ...defaults, ...install, ...remote(options) }), /stable|expected|checksum/);
  }
});

test('HTTP errors and oversized responses fail without touching the installation', async t => {
  const install = installation(t);
  for (const status of [403, 404, 429, 500]) await assert.rejects(updateGoddard({ ...defaults, ...install, fetcher: async () => new Response('', { status }) }), new RegExp(`HTTP ${status}`));
  for (const response of [new Response('', { headers: { 'content-length': '99999999' } }), new Response('x'.repeat(1024 * 1024 + 1))]) {
    await assert.rejects(updateGoddard({ ...defaults, ...install, fetcher: async () => response }), /size limit/);
  }
  await assert.rejects(updateGoddard({ ...defaults, ...install, fetcher: async () => { throw new Error('offline'); } }), /Update check failed.*offline/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(install.root, 'package.json'))).version, '0.5.2');
});

test('wrong archive identity, npm failure, and an unchanged installation never report success', async t => {
  const install = installation(t);
  for (const packed of [{ name: 'other-package', version: '0.6.0' }, { name: 'goddard', version: '0.5.1' }]) {
    await assert.rejects(updateGoddard({ ...defaults, ...install, ...remote(), execute: (binary, args) => {
      assert.equal(args[1], 'pack'); return { status: 0, stdout: JSON.stringify([packed]) };
    } }), /package name or version/);
  }
  await assert.rejects(updateGoddard({ ...defaults, ...install, ...remote(), execute: () => ({ status: 1, stderr: 'EACCES' }) }), /EACCES.*Retry with/);
  await assert.rejects(updateGoddard({ ...defaults, ...install, ...remote(), execute: () => ({ status: 0, stdout: JSON.stringify([{ name: 'goddard', version: '0.6.0' }]) }) }), /installation is not version/);
});

test('npm resolver uses its JavaScript entry and fails clearly without npm', t => {
  const directory = temporary(t), node = path.join(directory, 'node'), cli = path.join(directory, 'node_modules/npm/bin/npm-cli.js');
  fs.writeFileSync(node, ''); fs.mkdirSync(path.dirname(cli), { recursive: true }); fs.writeFileSync(cli, '');
  assert.equal(findNpmCli({ node, env: { PATH: '' } }), cli);
  fs.unlinkSync(cli);
  assert.throws(() => findNpmCli({ node, env: { PATH: '' } }), /Could not locate npm/);
});

test('CLI routes update and check without a workspace and rejects positional release overrides', async t => {
  const output = []; t.mock.method(console, 'log', value => output.push(value));
  for (const check of [false, true]) {
    await main(['update', ...(check ? ['--check'] : []), '--json'], { update: async options => {
      assert.equal(options.check, check); options.log('must not appear');
      return { status: 'up_to_date', currentVersion: '0.6.0', latestVersion: '0.6.0' };
    } });
  }
  assert.equal(output.length, 2); assert.equal(JSON.parse(output[0]).status, 'up_to_date');
  await assert.rejects(main(['update', 'https://example.invalid/other.tgz']), /Use goddard update/);
  await assert.rejects(main(['list', '--check']), /only supported/);
});

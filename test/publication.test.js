import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { publishGitHub } from '../scripts/publish-github.js';

const root = fileURLToPath(new URL('..', import.meta.url));
function harness({ login = 'kggayo', dirty = false, remote = null, privateRepo = false } = {}) {
  const calls = [];
  const run = (binary, args, options = {}) => {
    calls.push({ binary, args, options });
    const reply = value => ({ status: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value), stderr: '' });
    if (binary === 'gh') {
      const endpoint = args[3], method = args[args.indexOf('--method') + 1];
      if (endpoint === 'user') return reply({ login });
      if (method === 'GET') return reply({ private: privateRepo, permissions: { admin: true } });
      return reply('');
    }
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return reply(root);
    if (args[0] === 'branch') return reply('main');
    if (args[0] === 'status') return reply(dirty ? '?? auth.json' : '');
    if (args[0] === 'remote' && args[1] === 'get-url') return remote ? reply(remote) : { status: 2, stdout: '', stderr: 'No such remote' };
    return reply('');
  };
  const mutations = () => calls.filter(call => call.binary === 'gh' ? call.args[call.args.indexOf('--method') + 1] !== 'GET' : call.args.includes('push') || call.args.includes('add'));
  return { run, calls, mutations };
}

for (const [name, options, expected] of [
  ['another GitHub account', { login: 'someone-else' }, /Signed in as someone-else/],
  ['unreviewed files', { dirty: true }, /Review and commit/],
  ['another repository remote', { remote: 'https://github.com/someone/other.git' }, /another repository/],
  ['a private destination', { privateRepo: true }, /will not change its visibility/]
]) {
  test(`publication refuses ${name} before changing GitHub or pushing files`, () => {
    const h = harness(options);
    assert.throws(() => publishGitHub(h.run, () => {}), expected);
    assert.deepEqual(h.mutations(), []);
  });
}

test('publication uses a normal push and applies branch protection only after that push', () => {
  const h = harness();
  publishGitHub(h.run, () => {});
  const push = h.calls.findIndex(call => call.binary === 'git' && call.args.includes('push'));
  const protection = h.calls.findIndex(call => call.binary === 'gh' && call.args[3].endsWith('/branches/main/protection'));
  assert.ok(push >= 0 && protection > push);
  assert.ok(!h.calls.some(call => call.args.some(arg => /^--force|-f$/.test(arg))));
  assert.ok(!h.calls.some(call => call.args.includes('--global')));
});

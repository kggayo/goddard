import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(fs.readFileSync(new URL('../.github/repository-settings.json', import.meta.url), 'utf8'));

function command(binary, args, { input, optional = false } = {}) {
  const result = spawnSync(binary, args, { cwd: root, input, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !optional) throw new Error(`${binary} ${args[0]} failed: ${result.stderr?.trim() || result.stdout?.trim() || result.status}`);
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function publishGitHub(run = command, log = console.log) {
  const [owner, name] = config.repository.split('/');
  const url = `https://github.com/${config.repository}.git`;
  const api = (endpoint, method = 'GET', body, optional = false) => {
    const result = run('gh', ['api', '--hostname', 'github.com', endpoint, '--method', method,
      '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2026-03-10', ...(body === undefined ? [] : ['--input', '-'])],
    { optional, ...(body === undefined ? {} : { input: JSON.stringify(body) }) });
    return { ...result, data: result.stdout.trim() ? JSON.parse(result.stdout) : null };
  };
  const identity = api('user').data;
  if (identity.login.toLowerCase() !== owner.toLowerCase()) throw new Error(`Signed in as ${identity.login}. Sign in to ${owner} with gh auth login, then select it with gh auth switch --user ${owner}. No repository changes were made.`);
  const gitRoot = run('git', ['rev-parse', '--show-toplevel']).stdout.trim();
  if (fs.realpathSync.native(gitRoot) !== fs.realpathSync.native(root)) throw new Error('Initialize this checkout as its own Git repository first.');
  if (run('git', ['branch', '--show-current']).stdout.trim() !== 'main') throw new Error('Initial publication must run from main.');
  if (run('git', ['status', '--porcelain']).stdout.trim()) throw new Error('Review and commit the intended public files before publishing.');
  run('git', ['rev-parse', '--verify', 'HEAD']);
  const remote = run('git', ['remote', 'get-url', 'origin'], { optional: true });
  if (remote.status === 0 && ![url, url.slice(0, -4), `git@github.com:${config.repository}.git`].includes(remote.stdout.trim())) throw new Error('origin points to another repository; refusing to change or push it.');
  let repository = api(`repos/${config.repository}`, 'GET', undefined, true);
  if (repository.status !== 0) {
    if (!/HTTP 404|Not Found/i.test(repository.stderr + repository.stdout)) throw new Error(repository.stderr || 'Repository lookup failed.');
    log(`Creating public repository ${config.repository}…`);
    repository = api('user/repos', 'POST', { name, private: false, description: config.description, auto_init: false });
  }
  if (repository.data.private) throw new Error('The destination already exists as a private repository. This script will not change its visibility.');
  if (!repository.data.permissions?.admin) throw new Error('Repository administration access is required to apply the community settings.');
  if (remote.status !== 0) run('git', ['remote', 'add', 'origin', url]);
  // Select the active gh account without rewriting the machine's Git credential configuration.
  log('Pushing the reviewed main branch…');
  run('git', ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'push', '-u', 'origin', 'main']);
  api(`repos/${config.repository}`, 'PATCH', { ...config.settings, description: config.description });
  api(`repos/${config.repository}/topics`, 'PUT', { names: config.topics });
  api(`repos/${config.repository}/actions/permissions`, 'PUT', { enabled: true, allowed_actions: 'all' });
  api(`repos/${config.repository}/actions/permissions/workflow`, 'PUT', { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false });
  api(`repos/${config.repository}/actions/permissions/fork-pr-contributor-approval`, 'PUT', { approval_policy: 'first_time_contributors' });
  api(`repos/${config.repository}/private-vulnerability-reporting`, 'PUT');
  api(`repos/${config.repository}/vulnerability-alerts`, 'PUT');
  for (const label of config.labels) {
    const endpoint = `repos/${config.repository}/labels/${encodeURIComponent(label.name)}`;
    const existing = api(endpoint, 'GET', undefined, true);
    if (existing.status === 0) api(endpoint, 'PATCH', { new_name: label.name, color: label.color, description: label.description });
    else if (/HTTP 404|Not Found/i.test(existing.stderr + existing.stdout)) api(`repos/${config.repository}/labels`, 'POST', label);
    else throw new Error(existing.stderr || `Could not check label ${label.name}.`);
  }
  // Apply protection after the initial push has created main and launched the named CI jobs.
  api(`repos/${config.repository}/branches/main/protection`, 'PUT', config.protection);
  log(`Published https://github.com/${config.repository}. Verify all three CI jobs before announcing it.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { publishGitHub(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

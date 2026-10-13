# Troubleshooting

Start with the installed version and provider availability:

```sh
goddard --version
goddard doctor
goddard accounts --agent claude --probe
```

For Codex profiles, replace `claude` with `codex`. `goddard doctor --probe` additionally checks Codex's protocol, quota, and a small read-only sandbox command without starting a model turn.

## I cannot answer the agent

In a regular terminal, interaction is automatic. Wait for the `You` prompt; text entered while no prompt is active is not sent. An approval prompt answers only its displayed tool request.

If you used `--non-interactive` or redirected input/output, stop and resume directly in a terminal:

```sh
goddard run TASK_ID --agent claude --interactive
```

If an older release never shows a follow-up prompt after checkpoint messages, update Goddard. Version 0.5.2 fixed a case where multiple checkpoint requests prevented the follow-up prompt. Existing instructions can be saved after stopping the run:

```sh
goddard note TASK_ID "Yes, create a PR after the tests pass."
goddard run TASK_ID --agent claude --model sonnet --effort medium
```

Keep your chosen model, effort, and permission flags on the resumed invocation. [More on interaction](https://github.com/kggayo/goddard/wiki/Interactive-chat).

## Claude reports another process is refreshing its OAuth token

This is a provider authentication failure. A login-status probe can report a signed-in account even though refreshing its token later fails.

Follow [Claude's token-refresh troubleshooting](https://code.claude.com/docs/en/errors#could-not-refresh-your-login): retry after a minute; if it repeats, close other Claude Code sessions using the same profile. If it persists, sign in again through the affected Goddard profile:

```sh
goddard login main --agent claude
goddard run TASK_ID --agent claude --account main --model sonnet --effort medium
```

Replace `main` with the profile printed in `Using claude/…`. The explicit account keeps this retry on the profile you repaired. Omit `--account` later if you want automatic selection again.

Your Goddard task remains available; use its existing ID. `--interactive`, permission bypass, and `accounts reset` do not repair OAuth token-refresh locks. Do not delete credential files or locks while a provider process may be using them.

## “Skipping …: not logged in” or “quota unknown”

A skipped profile does not mean every profile is unusable. Automatic selection continues through available profiles of the chosen agent. Use `accounts --agent … --probe` to inspect them or `login NAME --agent …` to sign in.

Claude's login-status check does not expose quota, so `quota unknown` can be normal. It is not a promise that quota is available. [How selection works](https://github.com/kggayo/goddard/wiki/Accounts-and-models).

## “Run interrupted” or “checkpoint grace period ended”

After Ctrl+C, Goddard allows a short grace period for a final checkpoint. If that expires, it prepares the handoff using the last accepted checkpoint and available recorded evidence. The agent's final checkpoint may not have finished.

```sh
goddard status TASK_ID
goddard run TASK_ID --agent claude
```

Check the printed handoff and uncertain operations before resuming. An interrupted run does not automatically switch accounts. You can add a `note` first when you have an answer or correction.

## The workspace says it already has an unfinished run

Only one Goddard run may own a workspace. Check whether its original terminal or agent is still running. Stop it normally if so. After a crash, once the recorded processes have exited:

```sh
goddard recover
goddard status TASK_ID
goddard run TASK_ID --agent codex
```

Recovery refuses to run while the recorded processes are alive. It does not kill processes or restore files. [Recovery details](https://github.com/kggayo/goddard/wiki/Resuming-work#after-a-crash-or-forced-terminal-close).

## SQLite experimental warning

Some Node.js 24 versions print `ExperimentalWarning: SQLite is an experimental feature` when a database-backed command loads Node's built-in SQLite. That warning alone is not a task failure or an OAuth error; read any separate Goddard or provider error below it.

Current lightweight commands such as `--version`, `--help`, and `update` do not load SQLite. If the warning appears for `--version`, check which installation is being run:

```powershell
Get-Command goddard -All
```

On macOS or Linux:

```sh
command -v goddard
```

## Update is unknown, or the version did not change

Versions before 0.6.0 do not have `goddard update`. Install the latest package once:

```sh
npm install --global https://github.com/kggayo/goddard/releases/latest/download/goddard.tgz
goddard --version
```

On 0.6.0 or later, use `goddard update --check` and `goddard update`. If another copy is earlier on PATH, the command above may update a different installation. Source checkouts and `npm link` need their own update method. See [installation troubleshooting](https://github.com/kggayo/goddard/blob/main/docs/installing.md).

## Unsupported model or effort

Try omitting `--model` and `--effort` to use your selected profile's defaults. Confirm the requested values are supported by that provider's installed CLI and account. Goddard forwards these settings; it cannot grant model access. [Model options](https://github.com/kggayo/goddard/wiki/Accounts-and-models#choose-a-model-and-effort).

## Still stuck?

[Open an issue](https://github.com/kggayo/goddard/issues/new?template=bug_report.yml) with your OS, Node version, Goddard version, provider CLI version, sanitized command, expected behavior, and exact error. Review logs for private paths, source code, tokens, and account details before posting. Do not upload `.goddard/`, credential folders, or a whole recovery bundle to a public issue.

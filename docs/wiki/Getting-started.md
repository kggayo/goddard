# Getting started

## Install once

You'll need Node.js 24+, Git for Git workspaces, and an installed Claude Code or Codex CLI. Goddard uses those CLIs and their logins; installing Goddard does not install them. Projects without Git use bounded file snapshots. On Windows, Goddard needs the provider's native executable; see [installation verification](https://github.com/kggayo/goddard/blob/main/docs/usage.md#verify-the-installation) for executable overrides.

```sh
npm install --global https://github.com/kggayo/goddard/releases/latest/download/goddard.tgz
goddard --version
goddard doctor
```

The release package works on Windows, macOS, and Linux. It includes Goddard's runtime dependencies. No source checkout or npm account is needed. Goddard is distributed through GitHub Releases, so use the full URL above rather than an npm registry package with the same name.

If you already signed in through the provider CLI, Goddard can reuse that profile. Otherwise choose your provider and sign in once:

```sh
goddard login main --agent claude
```

Or:

```sh
goddard login main --agent codex
```

Select the intended account in the provider's login flow. [More accounts and model options](https://github.com/kggayo/goddard/wiki/Accounts-and-models).

## Start a task

Open a terminal in your project's root directory. For Git projects, use the repository root rather than a subdirectory:

```sh
cd path/to/your-project
goddard init
goddard start "Fix the login bug and run the relevant tests" --agent claude --model sonnet --effort medium
```

For Codex, use this instead:

```sh
goddard start "Fix the login bug and run the relevant tests" --agent codex --effort high
```

`init` creates the workspace's `.goddard/` store and adds it to `.gitignore`. `start` creates a task, prints its ID, saves its initial recovery information, and launches the selected agent. The default agent is Codex if you omit `--agent`.

For a longer goal, save a text file and use:

```sh
goddard start --goal-file goal.txt --agent codex --effort high
```

Use either a quoted goal or `--goal-file`. If launch or login fails, the task is still saved: find it with `goddard list`, then use `goddard run TASK_ID --agent …` to retry.

## Talk, stop, and continue

Interactive chat is on automatically when both input and output are terminals. Wait for the `You` prompt to send a follow-up. Enter or `/done` at that prompt saves and exits. Answer tool approvals at their own prompts. [How interaction works](https://github.com/kggayo/goddard/wiki/Interactive-chat).

Press Ctrl+C once to request a final checkpoint and stop. A second press stops immediately. Later, use the same task ID with `run`; add a `note` first if you have a new instruction. [Resume recipes](https://github.com/kggayo/goddard/wiki/Resuming-work).

## Update

Stop active Goddard runs, then run from any directory:

```sh
goddard update --check
goddard update
goddard --version
```

`--check` only checks for a newer stable release. `update` verifies the downloaded package against its release checksum and updates the global npm installation that launched it. Saved tasks and profile data stay in place.

`update` was added in 0.6.0. For older installations, run the installation command at the top of this page once. Source checkouts, `npm link`, and local npm installs can check for updates, but must be updated through their original installation method.

To uninstall the global package:

```sh
npm uninstall --global goddard
```

Uninstalling keeps your saved workspace tasks and profile data. See the [installation guide](https://github.com/kggayo/goddard/blob/main/docs/installing.md) for package verification and PATH troubleshooting.

## Development scripts

`goddard --version`, `goddard doctor`, and `goddard accounts --agent claude --probe` can check an installed release; use `--agent codex` for Codex profiles. These checks do not guarantee a model call will succeed.

Commands such as `npm test`, `npm run demo`, and `npm run preview` run only from a Goddard source checkout after `npm ci`. The release package excludes development scripts and tests. See the [developer checks](https://github.com/kggayo/goddard/blob/main/docs/usage.md#developer-checks-from-a-source-checkout) before using them.

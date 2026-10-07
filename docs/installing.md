# Bring Goddard home

Goddard is a terminal app for Windows, macOS, and Linux. Install **Node.js 24 or newer** (which includes npm), **Git** for Git workspaces, and the Codex CLI or Claude Code. Your coding agent still needs its usual account access. Goddard has no separate login or subscription.

## Install the latest release

```sh
npm install --global https://github.com/kggayo/goddard/releases/latest/download/goddard.tgz
goddard --version
goddard doctor
```

The package is hosted on [GitHub Releases](https://github.com/kggayo/goddard/releases), with its runtime dependencies included. You do not need an npm account or a copy of the source repository. Node.js and provider CLIs are not bundled. Use the full URL above: this project is not published as `goddard` on the npm registry.

If you previously used `npm link` from the source checkout, run `npm uninstall --global goddard` first to remove that development link, then install the release.

Go to your project and start a task:

```sh
cd path/to/your-project
goddard init
goddard new "Fix the login bug and run the relevant tests"
goddard run TASK_ID --agent codex --effort high
```

Replace `TASK_ID` with the ID printed by `new`. Use `--agent claude` for Claude Code. See the [full usage guide](usage.md) for login, models, effort, chat, approvals, and account switching.

## Specific versions and downloaded files

For the first release:

```sh
npm install --global https://github.com/kggayo/goddard/releases/download/v0.3.0/goddard.tgz
```

You can also download `goddard.tgz` and `SHA256SUMS` from the same release, compare the file's SHA-256 hash, then install locally:

```sh
npm install --global --offline ./goddard.tgz
```

On Windows, use `Get-FileHash ./goddard.tgz -Algorithm SHA256`; on macOS, use `shasum -a 256 goddard.tgz`; on Linux, use `sha256sum goddard.tgz`. Compare with `SHA256SUMS`. The release archive includes dependencies so the local-file installation does not need the npm registry. Provider login and model calls still need network access.

## Update or uninstall

Stop active Goddard runs, then rerun the latest-release install command to update. `goddard --version` confirms the installed version. These GitHub-hosted packages are not updated through `npm update -g goddard`.

```sh
npm uninstall --global goddard
```

Uninstalling removes the command and its package. Saved work in each project's `.goddard/` directory and account profiles stay on your computer. Keep those directories if you want to resume later.

## A few common bumps

- **Unsupported Node or SQLite errors:** check `node --version` and install Node.js 24+. Goddard uses Node's built-in SQLite; some Node 24 versions print an experimental warning.
- **PowerShell says `npm.ps1` or `goddard.ps1` cannot run:** use `npm.cmd` and `goddard.cmd`, or open Command Prompt. No execution-policy change is needed.
- **Command not found after installing:** reopen your terminal and check the npm global bin directory is on `PATH`. `npm prefix --global` shows the prefix; executables live directly there on Windows and in its `bin` subdirectory on macOS/Linux.
- **Global install permission denied:** use a user-owned Node/npm installation or a Node version manager; see [npm's permissions guide](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally).
- **Provider missing in `doctor`:** install your provider CLI and sign in. Windows requires the provider's native executable; see [installation verification](usage.md#verify-the-installation).

`goddard doctor` checks installed executables; it does not prove that your account is authenticated or has quota. If you get stuck, [open an issue](https://github.com/kggayo/goddard/issues/new?template=bug_report.yml) with your OS, Node version, Goddard version, and the error text, with private details removed.

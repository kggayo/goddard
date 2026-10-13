# Command reference

Examples target Goddard 0.6.0. Run `goddard --help` for your installed CLI. Replace `TASK_ID`, `NAME`, and `PATH` with your own values; don't type the placeholders literally. Choose either `--agent claude` or `--agent codex` where a provider is needed; the default is Codex.

## Everyday commands

| Command | Purpose |
| --- | --- |
| `goddard --version` | Show the installed version. `-v` also works. |
| `goddard --help` | Show commands and options. `-h` and `help` also work. |
| `goddard init` | Initialize the current workspace and ignore `.goddard/` in Git. |
| `goddard start "goal" --agent claude` | Create a task and start its first run. |
| `goddard start --goal-file goal.txt --agent codex` | Create and run a task from a text file. |
| `goddard new "goal"` | Create a saved task without launching an agent. Also accepts `--goal-file`. |
| `goddard list` | List saved tasks and their last run/checkpoint status. |
| `goddard status TASK_ID` | Show checkpoint, latest run, and handoff path. Omit the ID for the latest task. |
| `goddard run TASK_ID --agent claude` | Resume a task in a fresh provider session using its handoff. |
| `goddard note TASK_ID "instruction"` | Save an instruction for the next run. Stop the active workspace run first. |
| `goddard update --check` | Check for a newer stable release without installing it. |
| `goddard update` | Update the running global npm installation. Available since 0.6.0. |

Every `start` makes a new task. For an existing one, use `run`. [Start a task](https://github.com/kggayo/goddard/wiki/Getting-started) · [Note then run](https://github.com/kggayo/goddard/wiki/Resuming-work).

## Accounts and diagnostics

| Command | Purpose |
| --- | --- |
| `goddard login NAME --agent claude` | Sign in to a named provider profile. |
| `goddard accounts --agent claude` | List profiles and cached cooldowns. `accounts list` also works. |
| `goddard accounts --agent codex --probe` | Probe login and available quota without a model turn. |
| `goddard accounts add NAME --agent claude --path PATH` | Register an existing provider configuration directory. |
| `goddard accounts remove NAME --agent claude` | Remove its registration, keeping its files and login. |
| `goddard accounts reset NAME --agent claude` | Clear Goddard's cached quota cooldown; does not reset provider quota. |
| `goddard doctor` | Show Node version, workspace, and provider CLI availability. |
| `goddard doctor --probe` | Also test Codex protocol, quota, and a small read-only sandbox command. |

Account commands act on the selected provider. [Account setup and selection](https://github.com/kggayo/goddard/wiki/Accounts-and-models).

## Handoffs and recovery

| Command | Purpose |
| --- | --- |
| `goddard checkpoint TASK_ID --file progress.json` | Import a validated checkpoint while the workspace is stopped. |
| `goddard handoff TASK_ID` | Capture the stopped workspace and generate `HANDOFF.md`. |
| `goddard export TASK_ID --out .goddard/bundle.json` | Export a stopped task to a new JSON bundle filename. |
| `goddard unpack .goddard/bundle.json --out ../recovery-review` | Extract captured files and patches into a new directory for review. |
| `goddard import path/to/bundle.json` | Import task state into an initialized, matching workspace; never overwrite files. |
| `goddard recover` | Recover abandoned runs after their recorded processes exit. |

Import requires restoring the matching workspace first. Checkpoints have a defined JSON schema. Read the [recovery recipes](https://github.com/kggayo/goddard/wiki/Resuming-work) and [checkpoint format](https://github.com/kggayo/goddard/blob/main/docs/usage.md#what-is-saved) before using these advanced commands.

## Start and run options

| Option | Default / behavior |
| --- | --- |
| `--agent codex` / `--agent claude` | Codex by default. |
| `--model NAME` | Inherit selected profile's model default when omitted. |
| `--effort LEVEL` | Inherit provider default when omitted; support depends on model and account. |
| `--account NAME` | `auto`; explicit profile names pin that profile and disable failover. |
| `--no-failover` | Keep automatic startup selection, then stop at that profile's quota limit. |
| `--interactive` | Require a terminal for questions, approvals, and follow-ups. Interaction is already automatic when stdin/stdout are terminals. |
| `--non-interactive` | Disable input prompts. Also the default with redirected input/output. |
| `--plain` | Show original Markdown without terminal styling. |
| `--no-color` | Render Markdown without colors or text styles. |
| `--read-only` | Codex read-only sandbox or Claude planning mode; decline escalations. |
| `--dangerously-skip-permissions` | Bypass provider approvals; also disable Codex's sandbox. Explicit opt-in each invocation. |
| `--claude-permission-mode MODE` | Claude only: `acceptEdits` (default), `auto`, or `bypassPermissions`. |
| `--allow-tool RULE` | Repeatable Claude allow-tool rule, forwarded unchanged. |

[Permissions and bypass](https://github.com/kggayo/goddard/wiki/Permissions-and-bypass) explains the access these options grant and incompatible combinations. Explicit run settings survive automatic account failover, but must be repeated on your next `run` invocation.

## Checkpoint, capture, and usage options

| Option | Default | Accepted range |
| --- | --- | --- |
| `--checkpoint-seconds N` | 120 | 5–86400 seconds |
| `--snapshot-seconds N` | 15 | 1–3600 seconds |
| `--warn N` | 75 | 1–99 percent consumed |
| `--stop N` | 85 | 2–100 percent consumed; greater than `--warn` |
| `--grace-seconds N` | 30 | 0–300 seconds for a final checkpoint |
| `--max-seconds N` | 0 (unlimited) | 0–604800 seconds; budget carries across account attempts |

For example:

```sh
goddard run TASK_ID --agent codex --warn 70 --stop 80 --checkpoint-seconds 90
goddard run TASK_ID --agent claude --max-seconds 1800
```

Usage percentages mean **consumed**, not remaining. Where quota signals exist, Goddard requests an early checkpoint at the warning threshold and winds down at the stop threshold. Claude may supply warning/rejection events without a percentage. Unknown quota remains unknown; thresholds cannot guarantee stopping before a hard limit.

## Workspace and machine-readable output

Use the project root as your current directory, or specify it:

```sh
goddard list --workspace "path/to/your-project" --json
goddard status TASK_ID --json
goddard update --check --json
```

`--workspace PATH` defaults to the current directory. Other relative file arguments, such as `--goal-file`, `--file`, and `--out`, resolve from the shell's current directory; use absolute paths when combining them with `--workspace`.

`--json` prints structured command results. `start` and `run` remain live text streams and are not a JSON automation interface. `--check` is only valid with `update`.

| Run exit code | Meaning |
| --- | --- |
| `0` | Finished turn or prepared handoff. This does not prove the task is complete or verified. |
| `1` | Failure, including unavailable authentication. |
| `75` | Quota-limited stop. |
| `130` | Interrupted run. |

The checkpoint's `in_progress`, `blocked`, or `complete` status is separately reported by the agent. Inspect `goddard status TASK_ID` and verification evidence before treating work as finished.

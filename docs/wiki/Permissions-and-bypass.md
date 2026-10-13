# Permissions and bypass

All examples below apply to `start` and `run`. Replace `TASK_ID` with an existing task ID. Permission settings apply to the current invocation and its automatic account switches. Repeat your chosen flags on a later invocation; a saved handoff cannot enable bypass for you.

## Default behavior

| Provider | Goddard's default |
| --- | --- |
| Claude | `acceptEdits` permission mode. Additional tool approvals are presented in interactive runs and denied when input is unavailable. |
| Codex | `workspace-write` sandbox. Interactive runs use `on-request` approval; noninteractive runs use `never`. |

In an interactive run, review the command or requested scope and type `y` or `yes` to approve that request. Enter declines. Existing provider allow rules and organization policies still apply.

## Allow a specific Claude tool rule

For a narrower permission change, pass the provider's allow-tool rule:

```sh
goddard run TASK_ID --agent claude --allow-tool "Bash(npm test)"
```

Rules can be repeated:

```sh
goddard run TASK_ID --agent claude --allow-tool "Read" --allow-tool "Grep"
```

Goddard forwards each rule to Claude unchanged. Rules use Claude's syntax, not Goddard's own pattern language. Allowing a shell command grants access to what that command runs, including project-defined scripts. These rules do not configure Codex. See [Claude's permission reference](https://code.claude.com/docs/en/permissions) for supported patterns and policy precedence.

## Claude automatic permission review

```sh
goddard run TASK_ID --agent claude --claude-permission-mode auto
```

This selects the provider's `auto` mode, if supported by your Claude Code version and account. It is a separate mode from blanket bypass. Goddard's default is `acceptEdits` when no override is supplied.

## Bypass permission prompts

Use this only when you intend to grant the agent broad access to your machine. Commands can act with your OS user's access; Codex's sandbox is also disabled.

Claude:

```sh
goddard run TASK_ID --agent claude --model sonnet --effort high --dangerously-skip-permissions
```

Codex:

```sh
goddard run TASK_ID --agent codex --effort high --dangerously-skip-permissions
```

For a new task:

```sh
goddard start "Fix the failing tests" --agent codex --dangerously-skip-permissions
```

| Provider | What the shared flag selects |
| --- | --- |
| Claude | `bypassPermissions` mode. `--claude-permission-mode bypassPermissions` is equivalent. |
| Codex | `approvalPolicy: never` and `sandbox: danger-full-access`, disabling approvals and the filesystem/network sandbox. |

Goddard displays bypass at startup and records the setting in run evidence. Checkpoints, snapshots, handoffs, and quota handling continue. Provider and organization restrictions still apply.

**Bypass is about tool permissions.** It does not fix login errors, add quota, enable interactive input, or answer the agent's questions. Unexpected provider approval requests still use the normal handler and are declined without interactive input.

## Read-only or planning mode

```sh
goddard run TASK_ID --agent codex --read-only
goddard run TASK_ID --agent claude --read-only
```

This selects Codex read-only mode or Claude planning mode. Permission escalations are declined. The agent may be unable to write its checkpoint in this mode; Goddard still records available evidence.

## Combinations that produce an error

- `--read-only` with either form of permission bypass.
- `--dangerously-skip-permissions` with explicit Claude `acceptEdits` or `auto`.
- `--claude-permission-mode` with `--agent codex`.

To return to defaults on your next run, omit the bypass and permission-mode flags. See [Interactive chat](https://github.com/kggayo/goddard/wiki/Interactive-chat) for answering approvals and [Command reference](https://github.com/kggayo/goddard/wiki/Command-reference) for other run options.

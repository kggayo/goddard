# Permissions and bypass

Choose permissions using the same Goddard option for every supported coding agent:

```sh
goddard run TASK_ID --agent claude --permission-mode auto
goddard run TASK_ID --agent codex --permission-mode auto
```

All examples also apply to `start`. Replace `TASK_ID` with an existing task ID. Settings apply to the current invocation and its automatic account switches. Repeat your chosen flags on a later invocation; a saved handoff cannot enable bypass for you.

## Shared permission modes

| Mode | Goddard behavior |
| --- | --- |
| `default` | Normal editing with the agent's permission checks. Requests that reach Goddard go to the user when interactive and are denied without input. This is the default when omitted. |
| `auto` | Ask the agent to review eligible permission requests automatically, keeping its permission checks active. Requires a provider version and account that support automatic review. |
| `read-only` | Inspect and plan using the agent's read-only or planning mode. Goddard declines permission escalations. |
| `bypass` | Explicitly bypass provider approvals; also disable Codex's sandbox. Requires an explicit choice on each invocation. |

Goddard translates the shared mode inside the selected adapter. You do not need provider-specific permission flags. The providers enforce different boundaries, so a shared mode does not promise identical isolation:

| Goddard mode | Codex mapping | Claude mapping |
| --- | --- | --- |
| `default` | `workspace-write`, user review, `on-request` when interactive or `never` without input | `acceptEdits` |
| `auto` | `workspace-write`, `on-request`, `approvalsReviewer: auto_review` | `auto` |
| `read-only` | `read-only`, `never` | `plan` |
| `bypass` | `danger-full-access`, `never` | `bypassPermissions` |

In an interactive run, review the command or requested scope and type `y` or `yes` to approve that request. Enter declines. Existing provider allow rules and organization policies still apply. `--non-interactive` controls Goddard's prompts independently of permission mode.

## Advanced tool rules

The existing `--allow-tool` option remains a provider-native rule override for Claude, separate from the shared permission modes:

```sh
goddard run TASK_ID --agent claude --allow-tool "Bash(npm test)"
```

Rules can be repeated:

```sh
goddard run TASK_ID --agent claude --allow-tool "Read" --allow-tool "Grep"
```

Goddard forwards each rule to Claude unchanged. Rules use Claude's syntax, not Goddard's own pattern language. Allowing a shell command grants access to what that command runs, including project-defined scripts. These rules do not configure Codex. See [Claude's permission reference](https://code.claude.com/docs/en/permissions) for supported patterns and policy precedence.

## Automatic permission review

```sh
goddard run TASK_ID --agent claude --permission-mode auto
goddard run TASK_ID --agent codex --permission-mode auto
```

Codex reviews eligible sandbox-boundary approvals; Claude uses its permission classifier. Support depends on the installed provider and account. Goddard does not answer approval requests with yes automatically. User questions and approvals that still reach Goddard follow the normal interactive handler and are declined without input. See [Codex automatic review](https://learn.chatgpt.com/docs/sandboxing/auto-review) and [Claude permission modes](https://code.claude.com/docs/en/permissions).

## Bypass permission prompts

Use this only when you intend to grant the agent broad access to your machine. Commands can act with your OS user's access; Codex's sandbox is also disabled.

Claude:

```sh
goddard run TASK_ID --agent claude --model sonnet --effort high --permission-mode bypass
```

Codex:

```sh
goddard run TASK_ID --agent codex --effort high --permission-mode bypass
```

For a new task:

```sh
goddard start "Fix the failing tests" --agent codex --permission-mode bypass
```

| Provider | What `--permission-mode bypass` selects |
| --- | --- |
| Claude | `bypassPermissions` mode. |
| Codex | `approvalPolicy: never` and `sandbox: danger-full-access`, disabling approvals and the filesystem/network sandbox. |

Goddard displays bypass at startup and records the shared mode in run evidence. Checkpoints, snapshots, handoffs, and quota handling continue. Provider and organization restrictions still apply.

**Bypass is about tool permissions.** It does not fix login errors, add quota, enable interactive input, or answer the agent's questions. Unexpected provider approval requests still use the normal handler and are declined without interactive input.

## Read-only or planning mode

```sh
goddard run TASK_ID --agent codex --permission-mode read-only
goddard run TASK_ID --agent claude --permission-mode read-only
```

This selects Codex read-only mode or Claude planning mode. Permission escalations are declined. The agent may be unable to write its checkpoint in this mode; Goddard still records available evidence.

## Compatibility aliases and conflicts

Existing commands keep working. Use `--permission-mode` in new commands and scripts:

| Previous option | Shared equivalent |
| --- | --- |
| `--read-only` | `--permission-mode read-only` |
| `--dangerously-skip-permissions` | `--permission-mode bypass` |
| `--claude-permission-mode acceptEdits` | `--permission-mode default` |
| `--claude-permission-mode auto` | `--permission-mode auto` |
| `--claude-permission-mode bypassPermissions` | `--permission-mode bypass` |

The deprecated `--claude-permission-mode` alias still requires `--agent claude`. Aliases can accompany a shared mode only when they select the same mode. For example, `--permission-mode bypass --read-only` and `--permission-mode auto --dangerously-skip-permissions` fail before a task is created or a provider starts. Explicit `default` also conflicts with aliases selecting another mode.

To return to defaults on your next run, omit the bypass and permission-mode flags. See [Interactive chat](https://github.com/kggayo/goddard/wiki/Interactive-chat) for answering approvals and [Command reference](https://github.com/kggayo/goddard/wiki/Command-reference) for other run options.

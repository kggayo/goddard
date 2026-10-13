# Good dog. Great handoffs. 🐾

Welcome to the Goddard field guide. Goddard runs Claude Code or Codex CLI, saves progress, and prepares the next session to pick up unfinished work when a session stops or an account reaches its limit.

New here? Start with [Getting started](https://github.com/kggayo/goddard/wiki/Getting-started). Already mid-task? Jump to [Resuming work](https://github.com/kggayo/goddard/wiki/Resuming-work).

## Find what you need

| I want to… | Go here |
| --- | --- |
| Install, update, and start my first task | [Getting started](https://github.com/kggayo/goddard/wiki/Getting-started) |
| Find a command or flag | [Command reference](https://github.com/kggayo/goddard/wiki/Command-reference) |
| Answer the agent or approve a tool | [Interactive chat](https://github.com/kggayo/goddard/wiki/Interactive-chat) |
| Allow a tool, use read-only mode, or bypass permissions | [Permissions and bypass](https://github.com/kggayo/goddard/wiki/Permissions-and-bypass) |
| Add an instruction and continue an old task | [Resuming work](https://github.com/kggayo/goddard/wiki/Resuming-work) |
| Choose an account, model, or effort | [Accounts and models](https://github.com/kggayo/goddard/wiki/Accounts-and-models) |
| Fix a missing prompt, login error, or interrupted run | [Troubleshooting](https://github.com/kggayo/goddard/wiki/Troubleshooting) |
| Improve Goddard or these pages | [Contributing](https://github.com/kggayo/goddard/wiki/Contributing) |

## The everyday loop

Run these from the project you want to work on. Initialize it once, then create and start a task:

```sh
goddard init
goddard start "Fix the login bug and run the relevant tests" --agent claude --model sonnet --effort medium
```

Chat at the `You` prompt. Press Ctrl+C once to save progress and stop. To continue a stopped task later:

```sh
goddard list
goddard note TASK_ID "Yes, create a PR after the tests pass."
goddard run TASK_ID --agent claude --model sonnet --effort medium
```

Replace `TASK_ID` with the ID printed by `start` or `list`. `note` is optional when you have no new instructions. Use `run` to resume: every `start` creates a new task.

## What travels with the handoff?

The saved goal, your notes, the latest accepted checkpoint, outstanding operations, and bounded recent evidence help the next agent continue. Workspace changes are captured separately. A resumed run starts a fresh provider session; it does not restore private model reasoning or replay every conversation message.

Automatic failover uses available profiles of the chosen provider. You can also switch from Claude to Codex, or back, with `run --agent …`. Each account still has its own quota and provider rules; Goddard cannot create extra quota.

These pages describe **Goddard 0.6.0**. See the [latest release](https://github.com/kggayo/goddard/releases/latest) and run `goddard --help` to check your installed version's options.

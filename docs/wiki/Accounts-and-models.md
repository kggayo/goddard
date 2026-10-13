# Accounts and models

Goddard supports Claude Code and Codex CLI today. Each provider must be installed, and each account must be signed in once. DeepSeek, Muse, Kimi, Grok, and Gemini are [roadmap investigations](https://github.com/kggayo/goddard/blob/main/ROADMAP.md), not current `--agent` values.

## Add accounts once

Choose the intended account in each login flow:

```sh
goddard login personal --agent claude
goddard login work --agent claude
```

Or, for Codex:

```sh
goddard login personal --agent codex
goddard login work --agent codex
```

These names label separate configuration directories. Names start with a lowercase letter and contain 1–50 lowercase letters, digits, hyphens, or underscores. `auto`, `current`, `default`, `discovered-*`, and Windows device names are reserved. Signing the same provider account into two directories does not give it more quota.

To sign in to the current CLI configuration instead, run `claude auth login` or `codex login` in that configuration's environment. Native login commands do not automatically repair a separate named Goddard profile.

New managed profiles live under `~/.goddard/profiles/<provider>/<name>`. Registrations and quota cooldowns live in `~/.goddard/accounts.sqlite`. `GODDARD_HOME` can relocate this global directory; keep it outside your project. Workspace tasks live separately in the project's `.goddard/` directory.

## Automatic selection is the default

```sh
goddard run TASK_ID --agent claude --model sonnet --effort medium
```

Without `--account`, Goddard uses `auto` and checks:

1. The current CLI configuration.
2. Registered profiles, sorted by name.
3. The default configuration, if different from the current one.
4. Discoverable sibling profile directories, sorted by name.

It selects the first profile not known to be logged out or quota-limited. This is availability selection, not a ranking by remaining quota. Unknown quota is allowed. An initial login-status check can succeed even if a later token refresh fails.

On a quota stop, Goddard requests a final checkpoint when possible, waits for the old process to exit, saves available progress, and starts a fresh session on the next profile using the handoff. Each configuration directory is attempted at most once per invocation. Switching stays within `--agent`.

When all profiles are unavailable, the run stops with a saved handoff. It does not wait indefinitely for quota to reset. Authentication failures, Ctrl+C, duration limits, and unrelated provider errors do not trigger quota failover.

## Inspect, pin, or register profiles

```sh
goddard accounts --agent claude
goddard accounts --agent claude --probe
goddard accounts --agent codex --probe
```

`--probe` checks authentication and available quota information without starting a model turn. Claude's login-status probe does not expose subscription quota, so `quota unknown` is expected; Goddard learns available limit signals during a supervised run. Codex can expose quota through its App Server.

Pin one profile, which disables failover:

```sh
goddard run TASK_ID --agent claude --account personal
goddard run TASK_ID --agent codex --account current
```

Or select automatically at startup but stop at that account's limit:

```sh
goddard run TASK_ID --agent codex --no-failover
```

Register an existing profile by its configuration directory:

```sh
goddard accounts add work --agent claude --path "C:/Users/me/claude-work"
goddard accounts add work --agent codex --path "C:/Users/me/codex-work"
```

Use your actual directory on Windows, macOS, or Linux. `current` honors `CLAUDE_CONFIG_DIR` or `CODEX_HOME`, otherwise using `~/.claude` or `~/.codex`. Goddard can also discover direct `~/.claude-*` and `~/.codex-*` directories with recognizable configuration files. Use the names printed by `accounts`.

## Profile maintenance

```sh
goddard accounts reset personal --agent claude
goddard accounts remove work --agent claude
```

`reset` clears Goddard's cached quota cooldown after a login change; it does not reset provider quota, remove OAuth locks, or sign you in. Without a provider reset time, the default cooldown is five minutes.

`remove` forgets a registration without deleting its configuration or credentials. A directory that matches discovery rules can still appear as a discovered profile.

Goddard does not copy credentials between profiles or into handoffs. Provider settings, plugins, and native session histories stay with their profile. Configure those separately if needed. The `current` profile preserves inherited provider/API-key settings; named profiles isolate common inherited authentication overrides.

## Choose a model and effort

```sh
goddard start "Review the authentication flow" --agent claude --model sonnet --effort medium
goddard run TASK_ID --agent codex --effort high
```

`--model` is passed to the selected provider. Use an alias or exact model ID supported by your installed CLI and account. Omit it to use that profile's default. Goddard does not maintain a model catalog or translate a model name between providers.

| Provider | Effort values accepted by Goddard |
| --- | --- |
| Claude | `low`, `medium`, `high`, `xhigh`, `max` |
| Codex | Provider effort labels, such as `low`, `medium`, `high`, `xhigh` |

Actual support depends on the model, installed provider CLI, and account policy. Identical labels do not promise identical compute budgets. An unavailable model produces an error; Goddard does not silently substitute another one.

Explicit model and effort choices carry across automatic account switches during one invocation. When omitted, the next profile's defaults may differ. Repeat your chosen options when you resume with a new `run` command.

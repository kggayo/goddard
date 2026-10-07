# Goddard: the full usage guide

[← Back to the project](../README.md)

Keep a coding task moving when an agent stops. Goddard runs Codex or Claude Code, saves progress and workspace evidence locally, and prepares a handoff that another session can use.

Goddard **0.3.0** is a local command-line supervisor. It uses your installed coding CLIs, selects an available account profile automatically, and makes no direct model API calls of its own. Its terminal renderer uses Marked, highlight.js, and ANSI-aware text layout libraries.

Every Goddard run uses the managed interface so progress, conversation evidence, tool events, and workspace changes can be captured for handoff. Interact with the agent through Goddard.

## Get started

Requirements: **Node.js 24+**, Git for Git workspaces, and at least one installed coding CLI. Reuse an existing login or sign in through `goddard login` below. On Windows, Goddard launches native `.exe` files directly, without shell command interpolation. Node 24 may print an experimental warning for its built-in SQLite module.

From this checkout:

```powershell
npm install
npm link
goddard doctor
```

Or use `node C:/path/to/goddard/bin/goddard.js` in place of `goddard`. No global installation is required.

In your project's root directory:

```powershell
goddard init
goddard new "Fix the failing login flow and verify it with the relevant tests"
```

Copy the task ID from the result:

```powershell
goddard run TASK_ID --agent codex
```

Goddard enables interactive prompts automatically when run in a terminal. After each agent turn, type a follow-up, or press Enter / type `/done` to save and exit. Press **Ctrl+C once** to request a checkpoint and stop; press it again to stop immediately. The first interrupt allows up to 30 seconds for the checkpoint. If the agent is already blocked, Goddard uses its previous checkpoint and recorded evidence.

Continue in a fresh session:

```powershell
goddard run TASK_ID --agent claude
```

The destination receives the original goal, user updates, accepted checkpoint, outstanding operations, recent evidence, and the same workspace files. When an account hits the quota threshold or reports a quota rejection, Goddard automatically tries another profile of the chosen provider. Credentials are not part of the handoff.

All workspace commands accept `--workspace PATH`. Use the Git repository root, not a subdirectory. Projects without Git are supported with bounded file snapshots.

## Login, model, and effort

**Do I need to log in first?** Each account needs a one-time sign-in through its provider. An existing CLI login works without extra setup. Goddard also provides a login helper that launches the provider's normal sign-in flow in an isolated profile. You only need both CLIs authenticated if you intend to use both providers. Goddard has no separate account or subscription.

```powershell
codex login
claude auth login
```

Run the appropriate command for your provider. `goddard doctor` checks installed executables; it does not prove that authentication or model access works. `doctor --probe` additionally checks Codex's protocol, account quota, and sandbox without starting a model turn.

**How do I choose a model and effort?** Set them per run:

```powershell
# Replace YOUR_CODEX_MODEL with a model available to your Codex account.
goddard run TASK_ID --agent codex --model YOUR_CODEX_MODEL --effort high
goddard run TASK_ID --agent claude --model sonnet --effort medium
```

Omit either flag to inherit that provider's configured default. Goddard does not edit your global CLI settings. Codex receives the effort on each turn. Claude receives `--effort`; Goddard removes an inherited `CLAUDE_CODE_EFFORT_LEVEL` from that child process so it cannot override your explicit selection. Your parent shell environment is unchanged.

Claude accepts `low`, `medium`, `high`, `xhigh`, and `max` through Goddard. Codex accepts a provider effort label, such as `low`, `medium`, `high`, or `xhigh`. The selected model, CLI version, and account policies determine actual support; the same label is not an equivalent compute budget across providers. Claude organization limits can cap the requested effort. See the [Claude model and effort reference](https://code.claude.com/docs/en/model-config) and [Codex App Server turn options](https://developers.openai.com/codex/app-server).

Explicit model, effort, permission, and display options carry across automatic account switches. If model or effort is omitted, the selected profile's provider defaults apply and may differ between profiles. A model unavailable on the next account produces a provider error; Goddard does not silently choose another model.

## Automatic account selection

`--account auto` is the default for both providers. No account-pool file or environment-variable setup is required. Goddard checks profiles in this order: the current CLI configuration, registered profiles by name, the default configuration if different from the current one, then discovered sibling directories by name. It uses the first profile that is not known to be logged out or quota-limited. This is availability selection, not load balancing by remaining quota.

Add another account once, choosing the intended account in the login page:

```powershell
goddard login work --agent codex
goddard login personal --agent codex

# Or use Claude accounts:
goddard login work --agent claude
goddard login personal --agent claude
```

Then use the usual command; selection and quota failover are automatic:

```powershell
goddard run TASK_ID --agent codex --effort high
goddard run TASK_ID --agent claude --model sonnet --effort medium

# Inspect profile names, directories, and cached cooldowns.
goddard accounts --agent codex
goddard accounts --agent claude --probe
```

`accounts --probe` checks login status and any available quota without starting a model turn. Codex exposes quota through App Server. Claude's login-status command does not expose subscription quota; Goddard learns from rate-limit events during supervised runs. Unknown quota stays unknown and does not prevent trying a profile. Probes that cannot determine authentication report that uncertainty rather than claiming a successful login. See the [Codex account endpoints](https://learn.chatgpt.com/docs/app-server) and [Claude authentication commands](https://code.claude.com/docs/en/cli-reference).

On a quota stop, Goddard requests a final checkpoint when possible, waits for the old process to exit, saves the checkpoint and workspace evidence, and launches a **fresh provider session** on the next account with the handoff. It holds workspace ownership across the transition. It attempts each configuration directory at most once per invocation. Each distinct directory is treated as a profile; signing the same account into two directories does not create additional quota.

Known exhausted profiles are skipped until the reported reset time; when no reset is supplied, the cooldown is five minutes. If every profile is unavailable, Goddard saves the handoff and exits (`75` when quota-limited, `1` when no login is available). It does not wait indefinitely for a reset. Ctrl+C, the duration limit, and unrelated provider failures stop execution rather than starting another account. The duration budget carries across attempts. Automatic switching stays within `--agent`; changing from Claude to Codex remains explicit.

**Existing profile folders:** Goddard honors `CODEX_HOME` or `CLAUDE_CONFIG_DIR` for `current`, otherwise using `~/.codex` or `~/.claude`. It discovers direct `~/.codex-*` and `~/.claude-*` directories with recognizable configuration or credential filenames, without reading credential contents. Discovery names look like `discovered-work`; use the names printed by `accounts`. Register profiles elsewhere by their configuration directory:

```powershell
goddard accounts add work --agent claude --path C:/Users/me/claude-work
goddard accounts add work --agent codex --path C:/Users/me/codex-work

# Pin a profile and disable switching for this run.
goddard run TASK_ID --agent claude --account work
goddard run TASK_ID --agent codex --account current

# Select automatically at startup, but stop when that account hits its limit.
goddard run TASK_ID --agent codex --no-failover

# After changing a profile's login outside Goddard, clear any old quota cooldown.
goddard accounts reset current --agent claude

# Remove only the registration; leave credentials and configuration on disk.
goddard accounts remove work --agent claude
```

An unregistered directory matching the discovery pattern can still appear as a discovered profile. `login NAME` reuses an existing registration's directory; for a new name it creates `~/.goddard/profiles/<provider>/<name>`. Profile registrations and quota cooldowns live in `~/.goddard/accounts.sqlite`. Set `GODDARD_HOME` to change this global location; keep it outside the project. The workspace's own `.goddard/` remains the task and handoff store.

The provider CLI owns the login credentials, including those it writes inside Goddard-managed profile directories. New managed Codex profiles use file credential storage under their own `CODEX_HOME`. Existing configurations are not rewritten. Claude uses its normal credential storage for the selected `CLAUDE_CONFIG_DIR`, as described in [Claude's profile configuration](https://code.claude.com/docs/en/env-vars); Codex storage is documented in [Codex authentication](https://learn.chatgpt.com/docs/auth). Goddard does not copy credential files between profiles or into handoffs. Native session histories, user-level plugins, and settings stay with their profile; configure them separately if needed.

The `current` profile preserves inherited API-key and external-provider setups. Other profiles receive their own configuration directory, with common inherited API-key/OAuth overrides and Claude cloud-provider switches removed from the child environment so those overrides cannot silently replace the selected login. Profile-defined settings and organization policies still apply. The parent shell environment is unchanged.

**Does this forward the whole conversation or the agent's exact memory?** No. Goddard forwards the saved goal, user notes, structured checkpoint, outstanding operations, and bounded recent evidence. It preserves workspace changes independently. The local database retains recorded events, but the handoff is not a replay of every conversation message, and private model state is not transferred. Account failover uses the same recovery mechanism as switching coding agents.

## Interact with your agent

**Will questions and confirmations appear in Goddard?** Yes, when interactive prompts are enabled:

```powershell
goddard run TASK_ID --agent codex --effort high --interactive
goddard run TASK_ID --agent claude --interactive
```

Goddard prints agent messages, presents structured questions with numbered options or free-text answers, and shows permission requests with their command, tool input, or requested scope. Type `y` or `yes` to approve; Enter or any other response declines. Goddard does not save permanent approval rules. Additional Codex permission grants are limited to the displayed turn scope. Claude's existing permission mode and allow rules may permit actions without a new prompt.

For questions, enter an option number or your own text. Claude questions supporting multiple choices accept comma-separated option numbers. Enter or `/cancel` skips a question. Plain-text questions can be answered at the follow-up prompt after the turn. Question answers and follow-ups become saved user updates. `/done` ends the run at that prompt; other text is sent as a new turn in the same provider session. Provider slash commands, rich widgets, and secret-input prompts are not implemented. Unsupported requests are declined or left unanswered.

When input/output is redirected, Goddard disables interactive prompts. `--non-interactive` explicitly selects that behavior, and `--interactive` requires a terminal. Requests requiring user input are declined or left unanswered, never automatically approved by Goddard. Provider permission rules still apply. Periodic checkpoint prompts pause while waiting for user input; file capture and available quota monitoring continue.

### Terminal appearance

In a regular terminal, agent replies render as Markdown: styled headings, bold/italic text, lists and checklists, quotes, links, and tables. Fenced code blocks use their language label for syntax highlighting, including JavaScript, TypeScript, Python, JSON, and shell languages supported by highlight.js. Unknown or unlabelled languages stay readable without guessed highlighting. Fenced `diff` or `patch` blocks use green additions, red removals, and distinct headers; the `+` and `-` signs remain visible.

Codex, Claude, Goddard status messages, and your input have distinct labels. Approval details retain their literal command/input content with JSON highlighting. Incoming status and reply output waits while you are typing an answer, then appears after the prompt is answered or canceled. Prose and tables adapt to terminal width; code retains its indentation and uses the terminal's normal line wrapping.

```powershell
# Styling is automatic in a terminal.
goddard run TASK_ID --agent codex --interactive

# Keep formatted Markdown, but disable colors and text styles.
goddard run TASK_ID --agent claude --no-color

# Show the original Markdown as plain text.
goddard run TASK_ID --agent codex --plain

# Preview replies, code, a diff, and an approval without using model quota.
npm run preview
```

`NO_COLOR` (when nonempty) and `NODE_DISABLE_COLORS=1` disable color and text styles. Redirected output and `TERM=dumb` use plain text automatically. Font family and size come from your terminal settings. Goddard renders completed messages/blocks; this is not character-by-character streaming or a copy of either provider's original interface.

Formatting applies only to display. Event records, checkpoints, and exported handoffs keep their original text and receive no renderer-generated color codes. Provider-supplied terminal controls are stripped before display. Messages too large to format or code with unsupported syntax fall back to readable text so formatting does not prevent a handoff.

## What is saved

**Does the managed interface capture workspace changes and agent-written checkpoints?** Yes. Both interactive and noninteractive runs save those, along with the goal, user updates, agent messages, tool activity and results, and available usage signals. Goddard requests progress updates and captures files independently so a failed or missing checkpoint is not the only evidence available to the next agent. The capture limits and provider differences below still apply.

The local `.goddard/` directory contains:

```text
.goddard/
  state.sqlite                 Task, run, event, checkpoint, and snapshot records
  state.sqlite-wal              SQLite write-ahead log, when open
  objects/<sha256>              Captured file contents
  tasks/<task-id>/
    checkpoint.json            Agent-editable progress record
    HANDOFF.md                  Generated, readable recovery brief
```

`init` adds `.goddard/` to the workspace's `.gitignore`. Do not copy only `state.sqlite` while a run is open: use `export` after it stops. Export includes the most recent snapshot and up to 1,000 recent events; the local database retains all recorded events.

The agent is instructed to update this checkpoint before substantial work, after milestones, and before finishing. Goddard also requests updates every two minutes by default:

```json
{
  "schemaVersion": 1,
  "status": "in_progress",
  "currentActivity": "Updating the login callback",
  "plan": ["Fix callback", "Run authentication tests"],
  "completed": ["Reproduced expired-session failure"],
  "decisions": ["Keep the existing session-cookie format"],
  "nextSteps": ["Run the authentication test suite"],
  "blockers": [],
  "verification": ["Regression test fails on the original code"],
  "uncertainOperations": []
}
```

Checkpoint updates are schema-validated. A partial or malformed write cannot replace the last accepted checkpoint in SQLite. Checkpoints describe decisions and working state; exact internal model state is not transferred. An agent can still omit information or stop before its first checkpoint, so Goddard also records tool evidence and captures files independently.

`finished` means the conversation ended after a successful turn. It does **not** mean the task is verified. The checkpoint has a separate `in_progress`, `blocked`, or `complete` status, reported by the agent.

## Commands

| Command | Purpose |
| --- | --- |
| `goddard init` | Initialize the current workspace |
| `goddard new "goal"` | Create a task |
| `goddard new --goal-file goal.txt` | Read a longer task description |
| `goddard list` | List tasks and last run status |
| `goddard status TASK_ID` | Inspect a task and its latest checkpoint |
| `goddard run TASK_ID --agent codex` | Start Codex with the recovery brief |
| `goddard run TASK_ID --agent claude` | Start Claude Code with the recovery brief |
| `goddard login NAME --agent codex\|claude` | Sign in to a named profile through the provider CLI |
| `goddard accounts --agent codex\|claude [--probe]` | Discover profiles and optionally check login / quota |
| `goddard accounts add NAME --agent codex\|claude --path PATH` | Register an existing profile directory |
| `goddard accounts remove NAME --agent codex\|claude` | Forget a registration without deleting its files |
| `goddard accounts reset NAME --agent codex\|claude` | Clear cached quota cooldown |
| `goddard note TASK_ID "instruction"` | Add a user instruction before the next run |
| `goddard checkpoint TASK_ID --file progress.json` | Import a validated checkpoint while stopped |
| `goddard handoff TASK_ID` | Capture the stopped workspace and generate its brief |
| `goddard export TASK_ID --out bundle.json` | Export a bundle while stopped |
| `goddard unpack bundle.json --out recovery-files` | Extract captured files and patches into a new directory |
| `goddard import bundle.json` | Import task state into a matching workspace |
| `goddard recover` | Mark abandoned runs interrupted after their processes exit |
| `goddard doctor --probe` | Check executables, Codex protocol, quota, and a read-only sandbox command without a model turn |

Use `--json` for structured command output. Run output is a live text stream. Exit codes: `0` for a finished turn or prepared handoff, `1` for failure, `75` for a quota stop, and `130` for interruption.

## Usage monitoring and permissions

Codex uses the local App Server protocol: account quota reads and notifications, thread/turn events, steering, and interruption. Goddard checks quota before starting a turn and polls during a run. It requests an early checkpoint at **75% consumed** and winds down at **85%**. All reported quota buckets are considered. Missing, expired, or stale measurements remain unknown.

Claude Code uses its `stream-json` protocol. Rate-limit events can include utilization, warning, or rejection signals. Exact percentages are not always supplied; Goddard does not manufacture them from token counts. Checkpoint prompts are queued through streaming input and may not be processed until a safe boundary. A hard quota rejection preserves the handoff without asking for another model response.

These thresholds are policies, not guarantees: account usage may change outside the supervised session, and one request may use more capacity than expected.

```powershell
goddard run TASK_ID --agent codex --warn 70 --stop 80 --checkpoint-seconds 90
goddard run TASK_ID --agent claude --max-seconds 1800
```

Codex runs with its workspace-write sandbox. Interactive runs use `on-request` approval; noninteractive runs use `never`. Goddard never automatically approves an additional permission request. Claude defaults to `acceptEdits`; shell commands requiring additional permission are presented in interactive mode and denied in noninteractive mode. Choose Claude's automatic permission review if supported by your version, or explicitly allow a narrow tool rule:

```powershell
goddard run TASK_ID --agent claude --claude-permission-mode auto
goddard run TASK_ID --agent claude --allow-tool "Bash(npm test)"
```

Goddard does not use either provider's permission-bypass flag. `--read-only` selects Codex read-only mode or Claude planning mode; an agent in that mode may be unable to write its checkpoint. Read-only runs decline permission escalations. Normal CLI account/API billing and policy still apply.

## Recovery and portability

Only one supervised run may own a workspace at a time. Goddard waits for its child process to exit before releasing that lock. After a supervisor crash:

```powershell
goddard recover
goddard status TASK_ID
goddard run TASK_ID --agent claude
```

Recovery refuses to proceed while a recorded supervisor or child PID is alive. Inspect and stop the original process if necessary. Goddard will not kill an old PID automatically, because operating systems can reuse PIDs. Detached background processes or external actions may survive a process failure; inspect the handoff's outstanding operations before repeating them.

For a different machine, export a bundle outside the project or inside `.goddard/`. `unpack` extracts file contents, a manifest, and staged/unstaged Git patches for review. A Git bundle here contains **changes relative to the recorded commit**, not the whole repository: obtain that repository and base commit separately, restore its changes and relevant new files, initialize Goddard there with `init`, and then `import` the original JSON bundle. Import validates captured file hashes and Git HEAD; it never overwrites destination files. Deletions, exclusions, modes, and warnings are listed in the manifest. It does not automatically replay commands or external actions.

Captures preserve both index and worktree patches, including staged and unstaged changes that cancel each other out. Untracked files are captured too. Defaults exclude secrets by filename, generated directories, symlinks, submodules, files larger than 2 MiB, and captures exceeding 32 MiB. These omissions are recorded. A snapshot is **not a complete backup**. Credentials and generated dependencies must be supplied separately on a new machine.

Common credentials are redacted from event records, and reasoning events are omitted. Redaction is best effort: checkpoint text, source files, patches, and tool outputs may contain private project information. Bundles are local, unencrypted artifacts; review them before sharing.

## Verify the installation

```powershell
npm test
npm run check
npm run demo
```

The offline demo launches simulated provider processes through the real adapters. It deliberately crashes the Codex source after corrupting its last checkpoint write, then resumes through the Claude adapter and verifies the saved next step and workspace files. Tests also exercise account discovery, environment isolation, preflight selection, quota failover for both providers, preserved instructions/files/uncertain operations, interactive approvals after switching, cooldowns, pinned profiles, interruption, and workspace ownership during handoff. The existing rendering, recovery, and interaction checks remain in the suite. These checks use no model quota. Demo output is retained under `.tmp/demo-*` for inspection. Automated account-switch tests use simulated logins; they do not prove live access for a particular subscription or model.

Explicit live smoke tests use the CLI's existing authentication and quota, and work only in a new `.tmp/live-*` directory:

```powershell
node scripts/smoke.js codex
node scripts/smoke.js claude
```

If Claude reports an expired OAuth session, sign in using the Claude CLI and retry. If `doctor --probe` reports a Codex Windows sandbox setup error, repair that sandbox through Codex's supported setup before running file-editing tasks. Goddard does not disable the sandbox to work around setup failures. `GODDARD_CODEX_BIN` and `GODDARD_CLAUDE_BIN` can select an absolute native executable path when it is not on PATH.

## Scope of version 0.3

This version supervises sessions it launches and automatically selects and switches configured account profiles on quota stops. It does not attach to arbitrary desktop chats, restore remote environments, transfer browser state, or provide a dashboard. Switching agents is explicit. Checkpoint requests are best effort; evidence capture continues independently. No additional agent framework or hosted service is required for the supervisor.

Implementation: `src/accounts.js` discovers profiles, handles login, and probes availability; `src/runner.js` selects accounts and coordinates failover; `src/store.js` handles durable SQLite state; `src/workspace.js` captures changes; `src/adapters/` isolates provider protocols; `src/interaction.js` handles prompts; `src/terminal.js` renders terminal output; `src/supervisor.js` coordinates checkpoint requests, quota policy, process shutdown, and handoffs.

Provider references: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Claude Code programmatic usage](https://code.claude.com/docs/en/headless), and [Anthropic's SDK protocol types](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/types.py). Installed protocol schemas take precedence where documentation examples differ.

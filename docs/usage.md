# Goddard: the full usage guide

[← Back to the project](../README.md) · [Browse the wiki](https://github.com/kggayo/goddard/wiki) · [Command and option reference](wiki/Command-reference.md)

Keep a coding task moving when an agent stops. Goddard runs Codex or Claude Code, saves progress and workspace evidence locally, and prepares a handoff that another session can use.

Goddard **0.6.0** is a local command-line supervisor. It uses your installed coding CLIs, selects an available account profile automatically, and makes no direct model API calls of its own. Its terminal renderer uses Marked, highlight.js, and ANSI-aware text layout libraries.

Every Goddard run uses the managed interface so progress, conversation evidence, tool events, and workspace changes can be captured for handoff. Interact with the agent through Goddard.

## Get started

Requirements: **Node.js 24+**, Git for Git workspaces, and at least one installed coding CLI. Reuse an existing login or sign in through `goddard login` below. On Windows, Goddard launches native `.exe` files directly, without shell command interpolation. Some Node 24 versions print an experimental SQLite warning for database-backed commands; version, help, and update commands do not load SQLite.

Install the latest release:

```powershell
npm install --global https://github.com/kggayo/goddard/releases/latest/download/goddard.tgz
goddard --version
goddard doctor
```

See the [installation guide](installing.md) for specific versions, updates, and troubleshooting. To work from a source checkout instead, run `npm ci` then `npm link`, or use `node C:/path/to/goddard/bin/goddard.js` in place of `goddard`.

After installing 0.6.0 or later, stop active runs and use `goddard update` to install the latest stable release. `goddard update --check` only checks for availability; add `--json` for machine-readable output. These commands work outside a project and do not open the task database. Older versions need the npm install command above once to get this feature. Source checkouts and `npm link` installations can check for releases but must update their checkout manually.

In your project's root directory:

```powershell
goddard init
goddard start "Fix the login bug and run the relevant tests" --agent codex --effort high
```

Or choose Claude:

```powershell
goddard start "Fix the login bug and run the relevant tests" --agent claude --model sonnet --effort medium
```

`start` combines task creation and execution. It accepts all the same options as `run`, including model, effort, account selection, interaction, and permission bypass. The default agent is Codex if `--agent` is omitted. For longer goals, use `goddard start --goal-file goal.txt --agent codex`. Supply either a goal or a goal file. Run `init` once per workspace first.

Each `start` creates a new task, saves its goal, initial checkpoint file, snapshot, and handoff before launching the agent, and prints its ID and a resume command. If login or launch fails, the saved task remains available: use `goddard list` to find it and `goddard run TASK_ID` to retry. Repeating `start` creates another task. Model, effort, account, and permission options are per invocation; specify them again when resuming. To create a task without running an agent, use `goddard new "goal"` as before.

Goddard enables interactive prompts automatically when both input and output are terminals. Wait for the `You` prompt to type a follow-up, or press Enter / type `/done` to save and exit. Press **Ctrl+C once** to request a checkpoint and stop; press it again to stop immediately. The default grace period is 30 seconds; `--grace-seconds` changes it. If no final checkpoint arrives, Goddard uses its previous accepted checkpoint and recorded evidence.

Continue in a fresh session:

```powershell
goddard run TASK_ID --agent claude --model sonnet --effort medium
```

The destination receives the original goal, user updates, accepted checkpoint, outstanding operations, recent evidence, and the same workspace files. When an account hits the quota threshold or reports a quota rejection, Goddard automatically tries another profile of the chosen provider. Credentials are not part of the handoff.

All workspace commands accept `--workspace PATH`. Use the Git repository root, not a subdirectory. Projects without Git are supported with bounded file snapshots. Other relative file arguments, including `--goal-file`, `--file`, and `--out`, resolve from the shell's current directory; use absolute paths when combining them with `--workspace`.

## Resume a stopped task

Run these from the same project root. Replace `TASK_ID` with the ID from `start` or `list`:

```sh
goddard list
goddard status TASK_ID
goddard note TASK_ID "Yes, create a PR after the relevant tests pass."
goddard run TASK_ID --agent claude --model sonnet --effort high
```

`note` saves your instruction and refreshes the handoff; it does not launch an agent. Skip it when you have no new instructions. Stop any active run in the workspace before adding a note. During an interactive run, use the `You` prompt instead.

`run` starts a fresh provider session with the existing task's handoff and workspace. Use the same task ID after an interruption or login failure; another `start` would create another task. Repeat your chosen agent, model, effort, account, and permission flags on each invocation. In particular, bypass is never restored from the handoff.

To switch providers explicitly, use `goddard run TASK_ID --agent codex --effort high` or the Claude command above. Pin a profile with `--account NAME`, which disables automatic failover. A normally stopped run needs no `recover`; use [recovery](#recovery-and-portability) after a crash only once the original processes have exited. The [wiki resume guide](https://github.com/kggayo/goddard/wiki/Resuming-work) also covers exporting work to another machine.

## Login, model, and effort

**Do I need to log in first?** Each account needs a one-time sign-in through its provider. An existing CLI login works without extra setup. Goddard also provides a login helper that launches the provider's normal sign-in flow in an isolated profile. You only need both CLIs authenticated if you intend to use both providers. Goddard has no separate account or subscription.

```powershell
goddard login main --agent codex
# Or:
goddard login main --agent claude
```

Run the appropriate command for your provider. To sign in to the current CLI configuration instead of a named Goddard profile, use `codex login` or `claude auth login` in that configuration's environment. Those native commands do not automatically repair a separate named profile.

Profile names such as `main` or `work` start with a lowercase letter and contain 1–50 lowercase letters, digits, hyphens, or underscores. `auto`, `current`, `default`, `discovered-*`, and Windows device names are reserved. `goddard doctor` checks installed executables; it does not prove that authentication or model access works. `doctor --probe` additionally checks Codex's protocol, account quota, and sandbox without starting a model turn.

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

`accounts --probe` checks login status and any available quota without starting a model turn. Codex exposes quota through App Server. Claude's login-status command does not expose subscription quota; Goddard learns from rate-limit events during supervised runs. Unknown quota stays unknown and does not prevent trying a profile. Probes that cannot determine authentication report that uncertainty rather than claiming a successful login. A successful login-status check does not guarantee a later OAuth refresh or model call will succeed. See the [Codex account endpoints](https://learn.chatgpt.com/docs/app-server) and [Claude authentication commands](https://code.claude.com/docs/en/cli-reference).

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

`accounts reset` only clears Goddard's cached quota cooldown. It does not reset provider quota, sign you in, or remove an OAuth refresh lock. `accounts remove` leaves the profile's files and login in place; an unregistered directory matching the discovery pattern can still appear as a discovered profile.

`login NAME` reuses an existing registration's directory; for a new name it creates `~/.goddard/profiles/<provider>/<name>`. Profile registrations and quota cooldowns live in `~/.goddard/accounts.sqlite`. Set `GODDARD_HOME` to change this global location; keep it outside the project. The workspace's own `.goddard/` remains the task and handoff store.

The provider CLI owns the login credentials, including those it writes inside Goddard-managed profile directories. New managed Codex profiles use file credential storage under their own `CODEX_HOME`. Existing configurations are not rewritten. Claude uses its normal credential storage for the selected `CLAUDE_CONFIG_DIR`, as described in [Claude's profile configuration](https://code.claude.com/docs/en/env-vars); Codex storage is documented in [Codex authentication](https://learn.chatgpt.com/docs/auth). Goddard does not copy credential files between profiles or into handoffs. Native session histories, user-level plugins, and settings stay with their profile; configure them separately if needed.

The `current` profile preserves inherited API-key and external-provider setups. Other profiles receive their own configuration directory, with common inherited API-key/OAuth overrides and Claude cloud-provider switches removed from the child environment so those overrides cannot silently replace the selected login. Profile-defined settings and organization policies still apply. The parent shell environment is unchanged.

**Does this forward the whole conversation or the agent's exact memory?** No. Goddard forwards the saved goal, user notes, structured checkpoint, outstanding operations, and bounded recent evidence. It preserves workspace changes independently. The local database retains recorded events, but the handoff is not a replay of every conversation message, and private model state is not transferred. Account failover uses the same recovery mechanism as switching coding agents.

## Interact with your agent

**Will questions and confirmations appear in Goddard?** Yes. Interaction is automatic when both input and output are terminals; you do not need `--interactive` for a normal terminal run:

```powershell
goddard run TASK_ID --agent codex --effort high
goddard run TASK_ID --agent claude --model sonnet --effort medium
```

Goddard prints agent messages, presents structured questions with numbered options or free-text answers, and shows permission requests with their command, tool input, or requested scope. Type `y` or `yes` to approve; Enter or any other response declines. Goddard does not save permanent approval rules. Additional Codex permission grants are limited to the displayed turn scope. Claude's existing permission mode and allow rules may permit actions without a new prompt.

For questions, enter an option number or your own text. Claude questions supporting multiple choices accept comma-separated option numbers. Enter or `/cancel` skips a question. Plain-text questions can be answered at the follow-up prompt after the turn. Question answers and follow-ups become saved user updates. `/done` ends the run at that prompt; other text is sent as a new turn in the same provider session. Provider slash commands, rich widgets, and secret-input prompts are not implemented. Unsupported requests are declined or left unanswered.

Wait for the input prompt before typing. For example, after the agent asks whether to create a PR, you should see:

```text
You (Enter or /done to save and exit): Yes, create a PR.
```

An approval prompt only answers that permission request. Text entered while there is no active prompt is not sent or queued; Goddard prints a notice so you can send it again at the next prompt. It cannot silently become an answer to a later approval request.

**Multiline replies:** In an interactive terminal, Enter submits the completed draft. Press **Ctrl+J**, or type **`\` then Enter**, to insert a newline. **Shift+Enter** and **Alt+Enter** also insert a newline when your terminal reports them distinctly. If Shift+Enter submits in Windows Terminal, use Ctrl+J; Goddard does not modify terminal keybindings.

Paste multiline text normally, review it, then press Enter to send it as one reply. Goddard recognizes bracketed paste and detects rapid unmarked paste bursts, preserving blank lines and indentation while normalizing Windows CRLF. Pause briefly before Enter after an unmarked paste, because Enter during the burst remains a newline. Cancellation and EOF discard unsubmitted terminal input. These controls also work with `--plain` and `--no-color`; pipes and `TERM=dumb` retain line-oriented input. See [interactive input](wiki/Interactive-chat.md#newlines-and-pasted-text) for the full shortcut table and native CLI references.

**Claude finished, but no `You` prompt appeared?** Update to the latest Goddard release and use a current Claude Code CLI. Version 0.5.2 fixed a case where several checkpoint requests answered in one turn prevented the follow-up prompt. If an older run is stuck, press Ctrl+C once and wait for the handoff to finish. Save your unsent response with [note then run](#resume-a-stopped-task), repeating your chosen run options. On Goddard 0.6.0 or later, `goddard update` installs the latest release; earlier versions need the npm install command under [Get started](#get-started).

When input or output is redirected, Goddard disables interactive prompts. `--non-interactive` explicitly selects that behavior. `--interactive` requires both stdin and stdout to be terminals and cannot be combined with `--non-interactive`. Requests requiring user input are declined or left unanswered, never automatically approved by Goddard. Provider permission rules still apply. Periodic checkpoint prompts pause while waiting for user input; file capture and available quota monitoring continue.

### Image attachments

Both providers use the same image options:

```powershell
goddard start "Fix this layout" --agent codex --image "screenshots/login.png"
goddard run TASK_ID --agent claude -i before.png -i after.png
```

`--image PATH` / `-i PATH` is repeatable on `start` and `run`, including noninteractive runs. Relative image paths resolve from the workspace root. At the `You` prompt, enter `/image "path with spaces.png"`, then type your message at the next prompt and press Enter. On native Windows, **Alt+V** or **`/paste`** attaches a clipboard image; Alt+V preserves the current draft and cursor. Ctrl+V works only when the terminal forwards that key. Other platforms and WSL can attach saved files with `/image`.

Use `/images` to list pending attachments and `/remove-image N` to remove one. Empty Enter sends pending images without text; with no pending images it saves and exits. `/done`, cancellation, and EOF discard unsent attachments. Attach images at the ordinary `You` prompt, not an approval or structured-choice prompt. The terminal shows attachment names and counts.

Supported formats are PNG, JPEG, GIF, and WebP: at most 5 MiB each, 10 distinct images and 20 MiB total per task. Goddard validates signatures and sizes; decoding and model-specific limits remain with the provider. Images are snapshotted under `.goddard/` and sent using each agent's native image protocol. Submitted attachments survive source-file deletion, account failover, and provider switches; every fresh session receives the saved images. Portable bundles include image bytes, and `unpack` places them in an `images/` directory. The 32 MiB bundle content limit includes images and workspace files together.

Image pixels are not redacted. Clipboard access happens only on your paste action. See the [image controls and native protocol references](wiki/Interactive-chat.md#attaching-images).

### Terminal appearance

A rotating `| / - \` indicator shows when Goddard is checking an account, connecting, or saving a handoff, and when Codex or Claude is working. It clears before printed messages, pauses while you answer a prompt, and stops when the run ends. Animation is disabled for redirected output, `TERM=dumb`, and `--plain`; `--no-color` keeps the indicator without colors. It indicates activity, not a percentage or time estimate.

In a regular terminal, agent replies render as Markdown: styled headings, bold/italic text, lists and checklists, quotes, links, and tables. Fenced code blocks use their language label for syntax highlighting, including JavaScript, TypeScript, Python, JSON, and shell languages supported by highlight.js. Unknown or unlabelled languages stay readable without guessed highlighting. Fenced `diff` or `patch` blocks use green additions, red removals, and distinct headers; the `+` and `-` signs remain visible.

Codex, Claude, Goddard status messages, and your input have distinct labels. Approval details retain their literal command/input content with JSON highlighting. Incoming status and reply output waits while you are typing an answer, then appears after the prompt is answered or canceled. Prose and tables adapt to terminal width; code retains its indentation and uses the terminal's normal line wrapping.

```powershell
# Styling is automatic in a terminal.
goddard run TASK_ID --agent codex

# Keep formatted Markdown, but disable colors and text styles.
goddard run TASK_ID --agent claude --no-color

# Show the original Markdown as plain text.
goddard run TASK_ID --agent codex --plain

# From a Goddard source checkout after npm ci, preview without model quota.
npm run preview
```

`NO_COLOR` (when nonempty) and `NODE_DISABLE_COLORS=1` disable color and text styles. Redirected output and `TERM=dumb` use plain text automatically. Font family and size come from your terminal settings. Goddard renders completed messages/blocks; this is not character-by-character streaming or a copy of either provider's original interface. `npm run preview` is a source-checkout script, not a command to run in the project you are asking the agent to edit.

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
    images/                     Provider-readable copies of saved image attachments
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

Replace `TASK_ID`, `NAME`, and `PATH` with your own values. Account examples use Claude; change `--agent claude` to `--agent codex` for Codex profiles. If omitted, `--agent` defaults to Codex.

| Command | Purpose |
| --- | --- |
| `goddard --version` | Show the installed version (`-v` also works) |
| `goddard --help` | Show commands and options (`-h` and `help` also work) |
| `goddard init` | Initialize the current workspace |
| `goddard new "goal"` | Create a task |
| `goddard new --goal-file goal.txt` | Read a longer task description |
| `goddard start "goal" --agent codex` | Create and run a new task in one command |
| `goddard start --goal-file goal.txt --agent claude` | Create and run a task from a file |
| `goddard list` | List tasks and last run status |
| `goddard status TASK_ID` | Inspect a task and its latest checkpoint; omit the ID for the latest task |
| `goddard run TASK_ID --agent codex` | Start Codex with the recovery brief |
| `goddard run TASK_ID --agent claude` | Start Claude Code with the recovery brief |
| `goddard login NAME --agent claude` | Sign in to a named profile through the provider CLI |
| `goddard accounts --agent claude` | Discover profiles and cached cooldowns; `accounts list` also works |
| `goddard accounts --agent claude --probe` | Check login and available quota without a model turn |
| `goddard accounts add NAME --agent claude --path PATH` | Register an existing profile directory |
| `goddard accounts remove NAME --agent claude` | Forget a registration without deleting its files |
| `goddard accounts reset NAME --agent claude` | Clear Goddard's cached quota cooldown; does not reset provider quota |
| `goddard note TASK_ID "instruction"` | Add a user instruction before the next run |
| `goddard checkpoint TASK_ID --file progress.json` | Import a validated checkpoint while stopped |
| `goddard handoff TASK_ID` | Capture the stopped workspace and generate its brief |
| `goddard export TASK_ID --out .goddard/bundle.json` | Export a stopped task to a new JSON bundle filename |
| `goddard unpack .goddard/bundle.json --out ../recovery-review` | Extract captured files and patches into a new directory |
| `goddard import path/to/bundle.json` | Import task state into an initialized, matching workspace; never overwrite files |
| `goddard recover` | Mark abandoned runs interrupted after their processes exit |
| `goddard doctor` | Show Node version, workspace, and provider CLI availability |
| `goddard doctor --probe` | Check executables, Codex protocol, quota, and a read-only sandbox command without a model turn |
| `goddard update --check` | Check for a newer stable release without installing it |
| `goddard update` | Update the running global npm installation; available since 0.6.0 |

Use `--json` for structured command output; `start` and `run` remain live text streams. `--check` is only valid with `update`. Run exit codes: `0` for a finished turn or prepared handoff, `1` for failure, `75` for a quota stop, and `130` for interruption. A successful exit does not prove the task is complete or verified; check the agent's separate checkpoint status and verification evidence.

See the [option reference](wiki/Command-reference.md#start-and-run-options) for all run flags and the [timing and usage table](wiki/Command-reference.md#checkpoint-capture-and-usage-options) for defaults and accepted ranges. The same reference is [published in the wiki](https://github.com/kggayo/goddard/wiki/Command-reference).

## Usage monitoring and permissions

Codex uses the local App Server protocol: account quota reads and notifications, thread/turn events, steering, and interruption. Goddard checks quota before starting a turn and polls during a run. It requests an early checkpoint at **75% consumed** and winds down at **85%**. All reported quota buckets are considered. Missing, expired, or stale measurements remain unknown.

Claude Code uses its `stream-json` protocol. Rate-limit events can include utilization, warning, or rejection signals. Exact percentages are not always supplied; Goddard does not manufacture them from token counts. Checkpoint prompts are queued through streaming input and may not be processed until a safe boundary. A hard quota rejection preserves the handoff without asking for another model response.

These thresholds are policies, not guarantees: account usage may change outside the supervised session, and one request may use more capacity than expected.

```powershell
goddard run TASK_ID --agent codex --warn 70 --stop 80 --checkpoint-seconds 90
goddard run TASK_ID --agent claude --max-seconds 1800
```

Use `--permission-mode MODE` with either agent. Goddard translates this shared option in the selected adapter:

| Mode | Intent | Codex | Claude |
| --- | --- | --- | --- |
| `default` (default) | Normal edits with permission checks | `workspace-write`; user review with `on-request` when interactive, `never` otherwise | `acceptEdits` |
| `auto` | Provider automatically reviews eligible requests | `workspace-write`, `on-request`, `approvalsReviewer: auto_review` | `auto` |
| `read-only` | Inspect and plan; decline escalations | `read-only`, `never` | `plan` |
| `bypass` | Explicitly bypass provider approvals | `danger-full-access`, `never` | `bypassPermissions` |

Automatic review requires support from the installed provider and account. Each provider enforces its own restrictions; these modes do not promise identical isolation. Codex retains its sandbox while a reviewer evaluates eligible escalation requests. Claude uses its permission classifier. Goddard never automatically approves requests that reach its interaction handler; these are presented in interactive mode and denied without input. `--non-interactive` controls Goddard's prompts independently of permission mode.

```powershell
goddard run TASK_ID --agent claude --permission-mode auto
goddard run TASK_ID --agent codex --permission-mode auto
```

`--allow-tool` is Claude-only and repeatable, for example `--allow-tool "Read" --allow-tool "Grep"`. Goddard forwards each rule unchanged to Claude; the provider enforces its rule syntax and policy. Allowing a shell command grants access to what it runs, including project-defined scripts. It does not configure Codex permissions.

`--permission-mode read-only` selects Codex read-only mode or Claude planning mode; an agent in that mode may be unable to write its checkpoint. Read-only runs decline permission escalations. Normal CLI account/API billing and policy still apply.

### Permission bypass

Explicitly opt into bypass for either managed provider:

```sh
goddard run TASK_ID --agent claude --model sonnet --effort high --permission-mode bypass
goddard run TASK_ID --agent codex --effort high --permission-mode bypass
```

For Claude, the shared mode selects `bypassPermissions`, skipping normal permission prompts. For Codex, Goddard requests `approvalPolicy: never` and `sandbox: danger-full-access`, removing the Codex filesystem and network sandbox as well as approval prompts. Commands can act with your OS user's access. Use this only for work where you intend to grant that access; provider and organization restrictions still apply.

Goddard displays bypass at startup and records the selected settings in each run's evidence. Checkpointing, snapshots, quota handling, and handoffs continue. Automatic account failover preserves bypass for the current invocation. It is not saved as a global default or re-enabled from a previous handoff: pass the flag again on a new invocation if you want it.

User questions still need answers. Any unexpected provider approval request continues through the normal interactive handler and is declined without interactive input. Bypass does not enable interactive input, repair login failures, add quota, or make Goddard answer every request with yes.

Compatibility aliases remain available: `--read-only` means `--permission-mode read-only`, and `--dangerously-skip-permissions` means `--permission-mode bypass`. The deprecated `--claude-permission-mode` alias still requires `--agent claude` and maps `acceptEdits`, `auto`, and `bypassPermissions` to shared `default`, `auto`, and `bypass` respectively. Different modes cannot be combined, including explicit `default` with a bypass alias. Equivalent aliases can be combined. Invalid combinations fail before creating a task or starting a provider.

See [Claude permission modes](https://code.claude.com/docs/en/permissions), [Codex sandbox and approvals](https://learn.chatgpt.com/docs/sandboxing), and [Codex automatic review](https://learn.chatgpt.com/docs/sandboxing/auto-review) for the provider-level controls.

## Recovery and portability

Only one supervised run may own a workspace at a time. Goddard waits for its child process to exit before releasing that lock. After a supervisor crash:

```powershell
goddard recover
goddard status TASK_ID
goddard run TASK_ID --agent claude
```

Recovery refuses to proceed while a recorded supervisor or child PID is alive. Inspect and stop the original process if necessary. Goddard will not kill an old PID automatically, because operating systems can reuse PIDs. Detached background processes or external actions may survive a process failure; inspect the handoff's outstanding operations before repeating them.

For a different machine, export a bundle outside the project or inside `.goddard/`. `unpack` extracts file contents, a manifest, and staged/unstaged Git patches for review. A Git bundle here contains **changes relative to the recorded commit**, not the whole repository: obtain that repository and base commit separately, restore its changes and relevant new files, initialize Goddard there with `init`, and then `import` the original JSON bundle. Import validates captured file hashes and Git HEAD; it never overwrites destination files. Deletions, exclusions, modes, and warnings are listed in the manifest. It does not automatically replay commands or external actions.

Imported notes are retained as source evidence, not new authorization. Use `goddard note IMPORTED_TASK_ID "instruction"` to confirm an instruction in the destination workspace before running it. See the [portable handoff recipe](wiki/Resuming-work.md#inspect-or-export-a-stopped-task) for the full sequence.

Captures preserve both index and worktree patches, including staged and unstaged changes that cancel each other out. Untracked files are captured too. Defaults exclude secrets by filename, generated directories, symlinks, submodules, files larger than 2 MiB, and captures exceeding 32 MiB. These omissions are recorded. A snapshot is **not a complete backup**. Credentials and generated dependencies must be supplied separately on a new machine.

Common credentials are redacted from event records, and reasoning events are omitted. Redaction is best effort: checkpoint text, source files, patches, and tool outputs may contain private project information. Bundles are local, unencrypted artifacts; review them before sharing.

## Verify the installation

For an installed release, run from any directory:

```sh
goddard --version
goddard doctor
goddard accounts --agent claude --probe
```

Use `--agent codex` to check Codex profiles. `doctor` reports executable availability, while `accounts --probe` checks the selected provider's profiles. Neither proves that a model call will succeed. `goddard doctor --probe` checks the current Codex configuration's protocol, account quota, and a small read-only sandbox command without a model turn; it does not select a named Goddard account.

On Windows, the provider must have a native executable. `GODDARD_CODEX_BIN` and `GODDARD_CLAUDE_BIN` can select an existing absolute executable path when it is not on PATH; `.cmd`, `.bat`, and `.ps1` wrappers are not supported as provider overrides. This is separate from Goddard's own npm launcher, for which `goddard.cmd` is valid.

If `doctor --probe` reports a Codex Windows sandbox setup error, repair that sandbox through Codex's supported setup before running file-editing tasks. Goddard does not automatically disable the sandbox to work around setup failures.

### Developer checks from a source checkout

The release package does not include the development scripts or tests. To run them, clone Goddard and install its development dependencies, then run these in that checkout:

```powershell
git clone https://github.com/kggayo/goddard.git
cd goddard
npm ci
npm test
npm run check
npm run demo
```

The offline demo launches simulated provider processes through the real adapters. It deliberately crashes the Codex source after corrupting its last checkpoint write, then resumes through the Claude adapter and verifies the saved next step and workspace files. Tests also exercise account discovery, environment isolation, preflight selection, quota failover for both providers, preserved instructions/files/uncertain operations, interactive approvals after switching, cooldowns, pinned profiles, interruption, and workspace ownership during handoff. The existing rendering, recovery, and interaction checks remain in the suite. These checks use no model quota. Demo output is retained under `.tmp/demo-*` for inspection. Automated account-switch tests use simulated logins; they do not prove live access for a particular subscription or model.

Explicit live smoke tests also run from the Goddard checkout. They use the CLI's current authentication environment and quota, and work only in a new `.tmp/live-*` directory:

```powershell
node scripts/smoke.js codex
node scripts/smoke.js claude
```

## Troubleshooting

For an OAuth refresh conflict in a named Claude profile, retry after a minute. If it persists, close other Claude Code sessions using that profile and sign in to the affected profile again:

```sh
goddard login main --agent claude
goddard run TASK_ID --agent claude --account main --model sonnet --effort medium
```

Here `main` is an example registered profile. Use the affected registered name shown by `accounts`; for `current`, use `claude auth login` in the same `CLAUDE_CONFIG_DIR` environment. For a discovered directory, register it under a normal name with `accounts add` before using `login NAME`. Don't pass reserved names such as `current` to `goddard login`.

The saved task can be resumed with the same ID after login is repaired. Pinning `--account main` keeps the retry on that profile; omit `--account` to re-enable automatic selection later. Permission bypass, `--interactive`, and `accounts reset` do not fix token-refresh locks. See [Claude's refresh-error guidance](https://code.claude.com/docs/en/errors#could-not-refresh-your-login) and the [wiki troubleshooting page](https://github.com/kggayo/goddard/wiki/Troubleshooting) for missing prompts, grace-period expiry, SQLite warnings, and update problems.

## Current scope

This version supervises sessions it launches and automatically selects and switches configured account profiles on quota stops. It does not attach to arbitrary desktop chats, restore remote environments, transfer browser state, or provide a dashboard. Switching agents is explicit. Checkpoint requests are best effort; evidence capture continues independently. No additional agent framework or hosted service is required for the supervisor.

Implementation: `src/accounts.js` discovers profiles, handles login, and probes availability; `src/runner.js` selects accounts and coordinates failover; `src/store.js` handles durable SQLite state; `src/workspace.js` captures changes; `src/adapters/` isolates provider protocols; `src/interaction.js` handles prompts; `src/terminal.js` renders terminal output; `src/supervisor.js` coordinates checkpoint requests, quota policy, process shutdown, and handoffs.

Provider references: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Claude Code programmatic usage](https://code.claude.com/docs/en/headless), and [Anthropic's SDK protocol types](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/types.py). Installed protocol schemas take precedence where documentation examples differ.

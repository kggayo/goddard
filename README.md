<p align="center">
  <img src="docs/assets/goddard-mascot.png" width="260" alt="Goddard, Jimmy Neutron's robot dog">
</p>

<h1 align="center">Goddard</h1>

<p align="center"><strong>Your coding agent's best friend. Good dog. Great handoffs.</strong></p>

<p align="center">
  <a href="https://github.com/kggayo/goddard/actions/workflows/ci.yml"><img src="https://github.com/kggayo/goddard/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/kggayo/goddard/releases/latest"><img src="https://img.shields.io/github/v/release/kggayo/goddard" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0d9488" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/Node.js-24%2B-339933" alt="Requires Node.js 24 or newer">
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/contributions-welcome-f59e0b" alt="Contributions welcome"></a>
</p>

Your agent is halfway through a fix. The tests are almost green. Then:

> You've reached your usage limit. Come back later.

Now you can wait, or open another agent and explain the whole project again. Where were we? What changed? Which tests ran? Was that command finished?

**Goddard carries the work in progress to the next session.** It runs Codex or Claude Code, asks for progress checkpoints, saves workspace evidence, and hands the next account or agent a recovery brief. Less retelling. More finishing.

**Early release · v0.7.0.** The core is working; real-world reports and small improvements are very welcome.

[Read the wiki](https://github.com/kggayo/goddard/wiki) · [Command reference](https://github.com/kggayo/goddard/wiki/Command-reference) · [Resume unfinished work](https://github.com/kggayo/goddard/wiki/Resuming-work)

## Take it for a walk

You'll need **Node.js 24+**, **Git** for Git workspaces, and either [Codex CLI](https://learn.chatgpt.com/docs/cli) or [Claude Code](https://code.claude.com/docs/en/quickstart) installed. If you're already signed in, Goddard can reuse that login. Projects without Git use bounded file snapshots.

```sh
npm install --global https://github.com/kggayo/goddard/releases/latest/download/goddard.tgz
goddard --version
goddard doctor
```

That's it—no checkout or npm account needed. The same package works on Windows, macOS, and Linux. It includes Goddard's runtime dependencies; Node.js and the coding CLIs are installed separately. [Install, update, uninstall, and troubleshooting →](docs/installing.md)

Already installed? Stop active Goddard runs and use `goddard update` for the latest release, or `goddard update --check` to check first. Versions before 0.6.0 need the npm install command above once to get the updater.

Not signed in yet? Run `goddard login main --agent codex` (or `--agent claude`) and complete the provider's normal login flow.

Now go to the project you want to work on:

```sh
cd path/to/your-project
goddard init
goddard start "Fix the login bug and run the relevant tests" --agent codex --effort high
# Or:
goddard start "Fix the login bug and run the relevant tests" --agent claude --model sonnet --effort medium
```

`start` creates and runs a new task in one step—no copying a task ID. It prints the ID for later recovery. Use `run` to continue an existing task; `goddard list` shows saved IDs. Use `new "goal"` when you only want to save a task for later. The default agent is Codex if you omit `--agent`.

Chat, answer questions, and approve requests in Goddard's terminal. Interaction is automatic when both input and output are terminals; `--interactive` is optional and `--non-interactive` disables prompts. After a turn, wait for the `You` prompt, then type a follow-up, or press Enter / type `/done` to save and exit. Goddard tells you if text entered outside an active prompt was not sent. **Ctrl+C** asks for a checkpoint and stops; a second press stops immediately. Existing provider permissions still apply.

Attach screenshots with `--image PATH` (repeatable on `start` and `run`) or `/image PATH` at the `You` prompt. On Windows, **Alt+V** or `/paste` attaches a clipboard image. These controls work with both Codex and Claude; submitted images survive handoffs. [Image controls and limits →](docs/usage.md#image-attachments)

Use `--permission-mode default|auto|read-only|bypass` with either provider's `start` or `run` command. Goddard translates the chosen mode into the agent's native settings. Explicit `bypass` selects Claude's bypass mode or disables Codex's approvals and sandbox; a new invocation requires the choice again. Existing `--read-only` and `--dangerously-skip-permissions` flags remain aliases. [Permission options and scope →](docs/usage.md#usage-monitoring-and-permissions)

No model account handy? Try the recovery demo from a source checkout:

```sh
git clone https://github.com/kggayo/goddard.git
cd goddard
npm ci
npm run demo
```

It simulates an interrupted Codex run and a Claude handoff. No login or model quota needed. `npm run preview` gives the terminal styling a spin.

<details>
<summary>Prefer to skip the global command?</summary>

From a source checkout, use `node /absolute/path/to/goddard/bin/goddard.js` instead of `goddard`, or run `npm link` to use your development copy globally. On Windows, use the native Codex/Claude executable; see the [full guide](docs/usage.md#get-started).

</details>

## Pick up where you left off

In the same project's root directory, find the stopped task and add any new instruction before resuming:

```sh
goddard list
goddard note TASK_ID "Yes, create a PR after the relevant tests pass."
goddard run TASK_ID --agent claude --model sonnet --effort high
```

Replace `TASK_ID` with the saved ID. `note` updates the handoff; `run` launches the next session. Skip `note` when you have no new instruction. Stop the active workspace run before adding a note; during a run, answer at the `You` prompt.

Repeat your chosen agent, model, effort, account, and permission flags on each new invocation. Automatic account switches preserve them within a run, but a later `run` does not restore those options from the previous invocation. [More resume and recovery recipes →](docs/usage.md#resume-a-stopped-task)

## More accounts, less waiting

Account selection and quota failover are **on by default**. Keep your current login and add another account once:

```sh
goddard login work --agent codex
goddard login personal --agent codex

# The same works with Claude:
goddard login work --agent claude
goddard accounts --agent claude --probe
```

Run the task normally. Goddard selects a profile that isn't known to be unavailable. If it reaches the quota threshold, Goddard saves the handoff, stops the old process, and tries the next profile of that agent. Explicit model, effort, and permission settings carry over.

Want to move between coding agents? That's one explicit command:

```sh
# After the old run has stopped:
goddard run TASK_ID --agent claude
```

Use `--account work` to pin a profile, or `--no-failover` to select automatically but stop at its limit. Existing profile folders are discovered too. [Account setup and selection details →](docs/usage.md#automatic-account-selection)

<details>
<summary>Unlimited power? Well…</summary>

<p align="center"><img src="docs/assets/unlimited-power.png" width="560" alt="Emperor Palpatine shouting Unlimited power! while casting lightning"></p>

The vibe: unlimited power. The feature: fewer interrupted coding sessions. 🐾

More available accounts can keep a task moving longer. Goddard doesn't create credits, reset quotas, or guarantee unlimited usage. Each account still needs valid access and available capacity, and provider terms still apply. If every profile is unavailable, Goddard stops with the handoff saved.

The meme is a third-party reference, not part of the MIT-licensed code. [Artwork credits](docs/assets/README.md).

</details>

## What the good dog actually carries

| Saved for the next session | Why it helps |
| --- | --- |
| Goal and your clarifications | The next agent knows what you asked for |
| Submitted image attachments | Screenshots and diagrams remain available after a switch |
| Plan, decisions, completed work, next steps | It can pick up the implementation |
| Test results and recent tool evidence | It can check what was actually verified |
| Operations with uncertain results | It knows what to inspect before retrying |
| Workspace changes and file snapshots | The work survives the stopped process |

Goddard forwards a **structured checkpoint and bounded recent evidence**, not an exact replay of every message or private model state. Checkpoints are best effort, file capture has exclusions, and the next agent should verify the current state before continuing. [Recovery details](docs/usage.md#recovery-and-portability).

## Who can ride along?

| Agent / integration target | Status |
| --- | --- |
| Codex CLI | Available: managed sessions, interaction, quota checks, account failover |
| Claude Code | Available: managed sessions, interaction, account failover; quota visibility depends on emitted events |
| DeepSeek | Roadmap: investigate an adapter |
| Muse | Roadmap: confirm the intended product and integration interface |
| Kimi | Roadmap: investigate an adapter |
| Grok | Roadmap: investigate an adapter |
| Gemini | Roadmap: investigate an adapter |

Future entries are ideas, not supported providers or release promises. The first job is confirming an interface that can preserve progress and handle permissions honestly. [See the roadmap](ROADMAP.md) or [propose an integration](https://github.com/kggayo/goddard/issues/new?template=feature_request.yml).

## Come build with us

First open-source contribution? You're welcome here. A confusing sentence, a reproducible bug, a Windows/Linux/macOS report, or a small fix all count. You don't need a grand new feature.

- **Something broke?** [Report a bug](https://github.com/kggayo/goddard/issues/new?template=bug_report.yml).
- **An idea or question?** [Start a discussion](https://github.com/kggayo/goddard/discussions).
- **Ready to change something?** Follow the [first-PR guide](CONTRIBUTING.md).
- **Found a security issue?** Please use [private reporting](SECURITY.md).

The usual path is **fork → branch → small change → pull request**. Anyone can propose a change. Maintainers review and merge it; you don't need to be added as a collaborator first.

## The handy drawer

- [Goddard wiki](https://github.com/kggayo/goddard/wiki): quick start, command cookbook, permission options, and resuming unfinished work.
- [Full usage guide](docs/usage.md): login, models, effort, interaction, profiles, recovery, and all commands.
- [Installation guide](docs/installing.md): packages, updates, and troubleshooting.
- [Roadmap](ROADMAP.md): current scope and future adapters.
- [Contributing](CONTRIBUTING.md): local development and your first pull request.
- [Maintainer guide](docs/maintaining.md): how repository access and reviews work.
- [Code of conduct](CODE_OF_CONDUCT.md): be kind to the humans behind the terminals.

## Why “Goddard”?

An affectionate nod to Jimmy Neutron's robot dog: a clever little companion who helps when an experiment gets complicated. The README features the supplied image of our namesake. Goddard is an independent community project, with no affiliation or endorsement from the show or the coding-agent providers.

Code and documentation are [MIT licensed](LICENSE). The Jimmy Neutron mascot image and movie meme are third-party artwork excluded from that license; see [third-party notices](THIRD_PARTY_NOTICES.md) and [artwork credits](docs/assets/README.md).

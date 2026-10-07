# Welcome to the dog park 🐾

Thanks for helping Goddard keep unfinished work moving. First-time contributors are welcome. Documentation, bug reproductions, platform testing, and thoughtful questions matter just as much as code.

## Pick something small

Check [issues](https://github.com/kggayo/goddard/issues), especially `good first issue` and `help wanted`. No issue assigned to you? Leave a short comment describing what you'd like to try. For a small typo or obvious fix, a pull request is enough. For a new adapter or a large change, start an issue or discussion so we can agree on the approach.

Some useful starting points:

- Try the README on a fresh machine and clarify any confusing step.
- Reproduce an account-selection or handoff problem with the offline fixtures.
- Improve a terminal prompt without losing the original recorded evidence.
- Investigate an integration on the [roadmap](ROADMAP.md), with links to its official interface.

## Your first pull request

1. Click **Fork** on GitHub. This creates your own copy; you don't need write access here.
2. Clone your fork and create a branch:

   ```sh
   git clone https://github.com/YOUR_USERNAME/goddard.git
   cd goddard
   git switch -c fix/clearer-handoff-message
   npm ci
   ```

3. Make one focused change. To run your local CLI, use `node bin/goddard.js --help` or `npm link`.
4. Check the relevant behavior. For code changes:

   ```sh
   npm run check
   npm test
   npm run demo
   ```

5. Review your diff, commit, and push:

   ```sh
   git add PATH_TO_CHANGED_FILE
   git diff --cached
   git commit -m "Explain the change clearly"
   git push -u origin fix/clearer-handoff-message
   ```

6. Open a pull request against `kggayo/goddard:main`. Describe the problem, what changed, and how you checked it. Draft pull requests are welcome when you'd like early feedback.

GitHub may wait for a maintainer to approve your first workflow run. That's normal. It is approval to run the checks, not a rejection of your contribution. Maintainers can request changes before merging; reply with questions whenever feedback is unclear.

For documentation-only changes, check the commands and links you touched. You don't need to buy subscriptions or consume model quota to contribute.

## Find your way around

| Location | Responsibility |
| --- | --- |
| `src/cli.js` | Commands, arguments, and terminal defaults |
| `src/accounts.js`, `src/runner.js` | Profiles, availability, and account failover |
| `src/supervisor.js` | Checkpoints, quota handling, shutdown, and handoffs |
| `src/adapters/` | Codex and Claude protocol boundaries |
| `src/store.js`, `src/workspace.js`, `src/handoff.js` | Durable records, file evidence, and recovery briefs |
| `src/interaction.js`, `src/terminal.js` | User input and readable output |
| `test/fixtures/` | Fake providers for tests that don't use live accounts |
| `docs/usage.md` | Complete user-facing behavior and limitations |

This is a Node.js 24+ project using ES modules, Node's test runner, and built-in SQLite. There is no build step. Prefer the existing small modules and style over adding a framework.

## What a good change preserves

- A stopped agent must leave useful, honest recovery evidence.
- The old process must exit before a replacement can write to its workspace.
- Unknown quota stays unknown. A coding error is not a reason to rotate accounts.
- Questions and approvals go to the user; missing input does not become approval.
- No credentials, private model reasoning, or accidental secret dumps in handoffs.
- Explicit user instructions, model choices, and permission settings survive a switch.

Test observable behavior, especially failure and recovery paths. Add tests when they protect an actual behavior change; don't add tests that only repeat the implementation. Use fake providers for routine CI. Live smoke tests are opt-in and use your own account's quota.

AI-assisted contributions are welcome. Please understand the changes you submit, review generated code, and report checks accurately. Don't claim a live account-switch test when you only ran a fixture.

## Keep private things private

Don't commit `.goddard/`, `.tmp/`, login directories, tokens, `.env` files, or raw personal transcripts. Before attaching a log or handoff to an issue, review it for private source code and account details. See [SECURITY.md](SECURITY.md) for vulnerabilities and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.

By contributing code or documentation, you agree that your contribution is available under the project's [MIT license](LICENSE). Only submit material you have the right to contribute. Third-party artwork needs its own documented rights; see [asset credits](docs/assets/README.md). No contributor agreement or sign-off ceremony is required.

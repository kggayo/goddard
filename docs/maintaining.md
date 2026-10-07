# Keeping the dog park open

Open source means people can use, study, change, and share the licensed code. On GitHub, a public repository also lets people open issues, fork the code, and propose pull requests. You don't need to give strangers write access to welcome contributions.

## Who can do what?

| Person | Normal access |
| --- | --- |
| Visitor | Read and clone the public repository |
| GitHub user | Fork it, discuss ideas, open issues, and send pull requests |
| Contributor | Propose changes from their fork; no invitation needed |
| Maintainer | Triage issues, review changes, and merge accepted pull requests |
| Repository owner (`kggayo`) | Manage repository access and settings |

Start with yourself as the only maintainer. Add a collaborator when you trust them and have a concrete role for them; public participation doesn't require collaborator access.

## First publication

The files in this checkout do not themselves change GitHub settings. After reviewing and committing the public files on `main`, authenticate GitHub CLI as `kggayo` with repository and workflow access, then run:

```sh
gh auth login --hostname github.com --web --git-protocol https --scopes repo,workflow
gh api user --jq .login
npm run github:publish
```

The helper refuses the wrong account, a dirty checkout, another repository's remote, or a private destination. It creates `kggayo/goddard` if missing, pushes `main` without force, and applies [the checked-in settings](../.github/repository-settings.json). It uses GitHub CLI's active account without changing global Git credential settings. If a later step fails, read the output and inspect the existing repository; an earlier creation or push may already have succeeded. Re-running from the same clean commit can finish setup.

No npm registry release is made. `private: true` in `package.json` is an npm-publishing guard; it doesn't make the GitHub repository private or change the MIT license. Installation currently uses the GitHub checkout.

## Repository defaults

- **Public**, with Issues and Discussions enabled. Wiki and Projects are disabled to keep documentation and the roadmap in the repository.
- **Squash merges**, deleting merged branches automatically.
- **Protected `main`**: pull requests, the three platform checks, up-to-date branches, and resolved conversations. Force pushes and branch deletion are disabled; protection also applies to the owner.
- **Zero mandatory approval count while there is one maintainer.** Only users with write access can merge, so outside contributors cannot merge their own work. Requiring an additional approving reviewer would strand the sole maintainer's own PRs. Add a one-review requirement when a second maintainer joins.
- **Read-only default Actions token** and approval before workflows from first-time contributors run. Fork tests use fixtures, with no provider credentials or model quota.
- **Private vulnerability reports**, dependency alerts, and monthly Dependabot updates.
- Friendly labels: `good first issue`, `help wanted`, `documentation`, and `provider-adapter`, alongside bugs and enhancements.

These are the settings applied by the publication helper, not a claim that a particular remote has already been configured. Verify them in GitHub after setup. GitHub documents [fork workflow approval](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository), [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), and [private vulnerability reports](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).

## Reviewing a contribution

1. Thank the contributor for the concrete help. Clarify the intended behavior if needed.
2. Check the diff before approving a first-time contributor's workflow run. Pay attention to workflow changes and scripts the checks execute.
3. Read the problem statement and verification. For agent work, distinguish fixture tests from live provider tests.
4. Look for accidental private data, permission changes, incomplete process shutdown, and handoff regressions.
5. Request specific changes or squash-merge once the checks pass. Explain declined proposals briefly and kindly.

Use the `good first issue` label for a small, bounded task with reproduction steps or a clear expected result. A whole new provider adapter is better labeled `help wanted` and `provider-adapter`.

## Releasing later

Make normal changes through branches and pull requests. Confirm CI on Windows, Linux, and macOS, update the version and relevant docs, and write release notes that separate working features from planned integrations. Don't advertise unlimited quota or lossless memory transfer. Never commit account logins, private recovery bundles, or `.tmp/` review material.

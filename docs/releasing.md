# Let a release out for a walk

Releases are public GitHub assets, installable with npm on Windows, macOS, and Linux. No npm registry account, publishing token, or manually installed build tools are required. `private: true` guards against accidental registry publication and does not block tarball installation.

## Prepare and publish

The commands below use **0.6.1 as an example next version**, not a published release. Replace it everywhere with the version you intend to release.

1. Make a release branch from `main`. For a new version, run `npm version 0.6.1 --no-git-tag-version`. This updates `package.json` and `package-lock.json`; the CLI reads its version from the package.
2. Add `docs/releases/v0.6.1.md` with installation instructions, working features, changes, and limitations. Follow the [documentation consistency checklist](wiki-maintenance.md#keep-the-guides-consistent): update current version markers, command examples, install guidance, wiki source, roadmap, and supported-version policy where affected. Keep historical release notes tied to their original tags.
3. Run `npm ci`, `npm run check`, `npm test`, `npm run demo`, `npm run package`, and `npm run package:test`. Open a PR and merge after all three platform checks pass.
4. From the clean, merged `main`, create and push the matching tag:

   ```sh
   git switch main
   git pull --ff-only
   git tag -a v0.6.1 -m "Goddard v0.6.1"
   git push origin v0.6.1
   ```

5. Watch the [Release workflow](https://github.com/kggayo/goddard/actions/workflows/release.yml). A successful run publishes `goddard.tgz` and `SHA256SUMS` on the [release page](https://github.com/kggayo/goddard/releases). Verify the public download and install command before announcing it.
6. [Publish the reviewed wiki source](wiki-maintenance.md#publish-reviewed-pages) after the release succeeds, then verify the live pages match the released behavior. The wiki is a separate Git repository and does not update when `main` changes.

Only ordinary stable `vMAJOR.MINOR.PATCH` tags are supported by this workflow.

## What runs in CI/CD

- Every PR and `main` push builds a tarball from the lockfile. The package contains the CLI, runtime source, documentation, artwork credits, and bundled production dependencies with their licenses. Local state, accounts, tests, release scripts, and `.github/` are excluded.
- The same archive is installed on Windows, macOS, and Linux, using an empty npm cache and `--offline` to prove it includes its runtime dependencies. The installed npm command shim is exercised from a separate temporary workspace. The test does not change your global Goddard installation.
- Release tags must match both package versions, have checked-in notes, point at the checked-out commit, and belong to `main` history. Dispatching the release workflow on a branch fails validation.
- A tagged release reruns the reusable CI workflow. Only after it passes does a separate job get `contents: write` to publish the tested archive. There are no model-provider secrets in CI.
- Publication verifies the checksum, uploads assets to a draft, then makes the release public. An already public release is never overwritten by the helper. The latest-download URL keeps the same filename between versions.

The public package uses [npm's tarball installation](https://docs.npmjs.com/cli/v11/commands/npm-install/) and [bundled dependencies](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#bundledependencies). GitHub documents the [draft-first release process](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).

## Failed run or a bad release

For a transient failure, rerun failed jobs in GitHub Actions. You can also restart the full workflow for the existing tag:

```sh
gh workflow run release.yml --ref v0.6.1 --repo kggayo/goddard
```

Replace the example ref with the existing release tag whose workflow failed.

An incomplete draft can be retried; the helper replaces only the two expected assets while it is still a draft. If validation or tests found a real code issue, fix it in a PR and use a new version and tag. Do not move published tags or replace published packages. For an affected user, the previous version's explicit download URL can reinstall that package after stopping active runs.

Native installers and npm registry publication can be added later. This pipeline distributes the existing Node CLI and intentionally keeps the Node.js prerequisite visible.

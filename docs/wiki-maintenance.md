# Publishing the GitHub wiki

The source of truth is `docs/wiki/` in the main repository. Contributors send normal pull requests; maintainers publish the reviewed Markdown files to [the wiki](https://github.com/kggayo/goddard/wiki). Keep direct wiki editing restricted to repository collaborators. Public readers can propose edits through a fork without receiving write access.

The wiki is a separate Git repository. Enable it in repository settings and create its first Home page through GitHub before cloning it. See GitHub's guides to [editing wiki pages locally](https://docs.github.com/en/communities/documenting-your-project-with-wikis/adding-or-editing-wiki-pages) and [wiki access](https://docs.github.com/en/communities/documenting-your-project-with-wikis/changing-access-permissions-for-wikis).

## Keep the guides consistent

The CLI implementation defines behavior. The README introduces the everyday workflow, `docs/usage.md` explains behavior in detail, and the wiki splits it into focused recipes. They can differ in depth; commands, defaults, limitations, and permissions must agree.

When a behavior changes, review the matching documents in the same PR:

| Topic | Documents to compare |
| --- | --- |
| Install, requirements, update | README, `docs/installing.md`, usage Get started / Verify the installation, wiki Getting started / Troubleshooting / Command reference |
| Start, resume, note, recovery | README, usage Get started / Resume a stopped task / Recovery and portability, wiki Home / Resuming work / Command reference |
| Model, effort, profiles, quota | README, usage Login / Automatic account selection / Usage monitoring, wiki Accounts and models / Command reference |
| Interaction and permissions | README, usage Interact with your agent / Permission bypass, wiki Interactive chat / Permissions and bypass / Troubleshooting |
| Release version and support | `package.json`, `package-lock.json`, README, usage introduction, pinned install example, wiki Home / Command reference / _Footer, SECURITY, ROADMAP |

- Check `start` versus `run`, required workspace initialization, placeholders, and which options must be repeated on resume.
- State that interaction is automatic with terminal input/output. Keep optional `--interactive` examples clearly labeled.
- Distinguish global-package commands from source-checkout scripts, and named-profile login from native current-profile login.
- Keep quota, bypass, capture, and imported-evidence limitations accurate in every place that explains them.
- Verify relative and repository/wiki links, including heading anchors. Compare the published wiki with `docs/wiki/` after publishing; merging the main repository does not update the separate wiki automatically.
- Historical release notes under `docs/releases/` describe their tagged versions. Preserve those versioned examples; fix current guidance in current guides. Clearly label any unreleased behavior until it ships.

## Review a documentation change

- Check examples against `src/cli.js`, the provider adapters, and `docs/usage.md`.
- Use generic task IDs and paths; never copy private user logs or credentials into examples.
- Explain permission scope and recovery limits where those commands appear.
- Link wiki pages with full `https://github.com/kggayo/goddard/wiki/PAGE-NAME` URLs so links work from both the wiki and repository source.
- Update `Home.md` and `_Sidebar.md` when adding a page. Update the version in `Home.md` and `_Footer.md` when checking a newer release's behavior.
- Preview changed pages and verify links. Documentation-only changes do not need live provider calls or additional tests; required repository CI still runs on the PR.

## Publish reviewed pages

Run from a clean, up-to-date checkout of `main` after the documentation PR merges. For a new CLI release, wait for the release to publish before presenting its behavior as current on the wiki. Authenticate Git as a repository maintainer. If needed, `gh auth setup-git` configures Git to use your GitHub CLI login.

The first time, clone the wiki into the ignored temporary directory:

```sh
git clone https://github.com/kggayo/goddard.wiki.git .tmp/github-wiki
```

The wiki checkout has its own local Git configuration. Before committing, set its `user.name` and `user.email` to your intended public contributor identity, as in the main repository; use your GitHub no-reply address if you prefer.

For an existing wiki checkout, first inspect its status and pull without overwriting local work:

```sh
git -C .tmp/github-wiki status --short
git -C .tmp/github-wiki pull --ff-only
```

Review any independent wiki changes and bring them back into `docs/wiki/` through a PR before replacing those pages. Copy the reviewed files into the wiki checkout.

PowerShell:

```powershell
Copy-Item -Path docs/wiki/*.md -Destination .tmp/github-wiki
```

macOS/Linux:

```sh
cp docs/wiki/*.md .tmp/github-wiki/
```

These copies include `_Sidebar.md` and `_Footer.md`. They do not remove retired pages: if a reviewed change removes or renames a page, explicitly remove the old wiki file with `git rm` after checking its links. Preserve unrelated wiki files.

Inspect the diff and file list before committing. New pages appear in status and in the staged diff:

```sh
git -C .tmp/github-wiki status --short
git -C .tmp/github-wiki diff
git -C .tmp/github-wiki add -- '*.md'
git -C .tmp/github-wiki diff --cached
git -C .tmp/github-wiki commit -m "docs: publish reviewed Goddard wiki pages"
git -C .tmp/github-wiki push origin HEAD
```

If there is no diff, there is nothing to publish. Never force-push the wiki. If a normal push is rejected, fetch and reconcile changes before trying again.

Finally, open the live Home page, check the sidebar, and follow the changed links. GitHub's rendered pages may take a moment to refresh. Publishing wiki documentation does not require a new CLI release.

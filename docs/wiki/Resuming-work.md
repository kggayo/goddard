# Resuming work

Use the same project directory and task ID to continue unfinished work. `start` creates a new task every time; `run` resumes a saved one in a fresh provider session.

## Find your task

```sh
cd path/to/your-project
goddard list
goddard status TASK_ID
```

Replace `TASK_ID` in these examples with an ID from `list`. `status` shows the latest checkpoint, run information, and path to `HANDOFF.md`. Keep `.goddard/` in place: that is where Goddard stores the task's history and captured files.

## Add an answer and continue

If the agent asked whether to create a PR and the run has stopped:

```sh
goddard note TASK_ID "Yes, create a PR after the relevant tests pass."
goddard run TASK_ID --agent claude --model sonnet --effort high
```

`note` saves your instruction and updates the handoff. It does not launch an agent. `run` starts the next session with the saved goal, notes, checkpoint, and available recovery evidence.

Stop any active Goddard run in that workspace before adding a note. During an interactive run, answer at its `You` prompt instead.

You can add other clarifications the same way:

```sh
goddard note TASK_ID "Keep the public API unchanged. Run the authentication tests before finishing."
goddard run TASK_ID --agent codex --effort high
```

Model, effort, account, and permission options are per invocation. Include them again if you want the same settings. In particular, bypass is never restored automatically from a previous handoff:

```sh
goddard run TASK_ID --agent claude --model sonnet --effort high --dangerously-skip-permissions
```

That last example grants broad tool access; read [Permissions and bypass](https://github.com/kggayo/goddard/wiki/Permissions-and-bypass) before using it.

## Continue without a new instruction

You do not need a note for every resume:

```sh
goddard run TASK_ID --agent claude --model sonnet --effort medium
```

This also works after an initial login or launch failure. Find the saved task with `list` instead of creating another with `start`.

## Switch agents or choose an account

To hand a Claude task to Codex in the same workspace:

```sh
goddard run TASK_ID --agent codex --effort high
```

To choose a particular signed-in Claude profile:

```sh
goddard run TASK_ID --agent claude --account main --model sonnet --effort medium
```

An explicit `--account` pins that profile and disables automatic failover. Omit it for automatic selection. Automatic quota failover stays within the selected provider; switching providers is an explicit `run --agent …` choice. [Account details](https://github.com/kggayo/goddard/wiki/Accounts-and-models).

## After a crash or forced terminal close

First confirm the old Goddard supervisor and its agent process have exited. Then:

```sh
goddard recover
goddard status TASK_ID
goddard run TASK_ID --agent claude
```

`recover` marks abandoned runs interrupted and refreshes their recovery evidence. It refuses to proceed while recorded processes are alive and does not kill them for you. It does not restore files or start an agent. A normal stopped run usually needs only `run`.

If a final checkpoint did not finish before the grace period ended, the last accepted checkpoint and recorded evidence remain available. Read the handoff's uncertain operations before repeating an action that may already have happened, such as pushing a commit or creating a PR.

## Inspect or export a stopped task

```sh
goddard handoff TASK_ID
goddard export TASK_ID --out .goddard/handoff-bundle.json
```

`handoff` captures the stopped workspace and prints the recovery brief's path. `export` captures a portable JSON bundle; choose a new filename for each export. Keep exports inside `.goddard/` or outside the project to avoid including them in later workspace captures.

To inspect a bundle without applying changes:

```sh
goddard unpack .goddard/handoff-bundle.json --out ../goddard-recovery-review
```

The output directory must not exist. It contains captured files, a manifest, and staged/unstaged Git patches for review. Unpacking does not apply patches or delete workspace files.

For a different machine:

1. Copy the bundle securely and unpack it for review.
2. Obtain the project and the recorded Git base commit separately. A Git workspace export contains changes relative to that commit, not the entire repository.
3. Restore the relevant captured files, patches, and deletions in the destination workspace, checking the manifest for omissions.
4. Run `goddard init` in that workspace, then import the original bundle:

   ```sh
   goddard import path/to/handoff-bundle.json
   goddard list
   goddard run IMPORTED_TASK_ID --agent codex
   ```

Use the imported task ID. Import checks captured file hashes and Git HEAD and never overwrites destination files. Supply provider logins and dependencies separately.

Imported notes are source evidence, not new authorization. To confirm an instruction in the destination workspace, use `goddard note IMPORTED_TASK_ID "instruction"` before running the imported task.

## What recovery does and does not preserve

Goddard saves the goal, user notes, accepted checkpoints, recorded messages/tool evidence, and workspace captures. Handoffs include bounded recent evidence, and exports include up to 1,000 recent events; the local database retains recorded events. A fresh session does not receive private model state or an exact replay of every message.

Default captures omit secret-like filenames, generated directories, symlinks, submodules, files over 2 MiB, and captures beyond 32 MiB. Omissions appear in capture warnings. Snapshots are not a complete backup.

Bundles are local, unencrypted files and can contain private code or tool output despite best-effort redaction. Review them before sharing. See the [full recovery guide](https://github.com/kggayo/goddard/blob/main/docs/usage.md#recovery-and-portability).

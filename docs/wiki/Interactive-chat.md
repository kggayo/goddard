# Interactive chat

Yes, you can talk to the coding agent through Goddard. In a normal terminal, `start` and `run` enable interaction automatically. You don't need to add `--interactive` every time.

```sh
goddard run TASK_ID --agent claude --model sonnet --effort medium
```

Goddard runs a managed session, displays agent messages, and forwards your replies. It does not attach to an existing desktop chat or open the provider's native terminal interface.

## Which prompt am I answering?

| Prompt | What to type |
| --- | --- |
| `You (Enter or /done to save and exit):` | A follow-up instruction or answer to the agent's ordinary text question. Enter or `/done` saves and exits. |
| `Allow this request? [y/N]` | `y` or `yes` approves the displayed request. Enter or any other answer declines it. |
| A structured question with choices or a text field | Follow its displayed instructions. Multiple-choice Claude questions accept comma-separated numbers. Enter or `/cancel` skips the question. |

An approval reply applies only to that request. Goddard does not save a permanent allow rule when you type `y`.

If the agent says “Should I create a PR?” in an ordinary message, wait for the `You` prompt and answer there:

```text
You (Enter or /done to save and exit): Yes, create a PR after the tests pass.
```

Text typed outside an active prompt is not sent or queued. Goddard prints a notice so you can send it again when a prompt appears. This prevents an earlier message from becoming an answer to a later approval request.

If the run already stopped, use [note then run](https://github.com/kggayo/goddard/wiki/Resuming-work#add-an-answer-and-continue).

## Explicit interactive and noninteractive modes

```sh
goddard run TASK_ID --agent claude --interactive
goddard run TASK_ID --agent codex --non-interactive
```

`--interactive` requires both stdin and stdout to be terminals. Redirection and pipes disable prompts by default. `--non-interactive` explicitly disables them; it cannot be combined with `--interactive`.

When input is unavailable, requests requiring your answer are declined or left unanswered. Existing provider permission rules can still allow actions. Permission bypass does not make Goddard answer user questions automatically.

Periodic checkpoint requests pause while Goddard waits for your input; file snapshots and available usage monitoring continue.

## Stopping a run

- Press Ctrl+C once to ask the agent for a final checkpoint and prepare a handoff. The default grace period is 30 seconds.
- Press Ctrl+C again to stop immediately.
- At the `You` prompt, Enter or `/done` saves and exits normally.

If the grace period expires, the handoff uses the last accepted checkpoint and available evidence. Inspect it before resuming uncertain operations. [Recovery help](https://github.com/kggayo/goddard/wiki/Troubleshooting).

## Formatting

Goddard renders Markdown, code blocks, syntax colors, and readable approval details. Font family and size come from your terminal. Provider-specific widgets and native slash commands are not passed through.

```sh
goddard run TASK_ID --agent claude --no-color
goddard run TASK_ID --agent codex --plain
```

`--no-color` keeps Markdown rendering without colors or text styles. `--plain` shows the original Markdown as readable plain text. Formatting affects display, not saved handoff content. For an absent prompt, see [Troubleshooting](https://github.com/kggayo/goddard/wiki/Troubleshooting#i-cannot-answer-the-agent).

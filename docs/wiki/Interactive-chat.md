# Interactive chat

Yes, you can talk to the coding agent through Goddard. In a normal terminal, `start` and `run` enable interaction automatically. You don't need to add `--interactive` every time.

```sh
goddard run TASK_ID --agent claude --model sonnet --effort medium
```

Goddard runs a managed session, displays agent messages, and forwards your replies. It does not attach to an existing desktop chat or open the provider's native terminal interface.

## Which prompt am I answering?

| Prompt | What to type |
| --- | --- |
| `You (...)` | A follow-up instruction or answer to the agent's ordinary text question. Empty Enter exits when no images are pending; `/done` always saves and exits. |
| `Allow this request? [y/N]` | `y` or `yes` approves the displayed request. Enter or any other answer declines it. |
| A structured question with choices or a text field | Follow its displayed instructions. Multiple-choice Claude questions accept comma-separated numbers. Enter or `/cancel` skips the question. |

An approval reply applies only to that request. Goddard does not save a permanent allow rule when you type `y`.

If the agent says “Should I create a PR?” in an ordinary message, wait for the `You` prompt and answer there:

```text
You (Enter or /done to save and exit): Yes, create a PR after the tests pass.
```

Text typed outside an active prompt is not sent or queued. Goddard prints a notice so you can send it again when a prompt appears. This prevents an earlier message from becoming an answer to a later approval request.

If the run already stopped, use [note then run](https://github.com/kggayo/goddard/wiki/Resuming-work#add-an-answer-and-continue).

## Newlines and pasted text

At an active question or `You` prompt, compose the whole reply before submitting it:

| Action | Keys |
| --- | --- |
| Submit the completed reply | Enter |
| Add a newline | Ctrl+J |
| Add a newline with a portable alternative | Type `\`, then press Enter; the backslash becomes a newline |
| Add a newline when your terminal reports modified Enter | Shift+Enter or Alt+Enter |
| Paste code, logs, or a multiline reply | Paste normally, review the draft, then press Enter |

For Windows Terminal, Ctrl+J or `\` then Enter are the reliable newline shortcuts. Shift+Enter works when the terminal sends it as a distinct key sequence; if it submits instead, use Ctrl+J. Goddard does not change your Windows Terminal keybindings.

Pasted line breaks stay inside one editable draft. Goddard uses terminal paste markers when available and detects rapid input bursts for terminals that send pasted newlines as Enter events. With that fallback, pause briefly after pasting before pressing Enter; an Enter during the paste burst is kept as another newline. Windows CRLF line endings become ordinary newlines, and multiline replies retain their indentation and blank lines. Arrow keys and Backspace can edit the draft before submission.

These controls apply in a normal interactive terminal, including with `--plain` or `--no-color`. Pipes and terminals explicitly configured as `TERM=dumb` keep line-oriented input. Cancellation or EOF discards an unsubmitted terminal draft. A multiline paste is never treated as separate answers to successive approval prompts.

This follows the input conventions described in [Claude Code's multiline reference](https://code.claude.com/docs/en/interactive-mode#multiline-input). Codex also uses a composer with [paste-burst detection for Windows](https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/paste_burst.rs).

## Attaching images

Use the same image controls with Codex and Claude. Attach a screenshot when starting or resuming:

```powershell
goddard start "Fix the layout shown here" --agent codex --image "screenshots/login.png"
goddard run TASK_ID --agent claude --image before.png --image after.png
```

`-i PATH` is a short form of `--image PATH`. Repeat the option for multiple images. Relative paths use the workspace root, including when you set `--workspace`.

At the `You` prompt, enter `/image "C:\Screenshots\login screen.png"`. Goddard confirms the pending attachment and shows another prompt for your message. Add more images with another `/image` command, then type your message and press Enter. Empty Enter sends an image-only message when attachments are pending.

On Windows, copy an image or screenshot and press **Alt+V**, or enter **`/paste`**. Alt+V preserves your current text and cursor while adding the image. Ctrl+V also works if the terminal forwards that shortcut to Goddard; Windows Terminal often handles Ctrl+V itself, so use Alt+V for images. Ordinary pasted text still uses the multiline composer. Clipboard images currently require native Windows; macOS, Linux, WSL, and remote sessions can use saved files with `/image`.

Use `/images` to list pending attachments and `/remove-image N` to remove one by number. `/done`, cancellation, or EOF discards unsent images. Images attach to ordinary follow-up messages, not structured choice questions or approval answers.

PNG, JPEG, GIF, and WebP are accepted, up to **5 MiB per image**, **10 distinct images** and **20 MiB total per task**. Model support and provider image limits still apply. Goddard checks file type and size; the provider decodes the image. The terminal displays filenames and counts, not an image preview.

Submitted images are copied into `.goddard/`, retained for account failover and provider switches, and included in exported handoff bundles. New sessions receive all saved images in the order listed in `HANDOFF.md`. Original files can be moved or deleted afterward. `/remove-image` only removes a pending attachment. Image pixels are not redacted; attach and share screenshots accordingly.

Goddard translates the common attachments to [Codex local image inputs](https://learn.chatgpt.com/docs/app-server#turns) and [Claude streaming image blocks](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode). Its Windows shortcut follows [Claude Code's clipboard controls](https://code.claude.com/docs/en/interactive-mode#general-controls).

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
- At the `You` prompt, empty Enter with no pending images, or `/done`, saves and exits normally.

If the grace period expires, the handoff uses the last accepted checkpoint and available evidence. Inspect it before resuming uncertain operations. [Recovery help](https://github.com/kggayo/goddard/wiki/Troubleshooting).

## Formatting

A rotating `| / - \` indicator shows while Goddard connects or saves progress and while the agent is working. It clears around messages and pauses at input prompts. Use `--plain` to disable animation; redirected output and `TERM=dumb` also stay static. `--no-color` keeps the spinner without colors.

Goddard renders Markdown, code blocks, syntax colors, and readable approval details. Font family and size come from your terminal. Provider-specific widgets and native slash commands are not passed through.

```sh
goddard run TASK_ID --agent claude --no-color
goddard run TASK_ID --agent codex --plain
```

`--no-color` keeps Markdown rendering without colors or text styles. `--plain` shows the original Markdown as readable plain text. Formatting affects display, not saved handoff content. For an absent prompt, see [Troubleshooting](https://github.com/kggayo/goddard/wiki/Troubleshooting#i-cannot-answer-the-agent).

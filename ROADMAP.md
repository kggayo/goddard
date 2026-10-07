# Where this dog is headed

Goddard's job is simple: keep a coding task understandable and recoverable when an agent or account stops. This roadmap is a set of directions to explore, not a release schedule. Community evidence and working prototypes will shape the order.

## Working today

- [x] Managed Codex and Claude Code sessions.
- [x] Structured checkpoints, workspace evidence, and portable handoffs.
- [x] Interactive questions, approvals, follow-ups, model and effort selection.
- [x] Automatic account-profile discovery, selection, and quota failover.
- [x] Recovery tests with simulated crashes and quota exhaustion.

## Make the everyday path smoother

- [ ] Fresh-install reports and troubleshooting for Windows, Linux, and macOS.
- [ ] Clearer account availability and cooldown summaries in the terminal.
- [ ] More protocol compatibility fixtures across provider CLI versions.
- [ ] Better handoff quality checks: missing verification, stale next steps, and unresolved operations.
- [ ] A beginner walkthrough showing one task across two accounts and two agents.

## More companions

These targets are **not implemented**. A model API and a coding-agent CLI are different interfaces; we need to establish which one an adapter would use before promising support.

| Target | First useful contribution | Status |
| --- | --- | --- |
| DeepSeek | Investigate a supported coding interface and how tool events, auth, and quota can be observed | Research wanted |
| Muse | Identify the intended Muse product and its official interface, then evaluate integration | Scope to confirm |
| Kimi | Investigate its coding workflow and event, permission, and checkpoint support | Research wanted |
| Grok | Investigate a supported interface and whether a coding runtime is needed | Research wanted |
| Gemini | Investigate a coding CLI adapter, including approval flow, auth, and usage signals | Research wanted |

Have experience with one of these? Open a [feature proposal](https://github.com/kggayo/goddard/issues/new?template=feature_request.yml) with official documentation and a small, reproducible example. Research and documentation contributions count; you don't need to arrive with a complete adapter.

## The bar for a new adapter

An adapter should:

1. Start a supervised session with the chosen model and available effort setting.
2. Capture messages and tool activity without recording private model reasoning.
3. Deliver checkpoints and user updates, and represent uncertain operations honestly.
4. Forward permission requests and questions without automatically approving them.
5. Report real quota signals when available and preserve “unknown” when unavailable.
6. Stop its owned process before a replacement writes to the workspace.
7. Pass offline crash, quota, interaction, and handoff tests.
8. Document authentication, billing, missing capabilities, and any platform limitations.

An integration may have no account pool or proactive quota endpoint. That's a capability to explain, not a percentage to invent.

## Deliberate boundaries

Goddard does not promise unlimited credits, identical agent behavior, or exact transfer of private model state. Native unsupervised sessions are outside the current design because they don't give Goddard the same opportunity to capture progress. Automatic switching between *different providers* is not implemented; users select `--agent` explicitly.

# Security reports

Goddard handles local source files, account-profile paths, agent subprocesses, and handoff bundles. Problems that expose credentials, escape intended workspace boundaries, silently approve actions, or start overlapping writers deserve private attention.

Please report suspected vulnerabilities through [GitHub's private vulnerability reporting](https://github.com/kggayo/goddard/security/advisories/new). Avoid public issues for unpatched vulnerabilities or credential leaks.

Include the version or commit, operating system, affected provider CLI, a minimal reproduction, and the impact you observed. Use dummy credentials and a disposable workspace. Don't attach real login files, live tokens, customer data, or unsanitized handoffs.

## Supported versions

Security work targets the latest code on `main` and the current `0.3.x` line. Older versions are not maintained separately. This is an early community project; there is no guaranteed response or fix timeline.

## Expected boundaries

Provider CLIs own authentication. Goddard doesn't make credentials part of a handoff, and it doesn't automatically approve user permission requests. Account availability checks are not proof that a login or model call will succeed.

Handoff bundles can contain source code and tool output. Redaction and filename exclusions are best effort, and bundles are not encrypted. Review a bundle before sharing it. A malicious coding agent is not made safe by wrapping it in Goddard; the provider's sandbox and your permission choices remain important.

For ordinary bugs and usability issues, use the [bug template](https://github.com/kggayo/goddard/issues/new?template=bug_report.yml).

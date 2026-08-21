# peri-studio security policy

## Supported versions

Before the first stable `peri-studio-v*` release, security fixes land on the default branch. After
releases begin, only the newest peri-studio release line is supported unless a release note explicitly
states otherwise. The single `peri-studio` artifact contains both server and instance roles; long-lived
processes using the file should be upgraded as one protocol-compatible pair.

The browser application remains a single-user, loopback-only surface. Binding its HTTP/WebSocket
listener to a public interface, placing it behind an unreviewed proxy, or treating the unsigned native
archive as notarized software is outside the supported security boundary. The `connect` role may reach
a remote instance endpoint only through reviewed TLS (`wss`); non-loopback plaintext requires the
explicit `--allow-insecure` escape hatch and is unsupported outside controlled test networks.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or include credentials, tokens, private
prompts, database contents or exploit details in public logs. Use the repository's
[private security advisory form](https://github.com/KonghaYao/peri/security/advisories/new).

Include only the minimum evidence needed to reproduce the issue:

- affected peri-studio version or source revision and operating system;
- the impacted boundary (browser, server, instance, ACP child, persistence or release artifact);
- reproduction steps using synthetic data and redacted diagnostics;
- expected impact and any known preconditions.

Receipt, triage and remediation are handled on a best-effort basis. Maintainers will coordinate a
safe disclosure window when a report is confirmed; do not publish exploit details before a fix and
affected users have had a reasonable opportunity to upgrade.

## Dependency policy

`deny.toml`, `Cargo.lock` and `web/bun.lock` are the release dependency facts. CI refreshes RustSec
data, runs all cargo-deny advisory/license/source/bans checks, and runs Bun's advisory audit before
native release builds may start. An audit fetch failure is a failed gate, not a clean result.

One informational exception is currently recorded for `RUSTSEC-2026-0215`: `smallstr` is an
unmaintained transitive dependency of `yrs` and has no safe upgrade. The exact exception remains in
`deny.toml` so it cannot silently broaden to future advisories.

/** Conversation catalog 超长 assistant Markdown 样例（mock 流式 transcript）。 */
export const LONG_TRANSCRIPT_MARKDOWN = `# Peri Studio architecture overview

This document summarizes how the control plane, runtime hosts, and browser client cooperate. It is intentionally long so the Conversation scroll container can be exercised with realistic markdown density.

## 1. Background and goals

Peri Studio evolved from a single-machine stdio bridge into a **central server** with attachable Web clients. The product ships as one \`peri-studio\` binary, but two process roles remain distinct:

1. **Server** — authentication, project metadata, command coordination, Yjs projection.
2. **Instance** — hosts ACP child processes and reports runtime health over WebSocket.

The Web UI is a pure view layer: it never invents chat history and only reflects server facts.

### 1.1 Non-goals (first release)

- Chat migration across instances
- Automatic load balancing
- Public internet deployment (TLS-first remote connect is later)
- Duplicating durable session state in SQLite

> **Recovery invariant.** After restart, opening a persisted entry must use the exact ACP \`session_id\` via \`session/load\`. Hub must not guess titles or resurrect old runtimes.

## 2. Identity boundaries

Four identifiers must never be swapped:

| Identity | Scope | Notes |
| :--- | :--- | ---: |
| \`project_id\` | Sidebar grouping | SQLite metadata |
| ACP \`session_id\` | Durable thread | Authoritative on agent disk |
| \`chat_id\` | Runtime container | Memory + Yjs per chat |
| \`commandId\` | Side-effect dedup | Global metadata outbox |

\`\`\`ts filename=recovery.ts
type SessionOpen = {
  projectId: string;
  acpSessionId: string;
  commandId: string;
};

async function openPersistedSession(input: SessionOpen) {
  await hub.spawnIfNeeded(input.projectId);
  return acp.sessionLoad({ sessionId: input.acpSessionId, commandId: input.commandId });
}
\`\`\`

### 2.1 Command delivery semantics

Runtime create spans three side-effect boundaries:

- Hub chat state
- Instance child process
- ACP durable thread

Once \`session/new\` may have reached ACP stdin, killing the child **does not** prove the thread was not created. The command must converge to \`DELIVERY_UNKNOWN\` and clients must not auto-retry with a new id.

## 3. Data plane

Each chat owns paired Yjs documents plus a global Registry doc. ACP events are normalized server-side before projection. Browser clients attach read-only and send commands through the action channel.

### 3.1 Projection rules

- Registry \`projects\` rebuilds from SQLite on startup.
- \`project_sessions\` is an in-memory cache of ACP \`session/list\`, not durable SQLite.
- Per-chat projection updates are memory-only; crash recovery replays from ACP.

\`\`\`mermaid
flowchart LR
  Browser["Web panel"] -->|ws actions| Server["Control plane"]
  Server -->|commands| Instance["ACP host"]
  Instance -->|events| Server
  Server -->|ysync.update| Browser
\`\`\`

### 3.2 Browser authentication

Loopback HTTP uses HttpOnly cookies. Tokens never appear in logs, WebSocket URLs, or issue trackers. Principal-scoped IndexedDB stores session archive flags and custom display names.

## 4. Operational checklist

Use this section to validate a long transcript scroll:

- [x] Headings remain readable inside \`markdown-body\`
- [x] Tables wrap without breaking the column shell
- [x] Fenced code keeps monospace rhythm
- [x] Lists stack with consistent vertical rhythm
- [ ] Remote images require explicit consent (not loaded here)

### 4.1 Failure modes to expect

1. **Instance disconnect** — active turn becomes \`interrupted\`; user may start a new turn after catch-up.
2. **Server restart** — local supervised instances reconnect; SSH tunnels rebuild best-effort.
3. **Buffer overflow** — server surfaces a gap instead of pretending completeness.

\`\`\`sh
# Local health probe (loopback only)
curl -fsS http://127.0.0.1:8456/api/health
peri-studio status --ready --json
\`\`\`

## 5. Closing notes

When you finish reading, the Conversation scroll button should appear while you are scrolled away from the end. Streaming mode should keep partial fences stable until the closing backticks arrive.

Inline math $E = mc^2$ and display:

$$
\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
$$

External references stay plain links: [architecture baseline](https://example.test/architecture).

---

*End of mock assistant document — safe to truncate in streaming demos.*
`;

import type { ChatEntry, ToolCallInfo } from '../panel/lib/chat-view';

function tool(turn: number, step: number, overrides: Partial<ToolCallInfo>): ToolCallInfo {
  return {
    toolCallId: `long-tool-${turn}-${step}`,
    name: 'Read source',
    status: 'completed',
    arguments: { path: 'web/src/panel/store.ts' },
    result: { lines: 312 },
    resultOmitted: false,
    resultBytes: 64,
    publicError: null,
    startedAt: '2026-08-14T00:02:00Z',
    completedAt: '2026-08-14T00:02:01Z',
    ...overrides,
  };
}

function assistantText(turn: number): string {
  return `## Checkpoint ${turn}: recovery boundary

The projection remains consistent after replay. The next pass keeps the **persistent session**, runtime activation, and public error contract separate.

| Boundary | Observation | Decision |
| --- | --- | --- |
| Registry | Stable identity | Keep authoritative |
| Runtime | May restart | Rebind explicitly |
| Browser | Read-only projection | Never infer state |

- [x] Read the current projection
- [x] Compare the restart invariant
- [ ] Verify the next failure path

\`\`\`ts
const binding = await restoreSession(projectId);
if (binding.runtimeExpired) await activate(binding.acpSessionId);
\`\`\`

The implementation stays inside the existing boundary; no protocol field is inferred from UI state.`;
}

export function createLongConversationEntries(base: [ChatEntry, ChatEntry]): ChatEntry[] {
  return Array.from({ length: 36 }, (_, index) => {
    const assistant = index % 2 === 1;
    const turn = Math.floor(index / 2) + 1;
    return {
      ...(assistant ? base[1] : base[0]),
      id: `entry-long-${index}`,
      turnId: `turn-long-${turn}`,
      sourceCommandId: assistant ? null : `command-long-${index}`,
      text: assistant ? assistantText(turn) : `Continue with checkpoint ${turn}. Preserve the public error contract and show each verification step.`,
      reasoning: assistant ? [{ text: 'Compare the new observation with the previous checkpoint before moving forward.', visibility: 'user' }] : [],
      toolCalls: assistant ? [
        tool(turn, 1, { name: 'Read recovery projection', arguments: { path: 'web/src/panel/lib/chat-projection.ts' } }),
        tool(turn, 2, { name: 'Search runtime binding', arguments: { query: 'activeChatId', path: 'server/src' }, result: { matches: 4 } }),
        tool(turn, 3, { name: 'Update boundary', arguments: { path: 'web/src/panel/store.ts' }, result: { changed: true } }),
        tool(turn, 4, turn === 18
          ? { name: 'Run focused checks', status: 'running', arguments: { command: 'bun run test' }, result: null, resultOmitted: null, resultBytes: null, completedAt: null }
          : { name: 'Run focused checks', arguments: { command: 'bun run test' }, result: { passed: 23 } }),
      ] : [],
      resources: assistant && turn % 3 === 0 ? [{ resourceId: `resource://checkpoint-${turn}`, mediaType: 'text/markdown', name: `Checkpoint ${turn} notes` }] : [],
      error: null,
    };
  });
}

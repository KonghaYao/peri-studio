import { describe, expect, it } from 'vitest';
import type { ChatEntry } from '@/entities/chat/chat-view';
import { pickPreferredToolBlock, resolveHiddenToolBlocks, visibleToolCallsForEntry } from '@/features/chat/tool-block-dedup';

function toolBlock(
  blockId: string,
  toolCallId: string,
  status: string,
) {
  return {
    kind: 'tool_call' as const,
    id: blockId,
    toolCall: {
      toolCallId,
      name: 'Bash',
      kind: 'execute' as const,
      status,
      arguments: { command: 'pwd' },
      result: status === 'completed' ? { exitCode: 0 } : null,
      resultOmitted: false,
      resultBytes: null,
      publicError: null,
      startedAt: null,
      completedAt: status === 'completed' ? '2026-08-15T00:00:01Z' : null,
    },
  };
}

function assistantEntry(id: string, blocks: ChatEntry['blocks']): ChatEntry {
  return {
    id,
    turnId: 'turn-1',
    kind: 'message',
    role: 'assistant',
    status: 'streaming',
    authorUserId: null,
    sourceCommandId: null,
    origin: 'live',
    replayVerified: null,
    deliverySchemaVersion: null,
    deliveryState: null,
    deliveryErrorCode: null,
    payloadFingerprint: null,
    createdAt: '2026-08-15T00:00:00Z',
    completedAt: null,
    text: '',
    blocks,
    reasoning: [],
    toolCalls: blocks.flatMap((block) => block.kind === 'tool_call' ? [block.toolCall] : []),
    resources: [],
    error: null,
  };
}

describe('tool-block-dedup', () => {
  it('prefers a completed tool row over a stale running duplicate', () => {
    const running = toolBlock('tool:shared', 'shared', 'running');
    const completed = toolBlock('legacy-tool:shared', 'shared', 'completed');
    expect(pickPreferredToolBlock(running, completed)).toBe(completed);
  });

  it('hides a running duplicate when a later completed row exists in the same entry', () => {
    const hidden = resolveHiddenToolBlocks([
      assistantEntry('segment-tool', [
        toolBlock('tool:shared', 'shared', 'running'),
        toolBlock('legacy-tool:shared', 'shared', 'completed'),
      ]),
    ]);
    expect(hidden.get('segment-tool')).toEqual(new Set(['tool:shared']));
    expect(hidden.size).toBe(1);
  });

  it('hides cross-entry duplicates and keeps the terminal row', () => {
    const hidden = resolveHiddenToolBlocks([
      assistantEntry('segment-orphan', [
        toolBlock('legacy-tool:shared', 'shared', 'running'),
      ]),
      assistantEntry('segment-canonical', [
        toolBlock('tool:shared', 'shared', 'completed'),
      ]),
    ]);
    expect(hidden.get('segment-orphan')).toEqual(new Set(['legacy-tool:shared']));
    expect(hidden.get('segment-canonical')).toBeUndefined();
  });

  it('exposes only visible tool calls after dedup', () => {
    const entry = assistantEntry('segment-tool', [
      toolBlock('tool:shared', 'shared', 'running'),
      toolBlock('legacy-tool:shared', 'shared', 'completed'),
    ]);
    const hidden = resolveHiddenToolBlocks([entry]);
    expect(visibleToolCallsForEntry(entry, hidden).map((tool) => tool.status)).toEqual(['completed']);
  });
});

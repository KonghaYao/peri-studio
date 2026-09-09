import { describe, expect, it } from 'vitest';
import type { ChatBlock, ChatEntry } from '@/entities/chat/chat-view';
import { activityBoundaryAt, blockActivityDensity, buildAssistantLayoutUnits, buildConversationRowGroups, buildConversationSegments, shouldRenderActivityReasoningBlock } from './chat-render-blocks';

function reasoning(id: string, text: string): Extract<ChatBlock, { kind: 'reasoning' }> {
  return { kind: 'reasoning', id, reasoning: { id, text, visibility: 'visible' } };
}

function tool(id: string): Extract<ChatBlock, { kind: 'tool_call' }> {
  return {
    kind: 'tool_call',
    id,
    toolCall: {
      toolCallId: id,
      name: 'Read',
      status: 'completed',
      arguments: {},
      result: null,
      resultOmitted: false,
      resultBytes: 0,
      publicError: null,
      startedAt: null,
      completedAt: null,
    },
  };
}

function text(id: string, value: string): Extract<ChatBlock, { kind: 'text' }> {
  return { kind: 'text', id, text: value };
}

function chatEntry(id: string, turnId: string | null, blocks: ChatBlock[]): ChatEntry {
  return {
    id,
    turnId,
    kind: 'message',
    role: 'assistant',
    status: 'completed',
    authorUserId: null,
    sourceCommandId: null,
    origin: 'live',
    replayVerified: null,
    createdAt: '2026-09-09T00:00:00Z',
    completedAt: '2026-09-09T00:00:01Z',
    text: '',
    blocks,
    reasoning: blocks.flatMap((block) => block.kind === 'reasoning' ? [block.reasoning] : []),
    toolCalls: blocks.flatMap((block) => block.kind === 'tool_call' ? [block.toolCall] : []),
    resources: [],
    error: null,
  };
}

describe('chat-render-blocks', () => {
  it('跨同一 turn 的 assistant entry 识别 reasoning 与 tool 邻接', () => {
    const entries = [
      chatEntry('reasoning-entry', 'turn-1', [reasoning('r1', 'inspect')]),
      chatEntry('tool-entry', 'turn-1', [tool('t1')]),
    ];
    const boundary = activityBoundaryAt(entries, 0);

    expect(boundary).toEqual({ previousTool: false, nextTool: true });
    expect(blockActivityDensity(entries[0].blocks, 0, boundary)).toBe('activity');
    expect(buildConversationRowGroups(entries[0].blocks, boundary)[0]?.kind).toBe('activity');
  });

  it('不跨 turn 或 user entry 串联 activity', () => {
    const differentTurn = [
      chatEntry('reasoning-entry', 'turn-1', [reasoning('r1', 'inspect')]),
      chatEntry('tool-entry', 'turn-2', [tool('t1')]),
    ];
    expect(activityBoundaryAt(differentTurn, 0).nextTool).toBe(false);

    const user = { ...chatEntry('user-entry', 'turn-1', []), role: 'user' };
    expect(activityBoundaryAt([differentTurn[0], user, chatEntry('tool-entry', 'turn-1', [tool('t1')])], 0).nextTool).toBe(false);
  });

  it('跨 entry 的空 reasoning 仍使用 activity 空正文规则', () => {
    const entries = [
      chatEntry('reasoning-entry', 'turn-1', [reasoning('r1', '')]),
      chatEntry('tool-entry', 'turn-1', [tool('t1')]),
    ];
    const boundary = activityBoundaryAt(entries, 0);
    expect(shouldRenderActivityReasoningBlock(entries[0].blocks, 0, false, boundary)).toBe(true);
    expect(shouldRenderActivityReasoningBlock(entries[0].blocks, 0, true, boundary)).toBe(true);
  });

  it('将 thinking-tool-thinking 收敛为单个活动链', () => {
    const blocks = [reasoning('r1', 'before'), tool('t1'), reasoning('r2', 'after')];
    const segments = buildConversationSegments(blocks);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.kind).toBe('activity');
    if (segments[0]?.kind !== 'activity') throw new Error('expected activity');
    expect(segments[0].items.map((item) => item.kind)).toEqual(['reasoning', 'tool_group', 'reasoning']);
  });

  it('正文消息不会被降级为活动项', () => {
    const blocks = [text('a', 'answer'), tool('t1'), reasoning('r1', 'after')];
    const segments = buildConversationSegments(blocks);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ kind: 'content', blocks: [blocks[0]] });
    expect(segments[1]?.kind).toBe('activity');
  });

  it('不与 tool 相邻的 reasoning 保持正文段', () => {
    const blocks = [reasoning('solo', 'plan only'), text('a', 'answer')];
    expect(blockActivityDensity(blocks, 0)).toBe('normal');
    const segments = buildConversationSegments(blocks);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.kind).toBe('content');
  });

  it('空 reasoning 与 tool 相邻时仍进入活动链', () => {
    const blocks = [reasoning('empty', ''), tool('t1')];
    const segments = buildConversationSegments(blocks);
    expect(segments[0]?.kind).toBe('activity');
    if (segments[0]?.kind !== 'activity') throw new Error('expected activity');
    expect(segments[0].items[0]?.kind).toBe('reasoning');
  });

  it('layout unit id 在 block 内容更新时保持稳定', () => {
    const blocks = [text('entry:text', 'First'), tool('t1')];
    const first = buildAssistantLayoutUnits(blocks).map((unit) => unit.id);
    const second = buildAssistantLayoutUnits([
      text('entry:text', 'First second'),
      tool('t1'),
    ]).map((unit) => unit.id);
    expect(second).toEqual(first);
  });

  it('正文 block 追加不改变既有 activity 分组 id', () => {
    const base = [reasoning('r1', 'think'), tool('t1')];
    const before = buildConversationRowGroups(base).map((group) => group.id);
    const after = buildConversationRowGroups([
      ...base,
      text('answer', 'Updated answer'),
    ]).map((group) => group.id);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)).toBe('block:answer');
  });

  it('merges consecutive empty reasoning units in the activity track', () => {
    const blocks = [reasoning('r1', ''), reasoning('r2', ''), tool('t1')];
    const units = buildAssistantLayoutUnits(blocks);
    expect(units.filter((unit) => unit.kind === 'block')).toHaveLength(1);
  });

  it('hides completed empty reasoning placeholders in activity density', () => {
    const blocks = [reasoning('r1', ''), tool('t1')];
    expect(shouldRenderActivityReasoningBlock(blocks, 0, false)).toBe(true);
    expect(shouldRenderActivityReasoningBlock(blocks, 0, true)).toBe(true);
    expect(shouldRenderActivityReasoningBlock(blocks, 0, false)).toBe(true);
    expect(shouldRenderActivityReasoningBlock([reasoning('r1', 'note'), tool('t1')], 0, false)).toBe(true);
  });
});

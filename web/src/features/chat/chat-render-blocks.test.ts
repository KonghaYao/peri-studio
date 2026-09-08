import { describe, expect, it } from 'vitest';
import type { ChatBlock } from '@/entities/chat/chat-view';
import { blockActivityDensity, buildAssistantLayoutUnits, buildConversationRowGroups, buildConversationSegments } from './chat-render-blocks';

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

describe('chat-render-blocks', () => {
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
});

import { describe, expect, it } from 'vitest';
import { extractMessages } from './chat-payload';
import {
  callIdsMatch,
  enrichPartsWithToolResults,
  indexToolResults,
  prepareChatIoMessages,
  shouldAbsorbToolResultMessage,
} from './chat-io-tool-pairing';

const MERGE_DEMO = {
  messages: [
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tu_schema', name: 'read_schema', input: { path: 'docs/a.md' } },
      ],
      tool_calls: [{
        id: 'tc_read',
        function: { name: 'grep', arguments: '{"pattern":"x"}' },
      }],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_schema', content: '{"ok":true}' }],
    },
    {
      role: 'tool',
      name: 'grep',
      tool_call_id: 'tc_read_0123456789ab',
      content: 'line 36',
    },
  ],
};

describe('callIdsMatch', () => {
  it('matches exact ids', () => {
    expect(callIdsMatch('tc_read', 'tc_read')).toBe(true);
  });

  it('matches OpenAI suffixed tool_call_id', () => {
    expect(callIdsMatch('tc_read', 'tc_read_0123456789ab')).toBe(true);
  });
});

describe('indexToolResults', () => {
  it('indexes Anthropic and OpenAI tool results by call id', () => {
    const messages = extractMessages(MERGE_DEMO)!;
    const map = indexToolResults(messages);
    expect(map.get('tu_schema')).toBe('{"ok":true}');
    expect(map.get('tc_read')).toBe('line 36');
  });
});

describe('prepareChatIoMessages', () => {
  it('absorbs paired tool result messages', () => {
    const messages = extractMessages(MERGE_DEMO)!;
    const { messages: display } = prepareChatIoMessages(messages);
    expect(display).toHaveLength(1);
    expect(display[0].role).toBe('assistant');
  });

  it('keeps unpaired tool messages', () => {
    const messages = extractMessages({
      messages: [
        { role: 'assistant', tool_calls: [{ id: 'tc_a', function: { name: 'a', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'tc_orphan', content: 'orphan' },
      ],
    })!;
    const { messages: display } = prepareChatIoMessages(messages);
    expect(display).toHaveLength(2);
    expect(display[1].role).toBe('tool');
  });
});

describe('enrichPartsWithToolResults', () => {
  it('attaches results to matching tool_use parts', () => {
    const messages = extractMessages(MERGE_DEMO)!;
    const toolResults = indexToolResults(messages);
    const parts = enrichPartsWithToolResults(
      [
        { type: 'tool_use', id: 'tu_schema', name: 'read_schema', input: {} },
        { type: 'tool_use', id: 'tc_read', name: 'grep', input: '{}' },
      ],
      toolResults,
    );
    expect(parts[0]).toMatchObject({ type: 'tool_use', result: '{"ok":true}' });
    expect(parts[1]).toMatchObject({ type: 'tool_use', result: 'line 36' });
  });
});

describe('shouldAbsorbToolResultMessage', () => {
  it('returns true for paired tool carriers', () => {
    const messages = extractMessages(MERGE_DEMO)!;
    const assistantCallIds = ['tu_schema', 'tc_read'];
    expect(shouldAbsorbToolResultMessage(messages[1], assistantCallIds)).toBe(true);
    expect(shouldAbsorbToolResultMessage(messages[2], assistantCallIds)).toBe(true);
  });

  it('returns false for orphan tool messages', () => {
    const messages = extractMessages({
      messages: [{ role: 'tool', tool_call_id: 'orphan', content: 'x' }],
    })!;
    expect(shouldAbsorbToolResultMessage(messages[0], [])).toBe(false);
  });
});

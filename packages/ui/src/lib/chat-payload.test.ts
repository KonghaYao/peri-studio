import { describe, expect, it } from 'vitest';
import {
  contentToText,
  extractMessages,
  extractParts,
  groupConsecutive,
  isChatPayload,
  isKnownRole,
  parseMaybeString,
} from './chat-payload';

const CHAT_MESSAGES = [
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: 'Hello' },
  { role: 'assistant', content: 'Hi there' },
];

describe('isChatPayload', () => {
  it('detects { messages: [...] } shape', () => {
    expect(isChatPayload({ messages: CHAT_MESSAGES })).toBe(true);
  });

  it('detects bare message array', () => {
    expect(isChatPayload(CHAT_MESSAGES)).toBe(true);
  });

  it('rejects empty arrays', () => {
    expect(isChatPayload([])).toBe(false);
    expect(isChatPayload({ messages: [] })).toBe(false);
  });

  it('rejects non-chat JSON objects', () => {
    expect(isChatPayload({ model: 'gpt-4', temperature: 0.2 })).toBe(false);
    expect(isChatPayload({ items: [{ id: 1 }] })).toBe(false);
  });

  it('rejects primitives', () => {
    expect(isChatPayload('hello')).toBe(false);
    expect(isChatPayload(null)).toBe(false);
  });
});

describe('extractMessages', () => {
  it('returns normalized messages from wrapped payload', () => {
    const messages = extractMessages({ messages: CHAT_MESSAGES });
    expect(messages).toHaveLength(3);
    expect(messages![0]).toMatchObject({
      role: 'system',
      content: 'You are helpful.',
    });
    expect(messages![0].raw).toEqual(CHAT_MESSAGES[0]);
  });

  it('maps OpenAI tool_calls fields', () => {
    const raw = [{
      role: 'assistant',
      tool_calls: [{ id: 'tc1', function: { name: 'read', arguments: '{}' } }],
    }];
    const messages = extractMessages(raw);
    expect(messages).toHaveLength(1);
    expect(messages![0].role).toBe('assistant');
    expect(messages![0].toolCalls).toEqual(raw[0].tool_calls);
  });

  it('normalizes Anthropic tool_result user messages to tool role', () => {
    const raw = [{
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }],
    }];
    const messages = extractMessages(raw);
    expect(messages![0].role).toBe('tool');
  });

  it('returns null for non-chat data', () => {
    expect(extractMessages({ foo: 'bar' })).toBeNull();
  });
});

describe('extractParts', () => {
  it('extracts string content', () => {
    expect(extractParts('hello')).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('extracts Anthropic content parts', () => {
    const parts = extractParts([
      { type: 'text', text: 'hi' },
      { type: 'thinking', thinking: 'hmm' },
      { type: 'tool_use', id: 'tu1', name: 'grep', input: { q: 'x' } },
      { type: 'tool_result', tool_use_id: 'tu1', content: 'ok' },
      { type: 'image_url', image_url: { url: 'https://img' } },
      { type: 'input_audio' },
    ]);
    expect(parts).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'thinking', text: 'hmm' },
      { type: 'tool_use', id: 'tu1', name: 'grep', input: { q: 'x' } },
      { type: 'tool_result', id: 'tu1', text: 'ok' },
      { type: 'image', url: 'https://img' },
      { type: 'audio' },
    ]);
  });

  it('maps OpenAI tool_calls to tool_use parts with id', () => {
    const parts = extractParts(null, [{
      id: 'tc_read',
      function: { name: 'read', arguments: '{"path":"a"}' },
    }]);
    expect(parts).toEqual([{
      type: 'tool_use',
      id: 'tc_read',
      name: 'read',
      input: '{"path":"a"}',
    }]);
  });
});

describe('groupConsecutive', () => {
  it('groups adjacent same-role messages', () => {
    const groups = groupConsecutive([
      { role: 'tool', content: 'a', raw: {} },
      { role: 'tool', content: 'b', raw: {} },
      { role: 'user', content: 'c', raw: {} },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(2);
    expect(groups[1]).toHaveLength(1);
  });
});

describe('isKnownRole', () => {
  it('recognizes standard roles', () => {
    expect(isKnownRole('assistant')).toBe(true);
    expect(isKnownRole('custom')).toBe(false);
  });
});

describe('contentToText', () => {
  it('returns plain strings as-is', () => {
    expect(contentToText('hello')).toBe('hello');
  });

  it('joins text parts', () => {
    expect(contentToText([
      { type: 'text', text: 'line 1' },
      { type: 'text', text: 'line 2' },
    ])).toBe('line 1\nline 2');
  });

  it('renders media placeholders', () => {
    expect(contentToText([{ type: 'image_url', image_url: { url: 'https://x' } }])).toBe('[image]');
    expect(contentToText([{ type: 'input_audio' }])).toBe('[audio]');
  });

  it('renders thinking and tool parts', () => {
    expect(contentToText([{ type: 'thinking', thinking: 'hmm' }])).toBe('[thinking]\nhmm');
    expect(contentToText([{ type: 'tool_use', name: 'grep', input: { pattern: 'foo' } }]))
      .toContain('[tool_use: grep(');
    expect(contentToText([{ type: 'tool_result', content: 'done' }]))
      .toBe('[tool_result]\ndone');
  });

  it('serializes object content', () => {
    expect(contentToText({ key: 'value' })).toBe(JSON.stringify({ key: 'value' }, null, 2));
  });
});

describe('parseMaybeString', () => {
  it('parses JSON strings into objects', () => {
    const parsed = parseMaybeString('{"messages":[{"role":"user","content":"hi"}]}');
    expect(isChatPayload(parsed)).toBe(true);
  });

  it('leaves non-JSON strings unchanged', () => {
    expect(parseMaybeString('not json')).toBe('not json');
  });

  it('passes through non-string values', () => {
    expect(parseMaybeString({ ok: true })).toEqual({ ok: true });
    expect(parseMaybeString(42)).toBe(42);
  });
});

/**
 * Chat 形态 payload 检测与归一化（OpenAI / Langfuse SDK 惯例）。
 * 纯 TS，无 React / store / 协议依赖。
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool' | 'function' | 'developer';

export type ChatMessage = {
  role: string;
  content: unknown;
  name?: string;
  toolCalls?: unknown;
  toolCallId?: string;
  /** 原始 message 对象，供 JSON 检视保留完整字段。 */
  raw: unknown;
};

const KNOWN_ROLES = new Set(['system', 'user', 'assistant', 'tool', 'function', 'developer']);

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function isMessageLike(item: unknown): item is Record<string, unknown> & { role: string } {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return false;
  const obj = item as Record<string, unknown>;
  if (typeof obj.role !== 'string') return false;
  return 'content' in obj || 'tool_calls' in obj || 'toolCalls' in obj || KNOWN_ROLES.has(obj.role);
}

/**
 * 判断 `data` 是否为 chat completion 形态：
 * - `{ messages: [...] }`（trace input 常见）
 * - 裸 message 数组
 */
export function isChatPayload(data: unknown): boolean {
  if (Array.isArray(data)) {
    return data.length > 0 && data.every(isMessageLike);
  }
  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    const msgs = obj.messages;
    return Array.isArray(msgs) && msgs.length > 0 && msgs.every(isMessageLike);
  }
  return false;
}

/**
 * 从 chat payload 抽取 message 数组；非 chat 形态返回 null。
 */
export function extractMessages(data: unknown): ChatMessage[] | null {
  if (!isChatPayload(data)) return null;
  const raw = Array.isArray(data) ? data : (data as Record<string, unknown>).messages;
  return (raw as Record<string, unknown>[]).map((m) => ({
    role: normalizeRole(m.role, m.content),
    content: m.content,
    name: typeof m.name === 'string' ? m.name : undefined,
    toolCalls: m.tool_calls ?? m.toolCalls,
    toolCallId: typeof m.tool_call_id === 'string' ? m.tool_call_id : undefined,
    raw: m,
  }));
}

/**
 * Anthropic 细节：`role: "user"` 且 content 为 `{type:"tool_result"}` 数组时，
 * 归一为 `tool` 角色以便与 OpenAI `tool` 气泡对齐。
 */
function normalizeRole(role: unknown, content: unknown): string {
  const r = typeof role === 'string' ? role.toLowerCase() : 'user';
  if (
    r === 'user'
    && Array.isArray(content)
    && content.length > 0
    && content.every(
      (p) =>
        typeof p === 'object'
        && p !== null
        && (p as Record<string, unknown>).type === 'tool_result',
    )
  ) {
    return 'tool';
  }
  return r;
}

/**
 * 从 message content 抽取可展示文本：
 * - 纯字符串
 * - content part 数组（text / image_url / thinking / tool_use / tool_result）
 * - 任意对象（JSON 序列化）
 */
export function contentToText(content: unknown): string {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part === 'object' && part !== null) {
          const p = part as Record<string, unknown>;
          if (p.type === 'text' && typeof p.text === 'string') return p.text;
          if (p.type === 'image_url') return '[image]';
          if (p.type === 'input_audio') return '[audio]';
          if (p.type === 'thinking' && typeof p.thinking === 'string') {
            return `[thinking]\n${p.thinking}`;
          }
          if (p.type === 'tool_use') {
            const name = typeof p.name === 'string' ? p.name : 'tool';
            const args = typeof p.input === 'string' ? p.input : JSON.stringify(p.input ?? '');
            return `[tool_use: ${name}(${truncate(args, 200)})]`;
          }
          if (p.type === 'tool_result') {
            return `[tool_result]\n${contentToText(p.content)}`;
          }
          return JSON.stringify(part);
        }
        return String(part);
      })
      .join('\n');
  }
  if (typeof content === 'object') {
    try {
      return JSON.stringify(content, null, 2);
    } catch {
      return String(content);
    }
  }
  return String(content);
}

/**
 * Lite API 可能将 observation input/output 以 JSON 字符串返回；
 * 防御性解析以便形态检测看到对象，非 JSON 则原样返回。
 */
export function parseMaybeString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * 归一化 content part — ChatIo 渲染单元，覆盖 Anthropic part 数组与 OpenAI tool_calls。
 */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id?: string; name: string; input: unknown }
  | { type: 'tool_result'; id?: string; text: string }
  | { type: 'image'; url?: string }
  | { type: 'audio' }
  | { type: 'unknown'; raw: unknown };

function imageUrlToString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const url = (value as Record<string, unknown>).url;
    return typeof url === 'string' ? url : undefined;
  }
  return undefined;
}

/**
 * 将 message content + tool_calls 扁平化为统一 part 列表。
 */
export function extractParts(content: unknown, toolCalls?: unknown): ContentPart[] {
  const parts: ContentPart[] = [];
  if (typeof content === 'string') {
    if (content) parts.push({ type: 'text', text: content });
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') {
        parts.push({ type: 'text', text: part });
        continue;
      }
      if (typeof part !== 'object' || part === null) continue;
      const p = part as Record<string, unknown>;
      switch (p.type) {
        case 'text':
          parts.push({ type: 'text', text: typeof p.text === 'string' ? p.text : '' });
          break;
        case 'thinking':
          parts.push({ type: 'thinking', text: typeof p.thinking === 'string' ? p.thinking : '' });
          break;
        case 'tool_use':
          parts.push({
            type: 'tool_use',
            id: typeof p.id === 'string' ? p.id : undefined,
            name: typeof p.name === 'string' ? p.name : 'tool',
            input: p.input,
          });
          break;
        case 'tool_result':
          parts.push({
            type: 'tool_result',
            id: typeof p.tool_use_id === 'string' ? p.tool_use_id : undefined,
            text: contentToText(p.content),
          });
          break;
        case 'image_url':
          parts.push({ type: 'image', url: imageUrlToString(p.image_url) });
          break;
        case 'input_audio':
          parts.push({ type: 'audio' });
          break;
        default:
          parts.push({ type: 'unknown', raw: part });
      }
    }
  } else if (typeof content === 'object' && content !== null) {
    parts.push({ type: 'unknown', raw: content });
  }
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      if (typeof tc !== 'object' || tc === null) continue;
      const call = tc as Record<string, unknown>;
      const fn = call.function ?? tc;
      const rec = fn as Record<string, unknown>;
      parts.push({
        type: 'tool_use',
        id: typeof call.id === 'string' ? call.id : undefined,
        name: typeof rec.name === 'string' ? rec.name : 'tool',
        input: rec.arguments,
      });
    }
  }
  return parts;
}

/** 是否为已知 chat role。 */
export function isKnownRole(role: string): role is ChatRole {
  return KNOWN_ROLES.has(role);
}

/**
 * 将连续同 role 消息合并为视觉块，减少 tool 结果连发噪声。
 */
export function groupConsecutive(messages: ChatMessage[]): ChatMessage[][] {
  const groups: ChatMessage[][] = [];
  for (const msg of messages) {
    const last = groups[groups.length - 1];
    if (last && last[0].role === msg.role) {
      last.push(msg);
    } else {
      groups.push([msg]);
    }
  }
  return groups;
}

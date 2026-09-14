/**
 * Chat IO tool_use ↔ tool_result 配对：将后续 tool 消息内嵌到 assistant 工具调用块。
 */
import {
  contentToText,
  extractParts,
  type ChatMessage,
  type ContentPart,
} from './chat-payload';

export type ToolUsePartWithResult = Extract<ContentPart, { type: 'tool_use' }> & {
  result?: string;
};

export type DisplayContentPart = ContentPart | ToolUsePartWithResult;

/** OpenAI tool_call_id 可能与 call id 完全一致，或带 `_` 后缀。 */
export function callIdsMatch(callId: string, resultCallId: string): boolean {
  if (callId === resultCallId) return true;
  if (resultCallId.startsWith(`${callId}_`)) return true;
  return false;
}

function resolveCallId(resultCallId: string, knownCallIds: string[]): string {
  const exact = knownCallIds.find((id) => callIdsMatch(id, resultCallId));
  return exact ?? resultCallId;
}

/** 从 assistant 消息收集全部 tool call id（Anthropic tool_use + OpenAI tool_calls）。 */
export function collectToolCallIds(messages: ChatMessage[]): string[] {
  const ids: string[] = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    for (const part of extractParts(msg.content, msg.toolCalls)) {
      if (part.type === 'tool_use' && part.id) ids.push(part.id);
    }
  }
  return ids;
}

function resultEntriesFromMessage(msg: ChatMessage): Array<{ callId: string; text: string }> {
  const entries: Array<{ callId: string; text: string }> = [];

  if (msg.role === 'tool' || msg.role === 'function') {
    if (msg.toolCallId) {
      entries.push({ callId: msg.toolCallId, text: contentToText(msg.content) });
    }
  }

  for (const part of extractParts(msg.content, msg.toolCalls)) {
    if (part.type === 'tool_result' && part.id) {
      entries.push({ callId: part.id, text: part.text });
    }
  }
  return entries;
}

/** call id → result 文本；result id 归一化到 assistant 侧 call id。 */
export function indexToolResults(messages: ChatMessage[]): Map<string, string> {
  const callIds = collectToolCallIds(messages);
  const map = new Map<string, string>();

  for (const msg of messages) {
    for (const entry of resultEntriesFromMessage(msg)) {
      const key = resolveCallId(entry.callId, callIds);
      map.set(key, entry.text);
    }
  }
  return map;
}

function isToolResultCarrier(msg: ChatMessage): boolean {
  const parts = extractParts(msg.content, msg.toolCalls);
  if (parts.length > 0 && parts.every((part) => part.type === 'tool_result')) {
    return true;
  }
  return (msg.role === 'tool' || msg.role === 'function') && Boolean(msg.toolCallId);
}

/** 是否应吸收（不单独渲染）的 tool result 消息。仅当 result 能配对到 assistant call id 时吸收。 */
export function shouldAbsorbToolResultMessage(
  msg: ChatMessage,
  assistantCallIds: string[],
): boolean {
  if (!isToolResultCarrier(msg) || assistantCallIds.length === 0) return false;

  const parts = extractParts(msg.content, msg.toolCalls);
  const onlyToolResults = parts.length > 0 && parts.every((part) => part.type === 'tool_result');
  if (onlyToolResults) {
    return parts.every(
      (part) =>
        part.type === 'tool_result'
        && part.id
        && assistantCallIds.some((id) => callIdsMatch(id, part.id!)),
    );
  }

  if (msg.role === 'tool' || msg.role === 'function') {
    if (!msg.toolCallId) return false;
    return assistantCallIds.some((id) => callIdsMatch(id, msg.toolCallId!));
  }

  return false;
}

/** 为 assistant 消息 part 注入 result，并去掉已内嵌的独立 tool_result part。 */
export function enrichPartsWithToolResults(
  parts: ContentPart[],
  toolResults: Map<string, string>,
): DisplayContentPart[] {
  const enriched: DisplayContentPart[] = [];

  for (const part of parts) {
    if (part.type === 'tool_use' && part.id) {
      const direct = toolResults.get(part.id);
      if (direct !== undefined) {
        enriched.push({ ...part, result: direct });
        continue;
      }
      let matched = false;
      for (const [key, text] of toolResults) {
        if (callIdsMatch(part.id, key)) {
          enriched.push({ ...part, result: text });
          matched = true;
          break;
        }
      }
      if (matched) continue;
    }

    if (part.type === 'tool_result' && part.id) {
      const merged = [...toolResults.entries()].some(
        ([key, text]) => callIdsMatch(key, part.id!) && text === part.text,
      );
      if (merged) continue;
    }

    enriched.push(part);
  }

  return enriched;
}

export type PreparedChatIoMessages = {
  messages: ChatMessage[];
  toolResults: Map<string, string>;
};

/** 过滤已内嵌的 tool result 消息，供 ChatIoList 分组与渲染。 */
export function prepareChatIoMessages(messages: ChatMessage[]): PreparedChatIoMessages {
  const assistantCallIds = collectToolCallIds(messages);
  const toolResults = indexToolResults(messages);
  const filtered = messages.filter(
    (msg) => !shouldAbsorbToolResultMessage(msg, assistantCallIds),
  );
  return { messages: filtered, toolResults };
}

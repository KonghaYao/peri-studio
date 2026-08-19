export type UserMessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'system_reminder'; text: string };

const openingTag = '<system-reminder>';
const closingTag = '</system-reminder>';

/**
 * 将 user prompt 中完整的 system-reminder 标签隔离为惰性展示片段。
 * 不解释其中内容，也不处理未闭合标签，避免把普通用户输入误判为系统事实。
 */
export function splitSystemReminders(text: string): UserMessageSegment[] {
  const segments: UserMessageSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const openingAt = text.indexOf(openingTag, cursor);
    if (openingAt === -1) {
      segments.push({ kind: 'text', text: text.slice(cursor) });
      break;
    }

    const contentStart = openingAt + openingTag.length;
    const closingAt = text.indexOf(closingTag, contentStart);
    if (closingAt === -1) {
      segments.push({ kind: 'text', text: text.slice(cursor) });
      break;
    }

    if (openingAt > cursor) segments.push({ kind: 'text', text: text.slice(cursor, openingAt) });
    segments.push({ kind: 'system_reminder', text: text.slice(contentStart, closingAt).trim() });
    cursor = closingAt + closingTag.length;
  }

  return segments;
}

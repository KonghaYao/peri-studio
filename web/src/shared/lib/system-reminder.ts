export type UserMessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'system_reminder'; text: string };

const openingTagPattern = /<system-reminder\b[^>]*>/i;
const closingTagPattern = /<\/system-reminder\s*>/i;

function openingTagLengthAt(text: string, openingAt: number): number {
  const match = text.slice(openingAt).match(openingTagPattern);
  return match?.[0].length ?? 0;
}

function closingTagLengthAt(text: string, closingAt: number): number {
  const match = text.slice(closingAt).match(closingTagPattern);
  return match?.[0].length ?? 0;
}

function findOpeningTag(text: string, cursor: number): number {
  const slice = text.slice(cursor);
  const match = slice.match(openingTagPattern);
  if (!match || match.index === undefined) return -1;
  return cursor + match.index;
}

function findClosingTag(text: string, contentStart: number): number {
  const slice = text.slice(contentStart);
  const match = slice.match(closingTagPattern);
  if (!match || match.index === undefined) return -1;
  return contentStart + match.index;
}

/**
 * 将 user prompt 中完整的 system-reminder 标签隔离为惰性展示片段。
 * 标签匹配与 cleanSessionTitle 一致：大小写不敏感，允许 opening 标签带属性。
 * 不解释其中内容；未闭合标签整段保留为普通用户输入。
 */
export function splitSystemReminders(text: string): UserMessageSegment[] {
  const segments: UserMessageSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const openingAt = findOpeningTag(text, cursor);
    if (openingAt === -1) {
      segments.push({ kind: 'text', text: text.slice(cursor) });
      break;
    }

    const openLen = openingTagLengthAt(text, openingAt);
    if (!openLen) {
      segments.push({ kind: 'text', text: text.slice(cursor) });
      break;
    }

    const contentStart = openingAt + openLen;
    const closingAt = findClosingTag(text, contentStart);
    if (closingAt === -1) {
      segments.push({ kind: 'text', text: text.slice(cursor) });
      break;
    }

    if (openingAt > cursor) segments.push({ kind: 'text', text: text.slice(cursor, openingAt) });
    segments.push({ kind: 'system_reminder', text: text.slice(contentStart, closingAt).trim() });
    cursor = closingAt + closingTagLengthAt(text, closingAt);
  }

  return segments;
}

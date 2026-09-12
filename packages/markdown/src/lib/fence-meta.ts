export interface CodeFenceMeta {
  language: string;
  startLine: number;
  lineNumbers: boolean;
  filename: string;
}

/** 从 fence info 字符串解析语言与 Peri 扩展属性（startLine、filename、noLineNumbers）。 */
export function parseCodeFenceInfo(info: string): CodeFenceMeta {
  const trimmed = String(info ?? '').trim();
  if (!trimmed) {
    return { language: 'text', startLine: 1, lineNumbers: true, filename: '' };
  }

  const parts = trimmed.split(/\s+/);
  const language = parts[0]?.toLowerCase() || 'text';
  const meta: Record<string, string> = {};

  for (const part of parts.slice(1)) {
    if (part === 'noLineNumbers' || part === 'nolinenumbers') {
      meta.noLineNumbers = 'true';
      continue;
    }
    const eq = part.indexOf('=');
    if (eq > 0) {
      const key = part.slice(0, eq);
      const value = part.slice(eq + 1).replace(/^['"]|['"]$/g, '');
      meta[key] = value;
    }
  }

  return {
    language,
    startLine: Math.max(1, Number(meta.startLine ?? meta.startline ?? 1) || 1),
    lineNumbers: meta.noLineNumbers !== 'true' && meta.nolinenumbers !== 'true',
    filename: meta.filename ?? '',
  };
}

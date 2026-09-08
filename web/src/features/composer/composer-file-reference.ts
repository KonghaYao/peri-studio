import { promptByteLength, promptFitsBudget } from '@/shared/lib/prompt-budget';

/** 规范为 Composer 引用的 workspace-relative 路径（POSIX，无 leading `./`）。 */
export function normalizeReferencePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

/** `@relative/path` token（不含 leading/trailing 空白）。 */
export function formatFileReferenceToken(relativePath: string): string {
  const normalized = normalizeReferencePath(relativePath);
  return `@${normalized}`;
}

export interface InsertReferenceResult {
  text: string;
  caret: number;
}

/**
 * 在 caret/选区插入 `@path`。
 * 与 UX 契约对齐：若前一字符为空格则前缀换行；否则在非行首时加空格分隔。
 */
export function insertFileReferenceAtCaret(
  draft: string,
  selectionStart: number,
  selectionEnd: number,
  relativePath: string,
): InsertReferenceResult {
  const token = formatFileReferenceToken(relativePath);
  const start = Math.max(0, Math.min(selectionStart, draft.length));
  const end = Math.max(start, Math.min(selectionEnd, draft.length));
  const before = draft.slice(0, start);
  const after = draft.slice(end);

  let prefix = '';
  if (before.length > 0) {
    const prev = before[before.length - 1];
    if (prev === '\n') {
      prefix = '';
    } else if (prev === ' ' || prev === '\t') {
      prefix = '\n';
    } else {
      prefix = ' ';
    }
  }

  const insertion = `${prefix}${token}`;
  const text = `${before}${insertion}${after}`;
  const caret = before.length + insertion.length;
  return { text, caret };
}

export type ApplyReferenceOutcome =
  | { ok: true; text: string; caret: number; token: string }
  | { ok: false; reason: 'budget_exceeded'; token: string };

/** 插入引用并校验 UTF-8 prompt 预算；超限时 fail-closed。 */
export function applyFileReferenceWithBudget(
  draft: string,
  selectionStart: number,
  selectionEnd: number,
  relativePath: string,
  maxPromptBytes: number,
): ApplyReferenceOutcome {
  const token = formatFileReferenceToken(relativePath);
  const inserted = insertFileReferenceAtCaret(draft, selectionStart, selectionEnd, relativePath);
  if (!promptFitsBudget(inserted.text, maxPromptBytes)) {
    return { ok: false, reason: 'budget_exceeded', token };
  }
  return {
    ok: true,
    text: inserted.text,
    caret: inserted.caret,
    token,
  };
}

/** 是否已在草稿中包含同一引用 token（用于避免重复注入）。 */
export function draftContainsReferenceToken(draft: string, relativePath: string): boolean {
  const token = formatFileReferenceToken(relativePath);
  return draft.includes(token);
}

export function referenceInsertionByteCost(
  draft: string,
  selectionStart: number,
  selectionEnd: number,
  relativePath: string,
): number {
  const next = insertFileReferenceAtCaret(draft, selectionStart, selectionEnd, relativePath).text;
  return promptByteLength(next) - promptByteLength(draft);
}

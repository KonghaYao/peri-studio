/** 与 tokens.css --composer-field-line-height / --composer-expanded-field-max-height 对齐 */
export const COMPOSER_FIELD_LINE_HEIGHT_PX = Math.ceil(14 * 1.45);
export const COMPOSER_EXPANDED_FIELD_MAX_HEIGHT_PX = COMPOSER_FIELD_LINE_HEIGHT_PX * 3;

export function composerShellExpanded(input: {
  draft: string;
  attachmentCount: number;
  wrapped: boolean;
}): boolean {
  return input.attachmentCount > 0 || input.draft.includes('\n') || input.wrapped;
}

/**
 * 胶囊栏软换行：对照「无换行文本宽」与 compact 栏宽。
 * 禁止用 clamp 后的 scrollHeight / clientHeight——展开后输入区变宽，单行高度回落，
 * 会在胶囊/展开之间来回切，IME 上屏或软换行时打满 CPU。
 */
export function composerSoftWrapsAtWidth(input: {
  draft: string;
  nowrapWidth: number;
  compactWidth: number;
  currentlyWrapped: boolean;
}): boolean {
  if (!input.draft.trim() || input.draft.includes('\n')) return false;
  if (input.compactWidth <= 0 || input.nowrapWidth <= 0) return false;
  const slack = input.currentlyWrapped ? 1 : 2;
  return input.nowrapWidth > input.compactWidth + slack;
}

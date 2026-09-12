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

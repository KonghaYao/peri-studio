import { cn } from '../../lib/cn';

/** Composer 外壳：队列/通知在上，surface 居中限宽。 */
export const composerShellClass =
  'relative mx-auto flex w-full min-w-0 max-w-(--container-composer-launch) flex-col gap-10';

/** Composer surface 基础样式（compact / expanded 共用）。 */
export const composerSurfaceBaseClass =
  'relative overflow-visible border border-border-subtle bg-surface-canvas shadow-none data-[drop-active]:outline-2 data-[drop-active]:outline-dashed data-[drop-active]:outline-accent-solid data-[drop-active]:outline-offset-2';

/** Compact 胶囊形态 surface。 */
export const composerSurfaceCompactClass =
  'flex min-h-44 items-center rounded-(--composer-pill-radius) px-8';

/** Expanded 多行形态 surface。 */
export const composerSurfaceExpandedClass =
  'flex flex-col rounded-(--composer-active-radius)';

export const composerSurfaceAttachmentsClass = 'px-14 pt-10';

export const composerSurfaceBodyCompactClass =
  'flex h-44 w-full min-w-0 flex-1 items-center gap-8';

export const composerSurfaceBodyExpandedClass =
  'flex min-w-0 shrink-0 grow-0 basis-auto flex-col items-stretch gap-8 px-14 pb-4 pt-10';

/** 附件区后收紧 body 顶内边距。 */
export const composerSurfaceBodyExpandedWithAttachmentsClass = 'pt-4';

export const composerSurfaceLeadingClass =
  'flex min-w-0 shrink-0 grow-0 basis-auto items-center gap-8';

export const composerSurfaceTrailingClass =
  'flex min-w-0 shrink-0 grow-0 basis-auto items-center justify-end gap-8';

export const composerSurfaceFieldSlotCompactClass =
  'flex min-w-0 flex-1 items-center';

export const composerSurfaceFieldSlotExpandedClass =
  'flex w-full min-w-0 shrink-0 grow-0 basis-auto items-stretch';

export const composerSurfaceFieldBaseClass =
  'block w-full min-w-0 resize-none border-0 bg-transparent p-0 text-13 leading-normal text-content-primary outline-none placeholder:text-content-muted placeholder:opacity-100';

export const composerSurfaceFieldCompactClass =
  'max-h-(--control-height-sm) min-h-0 overflow-hidden';

export const composerSurfaceFieldExpandedClass =
  'max-h-(--composer-expanded-field-max-height) min-h-(--composer-field-line-height) shrink-0 grow-0 basis-auto overflow-y-auto';

export const composerSurfaceToolbarClass =
  'flex min-h-44 shrink-0 items-center gap-8 px-8 pb-8';

export const composerMetaRowClass =
  'flex min-h-28 shrink-0 items-center gap-8 px-4 text-12 text-content-secondary';

/** Composer 底栏 meta chip（分支 / runtime 等）。 */
export const composerMetaChipClass =
  'inline-flex max-w-144 min-h-0 min-w-0 shrink-0 items-center gap-4 border-0 bg-transparent px-4 py-2 text-12 text-content-secondary transition-colors duration-(--duration-fast) hover:text-content-primary';

export const composerAttachmentFloatClass = 'mb-8 flex flex-wrap gap-6';

/** Composer 待发队列容器。 */
export const composerQueueClass =
  'overflow-hidden rounded-(--composer-active-radius) border border-border-subtle bg-surface-canvas';

export const composerQueueHeaderClass =
  'flex items-center gap-8 border-b border-border-faint px-12 py-8';

export const composerQueueCountClass =
  'whitespace-nowrap text-12 font-medium text-content-secondary';

export const composerQueueItemClass =
  'group/queue-item flex min-h-(--control-height-default) items-center gap-10 bg-transparent px-12 py-8 transition-colors duration-(--duration-fast) hover:bg-surface-muted focus-within:bg-surface-muted pointer-coarse:bg-surface-muted';

export const composerQueueItemPreviewClass =
  'flex min-w-0 flex-1 items-center gap-8';

export const composerQueueItemIconClass = 'shrink-0 text-content-muted';

export const composerQueueItemTextClass =
  'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-13 leading-normal text-content-primary';

export const composerQueueItemActionsClass =
  'flex shrink-0 items-center gap-2 opacity-0 pointer-events-none transition-opacity duration-(--duration-fast) group-hover/queue-item:opacity-100 group-hover/queue-item:pointer-events-auto group-focus-within/queue-item:opacity-100 group-focus-within/queue-item:pointer-events-auto pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto';

export const composerQueueIconActionClass = 'shrink-0 rounded-md';

/** 附件方块列表容器。 */
export const composerAttachmentListClass = 'mb-8 flex flex-wrap gap-8';

export const composerAttachmentListItemClass = 'shrink-0 grow-0 basis-auto';

/** 输入叠层网格：hint 与 textarea 共用同一格。 */
export const composerEditorClass = 'relative isolate grid min-w-0 w-full';

export const composerEditorLayerClass = 'col-start-1 row-start-1 min-w-0';

export const composerEditorHintClass =
  'pointer-events-none overflow-hidden text-ellipsis whitespace-nowrap break-normal text-content-muted';

export const composerEditorHintPredictionClass = 'text-content-faint';

export const composerEditorHintDictationClass =
  'pointer-events-none whitespace-pre-wrap break-words text-content-primary';

export const composerInputClass =
  'relative z-1 min-w-0 leading-normal text-content-primary caret-content-primary placeholder:text-content-muted placeholder:opacity-100';

/** 模型 / runtime 徽标槽位。 */
export const composerRuntimeSlotClass =
  'min-w-0 max-w-(--model-badge-max) shrink-0 grow-0 basis-auto max-compact:max-w-none max-compact:grow max-compact:shrink max-compact:basis-auto';

/** Composer「+」触发钮。 */
export const composerPlusBtnClass =
  'inline-flex size-32 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-content-secondary transition-colors duration-(--duration-fast) hover:bg-interaction-hover hover:text-content-primary aria-expanded:bg-interaction-hover aria-expanded:text-content-primary data-[expanded]:bg-interaction-hover data-[expanded]:text-content-primary focus-visible:shadow-(--shadow-focus-ring) focus-visible:outline-none';

/** Slash 菜单浮层（锚在输入条上方，宽度走 token）。 */
export const composerSlashOverlayClass =
  'absolute bottom-full left-0 right-auto z-(--z-overlay) mb-8 w-(--container-slash-menu) max-w-full';

/** Slash 弹出层壳；保留 hook 类供 extra.css 覆盖 SlashMenu 内层圆角。 */
export const composerSlashPopoverClass =
  'ui-composer-slash-popover box-border w-(--container-slash-menu) max-w-(--container-slash-menu) min-w-0 overflow-hidden rounded-lg p-0 shadow-overlay';

export const composerSlashUploadClass =
  'block w-full cursor-pointer border-0 border-b border-border-subtle bg-transparent px-10 py-6 text-left transition-colors duration-(--duration-fast) hover:bg-interaction-hover';

/** 浮动附件 chip。 */
export const composerAttachmentChipClass =
  'inline-flex max-w-180 items-center gap-4 rounded-full border border-border-subtle bg-transparent px-8 py-2 text-11 leading-tight text-content-primary';

export const composerAttachmentChipRemoveClass =
  'inline-flex cursor-pointer border-0 bg-transparent p-0 text-content-faint hover:text-content-secondary';

export const composerAttachmentChipFailedClass =
  'border-danger-border text-danger-strong';

export const composerAttachmentChipBusyClass = 'text-content-secondary';

/** Compact 内联圆形发送钮尺寸。 */
export const composerSendBtnClass = 'size-32! rounded-full!';

/** 工具栏布局壳。 */
export const composerToolbarClass =
  'flex min-h-36 min-w-0 items-center gap-4 max-compact:flex-wrap max-compact:gap-y-6';

export const composerToolbarLeftClass =
  'flex min-w-0 shrink items-center gap-4 max-narrow:gap-2';

export const composerToolbarRightClass =
  'ml-auto flex min-w-0 items-center justify-end gap-4 max-compact:max-w-full max-compact:basis-full max-compact:grow max-compact:shrink-0';

/** Skills 钮：窄屏 ::before 前缀见 extra.css。 */
export const composerSkillsButtonClass =
  'ui-composer-skills relative inline-flex w-34 min-h-30 items-center justify-center gap-0 rounded-7 border-0 bg-transparent p-0 text-11 font-normal text-text-primary pointer-coarse:w-48 pointer-coarse:min-h-44';

export const composerSkillsIconClass = 'ui-composer-skills__icon';

export function composerSurfaceClass(expanded: boolean) {
  return cn(
    composerSurfaceBaseClass,
    expanded ? composerSurfaceExpandedClass : composerSurfaceCompactClass,
  );
}

export function composerSurfaceBodyClass(expanded: boolean, hasAttachments = false) {
  return cn(
    expanded ? composerSurfaceBodyExpandedClass : composerSurfaceBodyCompactClass,
    expanded && hasAttachments && composerSurfaceBodyExpandedWithAttachmentsClass,
  );
}

export function composerSurfaceFieldSlotClass(expanded: boolean) {
  return expanded
    ? composerSurfaceFieldSlotExpandedClass
    : composerSurfaceFieldSlotCompactClass;
}

export function composerSurfaceFieldClass(expanded: boolean) {
  return cn(
    composerSurfaceFieldBaseClass,
    expanded ? composerSurfaceFieldExpandedClass : composerSurfaceFieldCompactClass,
  );
}

import { cn } from '../../lib/cn';
import { workbenchFixedPanelSurfaceClass } from '../workbench/workbench-layout';

/** Rewind Dialog 浮层遮罩：桌面透明，窄屏与常规 Dialog 一致。 */
export const rewindDialogOverlayClass = 'bg-transparent max-desk:bg-scrim';

/**
 * DialogContent `size="rewind"` 外壳（桌面右侧浮动 workbench 宽，窄屏全高 sheet）。
 * 宽度归属 DialogContent，禁止在 T4 子节点重复 viewport 宽。
 */
export const rewindDialogContentClass = cn(
  'fixed left-auto z-61 flex h-auto max-h-none translate-x-0 translate-y-0 flex-col overflow-hidden p-0 outline-none',
  workbenchFixedPanelSurfaceClass,
  'max-desk:inset-y-0 max-desk:right-0 max-desk:h-auto max-desk:w-(--container-rewind-compact) max-desk:rounded-none max-desk:border-y-0 max-desk:border-r-0',
);

/** @deprecated 使用 DialogContent `size="rewind"`；保留测试与迁移期引用。 */
export const rewindDialogPanelClass = rewindDialogContentClass;

/** Rewind 面板根 flex 列（header + body + footer）。 */
export const rewindDialogShellClass = 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden';

/** Rewind 面板可滚动正文区。 */
export const rewindPanelBodyClass = 'box-border min-h-0 min-w-0 flex-1 overflow-auto px-12 py-14';

/** 步骤说明区（标题 + 描述），固定在 body 顶部。 */
export const rewindDialogIntroClass = 'shrink-0 border-b border-border-subtle pb-14 mb-14';

export const rewindDialogIntroTitleClass = 'm-0 text-13 font-semibold text-text-primary';

export const rewindDialogIntroDescriptionClass = 'mt-6 mb-0 text-12 leading-155 text-text-secondary';

/** 正文内分段（如 file impact 列表）。 */
export const rewindDialogSectionClass = 'mt-16';

export const rewindDialogSectionTitleClass = 'm-0 mb-8 text-12 font-medium text-text-primary';

/** Rewind 面板底栏（确认操作等）。 */
export const rewindPanelFooterClass = 'shrink-0 border-t border-border-subtle px-12 py-12';

/** Rewind 面板居中状态区（loading / empty / success / error）。 */
export const rewindPanelStateClass = cn(
  'flex min-h-180 flex-col items-center justify-center gap-8 px-12 py-24 text-center',
  'max-compact:py-20',
);

export const rewindPanelStateTitleClass = 'm-0 text-13 font-medium text-text-primary';

export const rewindPanelStateDescriptionClass = 'm-0 max-w-280 text-12 leading-155 text-text-muted';

/** LoadingState 在 Rewind 面板内垂直堆叠时的根 class。 */
export const rewindPanelLoadingStateClass = cn(
  rewindPanelStateClass,
  'flex flex-col items-center gap-12',
);

/** Rewind LoadingState 内 Spinner 尺寸。 */
export const rewindPanelLoadingSpinnerClass = 'mb-12 size-22';

/** Rewind 面板底栏操作行；窄屏 primary 置顶（flex-col-reverse）。 */
export const rewindPanelActionsClass = cn(
  'flex justify-end gap-8',
  'max-compact:flex-col-reverse',
);

/** T4 按钮在窄屏 Rewind 操作行上的最小触控高度。 */
export const rewindPanelActionButtonClass = 'max-compact:min-h-44';

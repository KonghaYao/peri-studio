import { cn } from '../../lib/cn';
import { workbenchFixedPanelSurfaceClass } from '../workbench/workbench-layout';

/** Rewind Dialog 浮层遮罩：桌面透明，窄屏与常规 Dialog 一致。 */
export const rewindDialogOverlayClass = 'bg-transparent max-desk:bg-scrim';

/** Rewind Dialog 贴右浮动壳（桌面 workbench 宽度，窄屏全高紧凑宽）。 */
export const rewindDialogPanelClass = cn(
  'fixed left-auto z-61 flex h-auto max-h-none translate-x-0 translate-y-0 flex-col p-0',
  workbenchFixedPanelSurfaceClass,
  'max-desk:inset-y-0 max-desk:right-0 max-desk:h-auto max-desk:w-(--container-rewind-compact) max-desk:rounded-none max-desk:border-y-0 max-desk:border-r-0',
);

/** Rewind 面板可滚动正文区。 */
export const rewindPanelBodyClass = 'box-border min-h-0 flex-1 overflow-auto px-10 py-10';

/** Rewind 面板居中状态区（loading / empty / success / error）。 */
export const rewindPanelStateClass = cn(
  'grid min-h-180 place-content-center justify-items-center p-24 text-center',
  'max-compact:px-8 max-compact:py-20',
);

/** LoadingState 在 Rewind 面板内垂直堆叠时的根 class。 */
export const rewindPanelLoadingStateClass = cn(
  rewindPanelStateClass,
  'flex flex-col items-center gap-12',
);

/** Rewind LoadingState 内 Spinner 尺寸。 */
export const rewindPanelLoadingSpinnerClass = 'mb-12 size-22';

/** Rewind 面板底栏操作行；窄屏 primary 置顶（flex-col-reverse）。 */
export const rewindPanelActionsClass = cn(
  'mt-20 flex justify-end gap-8',
  'max-compact:flex-col-reverse',
);

/** T4 按钮在窄屏 Rewind 操作行上的最小触控高度。 */
export const rewindPanelActionButtonClass = 'max-compact:min-h-44';

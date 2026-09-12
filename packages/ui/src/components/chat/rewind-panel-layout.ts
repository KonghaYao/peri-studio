import { cn } from '../../lib/cn';

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

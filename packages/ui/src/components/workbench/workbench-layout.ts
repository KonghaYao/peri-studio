import { cn } from '../../lib/cn';

/** Workbench 外壳：竖轨 + 可选浮动面板槽。 */
export const workbenchShellClass = cn(
  'flex h-full min-h-0 border-l border-border-subtle bg-neutral-25',
);

/** 桌面 rail-only 宽度（非 compact）。 */
export const workbenchShellDefaultClass = cn(
  workbenchShellClass,
  'relative shrink-0 w-(--workbench-rail-width)',
);

/** 紧凑布局（如 catalog 演示帧内全宽 workbench）。 */
export const workbenchShellCompactClass = cn(
  workbenchShellClass,
  'relative min-h-0 h-auto w-full flex-1',
);

/** 竖轨容器。 */
export const workbenchRailClass = cn(
  'flex w-(--workbench-rail-width) shrink-0 flex-col items-center gap-4 bg-neutral-25 py-8',
);

/** 保留 extra.css ::before 激活指示条（left）。 */
export const workbenchRailButtonActiveLeftClass = 'ui-workbench-rail-button--active-left';

/** 保留 extra.css ::before 激活指示条（right）。 */
export const workbenchRailButtonActiveRightClass = 'ui-workbench-rail-button--active-right';

export const workbenchRailButtonBadgeClass = cn(
  'absolute right-2 bottom-2 min-w-14 rounded-6 bg-accent-solid px-4 text-center text-9 leading-14 text-content-on-accent',
);

export const workbenchPanelChromeClass = 'flex min-h-0 min-w-0 flex-1 flex-col';

export const workbenchPanelChromeHeaderClass = cn(
  'flex h-(--control-height-md) shrink-0 items-center gap-8 border-b border-border-subtle px-12',
);

export const workbenchPanelChromeTitleClass = cn(
  'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-11 font-semibold tracking-35 uppercase text-content-muted',
);

export const workbenchPanelChromeActionsClass = 'flex shrink-0 items-center gap-4';

export const workbenchPanelChromeBodyClass = 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden';

/** Explorer / SCM / Graph 等内容区 surface。 */
export const workbenchPanelSurfaceClass = 'flex min-h-0 min-w-0 flex-1 flex-col bg-neutral-25';

export const workbenchFloatingPanelBaseClass = cn(
  'absolute z-30 box-border overflow-hidden border border-border-subtle rounded-14 bg-neutral-25 shadow-raised',
  'top-(--workbench-panel-inset-block) bottom-(--workbench-panel-inset-bottom)',
);

export const workbenchFloatingPanelRightClass = cn(workbenchFloatingPanelBaseClass, 'right-52');

export const workbenchFloatingPanelLeftClass = cn(workbenchFloatingPanelBaseClass, 'left-0');

/** Catalog / 内嵌演示面板固定宽度壳。 */
export const workbenchEmbeddedPanelClass = cn(
  'flex h-full w-(--workbench-panel-width) flex-col overflow-hidden bg-neutral-25',
);

/** 固定 token 宽度的右侧浮动壳（Rewind 等不接入拖拽宽度的面板）。 */
export const workbenchFixedPanelSurfaceClass = cn(
  'inset-y-8 right-52 w-(--workbench-panel-width) overflow-hidden rounded-14 border border-border-subtle bg-neutral-25 shadow-overlay wide:w-(--workbench-panel-width-wide)',
);

/** 拖拽调宽时挂到 document.body（保留 extra.css 全局 cursor）。 */
export const WORKBENCH_PANEL_RESIZING_BODY_CLASS = 'ui-workbench-panel-resizing';

export const workbenchPanelResizeHandleClass =
  'group pointer-events-none absolute z-1 top-0 bottom-0 w-12 touch-none';

export const workbenchPanelResizeHandleDraggingClass = 'cursor-col-resize select-none';

export const workbenchPanelResizeGripClass = cn(
  'absolute top-0 bottom-0 w-2 cursor-col-resize rounded-full bg-transparent transition-colors pointer-events-auto',
  'group-hover:bg-sidebar-resize-handle-hover group-focus-visible:bg-sidebar-resize-handle-hover',
);

export const workbenchPanelResizeGripDraggingClass = 'bg-sidebar-resize-handle-hover';

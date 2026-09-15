/** Monitor 面板共享 Tailwind 类（T3 · Langfuse trace 列表）。 */

export const monitorPanelClass = 'flex min-h-0 flex-col bg-neutral-25';

export const monitorSummaryClass =
  'flex shrink-0 flex-wrap items-center gap-x-12 gap-y-4 border-b border-border-subtle px-12 py-10 text-11 text-content-muted';

export const monitorSummaryItemClass = 'whitespace-nowrap';

export const monitorListClass = 'ui-scrollbar min-h-0 flex-1 overflow-auto';

export const monitorTraceRowClass =
  'flex min-h-32 w-full items-center gap-8 border-b border-border-faint px-12 py-8 text-left text-12 last:border-b-0 transition-colors hover:bg-interaction-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring';

export const monitorTraceButtonClass = monitorTraceRowClass;

export const monitorDetailHeaderClass =
  'flex shrink-0 items-center gap-8 border-b border-border-subtle px-8 py-8';

export const monitorDetailTitleClass = 'min-w-0 flex-1 truncate text-12 font-600 text-content-primary';

export const monitorObservationTreeClass = 'ui-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-2';

export const monitorObservationRowClass =
  'group flex min-h-28 w-full items-center gap-8 rounded-4 px-8 py-4 text-left text-11 transition-colors hover:bg-interaction-hover';

export const monitorObservationRowRootClass = 'bg-surface-sunken hover:bg-interaction-hover';

export const monitorObservationNameClass = 'truncate font-500 text-content-primary';

export const monitorObservationDurationClass = 'shrink-0 text-10 font-500 text-content-muted';

export const monitorObservationTokensClass = 'shrink-0 text-10 text-content-muted';

export const monitorObservationMetaClass = 'shrink-0 text-10 text-content-muted';

/** 子节点缩进：仅用 margin/padding，禁止 border-left 树线。 */
export const monitorObservationChildrenClass = 'ml-20 flex flex-col gap-2 pl-8';

export const monitorObservationChipClass =
  'flex h-24 w-24 shrink-0 items-center justify-center rounded-4';

export const monitorObservationChipSpanClass =
  'bg-surface-muted text-content-secondary';

export const monitorObservationChipChainClass =
  'bg-surface-muted text-content-secondary';

export const monitorObservationChipGenerationClass =
  'bg-surface-muted text-content-primary';

export const monitorObservationChipScoreClass =
  'bg-success-soft text-success';

export const monitorObservationChipGenericClass =
  'bg-surface-muted text-content-muted';

export const monitorObservationChevronClass =
  'ml-auto shrink-0 text-content-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100';

export const monitorObservationRowInteractiveClass =
  'cursor-pointer focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring';

export const monitorObservationDetailBodyClass =
  'ui-scrollbar min-h-0 flex-1 overflow-auto px-12 py-10';

export const monitorObservationDetailSectionClass = 'flex flex-col gap-4';

export const monitorObservationDetailLabelClass =
  'text-10 font-600 uppercase tracking-wide text-content-muted';

export const monitorObservationDetailValueClass = 'text-12 text-content-primary';

export const monitorObservationDetailPreClass =
  'ui-scrollbar max-h-(--container-monitor-io-preview-max) overflow-auto rounded-4 border border-border-subtle bg-surface-sunken p-8 font-mono text-11 leading-16 text-content-primary whitespace-pre-wrap break-words';

export const monitorObservationDetailTruncatedClass = 'text-10 text-content-muted';

export const monitorTraceNameClass = 'min-w-0 flex-1 truncate font-500 text-content-primary';

export const monitorTraceMetaClass = 'shrink-0 text-11 text-content-muted';

export const monitorTraceErrorClass = 'shrink-0 rounded-4 bg-danger-soft px-6 py-2 text-10 font-600 text-danger';

export const monitorStateClass = 'flex min-h-0 flex-1 flex-col items-center justify-center p-16 text-center';

/** fuse observation-tree 行缩进：depth * 12px + 4px。 */
const MONITOR_TRACE_TURN_TREE_DEPTH_CLASSES = [
  'pl-4',
  'pl-16',
  'pl-28',
  'pl-40',
  'pl-52',
  'pl-64',
] as const;

export function monitorTraceTurnTreeDepthClass(depth: number): string {
  return MONITOR_TRACE_TURN_TREE_DEPTH_CLASSES[depth] ?? MONITOR_TRACE_TURN_TREE_DEPTH_CLASSES.at(-1)!;
}

export const monitorTraceTurnTreeRowClass =
  'group flex w-full items-center gap-6 rounded-4 py-6 pr-4 text-12 transition-colors';

export const monitorTraceTurnTreeRowInteractiveClass =
  'cursor-pointer text-content-secondary hover:bg-interaction-hover hover:text-content-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring';

/** 选中态对齐 studio 列表行：背景强调，禁止左边框 accent bar。 */
export const monitorTraceTurnTreeRowSelectedClass =
  'bg-surface-sunken font-500 text-content-primary';

export const monitorTraceTurnTreeClass = 'flex h-full min-h-0 flex-1 flex-col';

/** 单框左右分栏：外圈一次 border/radius，树 pane 仅 border-r 分隔。 */
export const monitorTraceTurnTreeShellRootClass =
  'flex h-full min-h-0 flex-1 overflow-hidden rounded-8 border border-border-subtle bg-surface-overlay';

export const monitorTraceTurnTreeShellTreeClass =
  'flex min-h-0 shrink-0 basis-(--container-monitor-trace-tree) w-(--container-monitor-trace-tree) min-w-(--container-monitor-trace-tree-min) max-w-(--container-monitor-trace-tree-max) flex-col border-r border-border-subtle';

export const monitorTraceTurnTreeShellDetailClass =
  'flex min-h-0 min-w-0 flex-1 basis-0 flex-col';

/** 单栏树 + 右侧 Sheet 详情：外圈一次 border/radius，树区独立滚动。 */
export const monitorTraceTurnTreeSheetRootClass =
  'flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-8 border border-border-subtle bg-surface-overlay';

export const monitorTraceTurnTreeSheetTreeBodyClass =
  'flex min-h-0 flex-1 flex-col overflow-hidden';

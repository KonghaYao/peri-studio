/** Git Graph 面板 table / row / cell 共享 Tailwind 类（T3 · mhutchie/vscode-git-graph 对齐）。 */

export const gitGraphPanelClass = 'flex min-h-0 flex-col bg-neutral-25';

export const gitGraphControlsClass =
  'flex h-36 shrink-0 items-center gap-8 border-b border-border-subtle px-12';

export const gitGraphControlBtnClass =
  'w-28 min-h-28 border-0 bg-transparent text-text-muted hover:bg-hover hover:text-text-primary';

export const gitGraphContentClass = 'ui-scrollbar min-h-0 flex-1 overflow-auto';

export const gitGraphScrollClass = 'relative min-w-full';

export const gitGraphSvgClass = 'pointer-events-none absolute top-0 left-0 z-2 block';

export const gitGraphTableClass = 'w-full border-collapse text-13';

export const gitGraphTdClass =
  'box-border h-(--git-graph-row-height) max-h-(--git-graph-row-height) overflow-hidden px-12 align-middle text-13 leading-(--git-graph-row-height)';

export const gitGraphTdGraphColClass = 'p-0';

export const gitGraphTdDescColClass = 'overflow-hidden';

export const gitGraphDateColClass =
  'w-(--git-graph-date-col-width) max-w-(--git-graph-date-col-width) px-6 text-ellipsis whitespace-nowrap max-compact:hidden';

export const gitGraphAuthorColClass =
  'w-(--git-graph-author-col-width) max-w-(--git-graph-author-col-width) px-6 text-ellipsis whitespace-nowrap max-desk:hidden';

export const gitGraphCommitColClass =
  'w-(--git-graph-commit-col-width) max-w-(--git-graph-commit-col-width) px-6 text-13 text-ellipsis whitespace-nowrap';

export const gitGraphRowClass =
  'h-(--git-graph-row-height) cursor-default hover:bg-hover';

export const gitGraphRowHoverClass = 'bg-hover';

export const gitGraphRowSelectedClass = 'bg-selected';

export const gitGraphDescriptionClass =
  'flex h-(--git-graph-row-height) min-w-0 items-center overflow-hidden';

export const gitGraphMessageClass =
  'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-text-primary';

export const gitGraphMessageCurrentClass = 'font-semibold';

export const gitGraphHeadDotClass =
  'mr-6 inline-block size-6 shrink-0 rounded-full border-2 border-solid';

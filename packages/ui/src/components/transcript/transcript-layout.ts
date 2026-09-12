/** Transcript 虚拟化滚动视口。 */
export const transcriptScrollClass =
  'scrollbar-gutter-stable min-w-0 overflow-x-clip overflow-anchor-none contain-none';

/** 虚拟化 transcript 行壳。 */
export const transcriptRowClass = 'flow-root';

/** Transcript 历史分界行。 */
export const transcriptHistoryBoundaryClass =
  'grid grid-cols-boundary items-center gap-8 my-4 text-center text-text-muted text-10 tracking-25';

/** Transcript 历史分界左右分隔线。 */
export const transcriptHistoryBoundaryLineClass = 'h-px bg-divider';

/** Transcript 底部隔离空白，避免末条消息贴住 composer。 */
export const transcriptFooterSpacerClass = 'h-16 shrink-0';

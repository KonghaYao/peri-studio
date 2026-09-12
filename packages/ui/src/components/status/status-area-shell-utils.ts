import { cn } from '../../lib/cn';

/** 状态区根 section。 */
export const statusAreaShellClass = 'w-full min-w-0';

/** Card 壳 overflow（圆角/边框由 Card 默认 + T4 覆盖）。 */
export const statusAreaShellCardClass = 'overflow-hidden';

/** CardHeader 行间距（与 tab 折叠钮）。 */
export const statusAreaShellHeaderClass = 'gap-8';

/** 折叠后展开的面板 body。 */
export const statusAreaShellBodyClass = 'flex flex-col gap-2';

/** Status tab trigger：与生产 StatusArea / sandbox StatusAreaLayout 对齐。 */
export const statusAreaTabTriggerClass = cn(
  'inline-flex h-28 max-w-full items-center gap-6 rounded-md border-0 border-b-0 px-8 py-0 text-12 transition-colors duration-(--duration-fast)',
  'text-content-muted hover:bg-interaction-hover hover:text-content-primary',
  'data-selected:bg-accent-soft data-selected:font-medium data-selected:text-content-primary',
);

/** Plan / async / changes 行 hover 底。 */
export const statusAreaRowClass = cn(
  'flex min-h-36 w-full items-center gap-12 rounded-md px-8 py-6 text-left transition-colors duration-(--duration-fast) hover:bg-interaction-hover',
);

/** 可滚动 tab 面板内边距与最大高度。 */
export const statusAreaPanelClass = cn(
  'ui-scrollbar max-h-(--status-panel-max-height) overflow-auto px-8 pb-8 pt-0 outline-none',
);

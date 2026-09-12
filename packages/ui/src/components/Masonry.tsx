import { createMemo, For, splitProps, type Component, type ComponentProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import { mergeInlineStyle } from '../lib/merge-style';
import { GRID_BREAKPOINT_ORDER, useGridBreakpoint, type GridBreakpoint } from '../lib/breakpoints';
import { resolveLayoutGap, type LayoutGapSize } from '../lib/layout-gap';

export type MasonryItem = {
  key: string | number;
  data?: unknown;
  children?: JSX.Element;
};

type MasonryProps = ComponentProps<'div'> & {
  items?: MasonryItem[];
  columns?: number | Partial<Record<GridBreakpoint, number>>;
  gutter?: LayoutGapSize;
  itemRender?: (item: MasonryItem, index: number) => JSX.Element;
};

function resolveColumns(columns: MasonryProps['columns'], breakpoint: GridBreakpoint): number {
  if (typeof columns === 'number') return columns;
  if (!columns) return 3;
  for (const key of GRID_BREAKPOINT_ORDER) {
    const value = columns[key];
    if (value !== undefined && GRID_BREAKPOINT_ORDER.indexOf(breakpoint) >= GRID_BREAKPOINT_ORDER.indexOf(key)) {
      return value;
    }
  }
  return columns.xs ?? 1;
}

export const Masonry: Component<MasonryProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'items', 'columns', 'gutter', 'itemRender', 'style', 'children']);
  const breakpoint = useGridBreakpoint();

  const columnCount = createMemo(() => resolveColumns(local.columns, breakpoint()));
  const gap = () => resolveLayoutGap(local.gutter ?? 'middle') ?? 'var(--space-16)';

  const items = createMemo(() => local.items ?? []);

  const columns = createMemo(() => {
    const count = columnCount();
    const buckets: MasonryItem[][] = Array.from({ length: count }, () => []);
    items().forEach((item, index) => {
      buckets[index % count].push(item);
    });
    return buckets;
  });

  const rootStyle = (): JSX.CSSProperties | undefined => mergeInlineStyle(local.style, { gap: gap() });

  const masonryStyle = (): JSX.CSSProperties => ({
    ...(rootStyle() ?? {}),
    'grid-template-columns': `repeat(${columnCount()}, minmax(0, 1fr))`,
  });

  return (
    <div
      data-slot="masonry"
      class={cn('ui-masonry grid', local.class)}
      style={masonryStyle()}
      {...rest}
    >
      <For each={columns()}>
        {(column) => (
          <div data-slot="masonry-column" class="ui-masonry-column flex flex-col" style={{ gap: gap() }}>
            <For each={column}>
              {(item, index) => (
                <div data-slot="masonry-item" class="ui-masonry-item">
                  {local.itemRender ? local.itemRender(item, index()) : item.children}
                </div>
              )}
            </For>
          </div>
        )}
      </For>
      {local.children}
    </div>
  );
};

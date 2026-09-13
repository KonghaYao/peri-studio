import { cva, type VariantProps } from 'class-variance-authority';
import {
  For,
  Show,
  splitProps,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { cn } from '../../lib/cn';

export type DescriptionsItem = {
  key?: string;
  label: JSX.Element;
  children: JSX.Element;
  span?: number;
};

type ItemPlacement = {
  item: DescriptionsItem;
  row: number;
  colStart: number;
  span: number;
  isRowEnd: boolean;
};

const descriptionsVariants = cva('w-full text-13', {
  variants: {
    size: {
      sm: 'text-12',
      md: 'text-13',
    },
    bordered: {
      true: 'rounded-8 border border-border-subtle overflow-hidden',
      false: '',
    },
  },
  defaultVariants: {
    size: 'md',
    bordered: false,
  },
});

type DescriptionsVariantProps = VariantProps<typeof descriptionsVariants>;

export type DescriptionsProps = ComponentProps<'div'> &
  DescriptionsVariantProps & {
    title?: JSX.Element;
    extra?: JSX.Element;
    column?: number;
    colon?: boolean;
    layout?: 'horizontal' | 'vertical';
    items?: DescriptionsItem[];
  };

/** 将 items 按 column / span 排入网格行，供边框与 grid-column 计算使用。 */
export function layoutDescriptionItems(
  items: DescriptionsItem[],
  columns: number,
): { placements: ItemPlacement[]; rowCount: number } {
  const placements: ItemPlacement[] = [];
  let row = 0;
  let col = 0;

  for (const item of items) {
    const span = Math.min(item.span ?? 1, columns);
    if (col > 0 && col + span > columns) {
      row += 1;
      col = 0;
    }
    const isRowEnd = col + span >= columns;
    placements.push({ item, row, colStart: col, span, isRowEnd });
    col += span;
    if (col >= columns) {
      row += 1;
      col = 0;
    }
  }

  const rowCount =
    placements.length === 0 ? 0 : placements[placements.length - 1].row + 1;
  return { placements, rowCount };
}

function borderedCellClass(isRowEnd: boolean, isLastRow: boolean) {
  return cn(
    'px-16 py-10',
    'border-b border-border-subtle',
    !isRowEnd && 'border-r',
    isLastRow && 'border-b-0',
  );
}

/** Ant Design 风格描述列表：键值对、边框与响应式列。 */
export const Descriptions: Component<DescriptionsProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'title',
    'extra',
    'column',
    'colon',
    'layout',
    'items',
    'size',
    'bordered',
  ]);
  const column = () => Math.max(1, local.column ?? 3);
  const colon = () => local.colon ?? true;
  const layout = () => local.layout ?? 'horizontal';
  const bordered = () => !!local.bordered;
  const layoutResult = () => layoutDescriptionItems(local.items ?? [], column());

  return (
    <div
      data-slot="descriptions"
      class={cn(descriptionsVariants({ size: local.size, bordered: bordered() }), local.class)}
      {...rest}
    >
      <Show when={local.title || local.extra}>
        <div
          data-slot="descriptions-header"
          class={cn(
            'flex items-center justify-between gap-12',
            bordered() ? 'border-b border-border-subtle px-16 py-12' : 'mb-12',
          )}
        >
          <Show when={local.title}>
            <div class="text-14 font-semibold text-content-primary">{local.title}</div>
          </Show>
          <Show when={local.extra}>
            <div class="shrink-0 text-12 text-content-muted">{local.extra}</div>
          </Show>
        </div>
      </Show>
      <div
        data-slot="descriptions-view"
        class={cn('grid gap-0', bordered() ? '' : 'gap-y-12')}
        style={{
          'grid-template-columns': `repeat(${column()}, auto minmax(0, 1fr))`,
        }}
      >
        <For each={layoutResult().placements}>
          {(placement) => {
            const { item, row, colStart, span, isRowEnd } = placement;
            const isLastRow = row === layoutResult().rowCount - 1;
            const labelCol = colStart * 2 + 1;
            const contentCol = colStart * 2 + 2;
            const contentSpan = span * 2 - 1;
            const cellBorder = () =>
              bordered() ? borderedCellClass(isRowEnd, isLastRow) : 'min-w-0';

            return (
              <Show
                when={layout() === 'vertical'}
                fallback={
                  <>
                    <div
                      data-slot="descriptions-label"
                      class={cn(
                        cellBorder(),
                        'text-content-muted',
                        layout() === 'horizontal' ? 'text-end' : '',
                      )}
                      style={{
                        'grid-column': String(labelCol),
                        'grid-row': String(row + 1),
                      }}
                    >
                      {item.label}
                      <Show when={colon()}>
                        <span aria-hidden="true">:</span>
                      </Show>
                    </div>
                    <div
                      data-slot="descriptions-content"
                      class={cn(cellBorder(), 'min-w-0 text-content-primary')}
                      style={{
                        'grid-column': `${contentCol} / span ${contentSpan}`,
                        'grid-row': String(row + 1),
                      }}
                    >
                      {item.children}
                    </div>
                  </>
                }
              >
                <div
                  data-slot="descriptions-item"
                  class={cn(cellBorder(), 'min-w-0')}
                  style={{
                    'grid-column': `${labelCol} / span ${span * 2}`,
                    'grid-row': String(row + 1),
                  }}
                >
                  <div class="flex flex-col gap-4">
                    <span data-slot="descriptions-label" class="text-content-muted">
                      {item.label}
                      <Show when={colon()}>
                        <span aria-hidden="true">:</span>
                      </Show>
                    </span>
                    <span data-slot="descriptions-content" class="text-content-primary">
                      {item.children}
                    </span>
                  </div>
                </div>
              </Show>
            );
          }}
        </For>
      </div>
    </div>
  );
};

export const DescriptionsItem: Component<DescriptionsItem & ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['label', 'children', 'span', 'class']);
  return (
    <div data-slot="descriptions-item-legacy" class={local.class} {...rest}>
      <span class="text-content-muted">{local.label}</span>
      <span class="text-content-primary">{local.children}</span>
    </div>
  );
};

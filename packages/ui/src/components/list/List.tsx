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
import { Button } from '../Button';
import { Spinner } from '../Spinner';

const listVariants = cva('m-0 flex flex-col p-0', {
  variants: {
    bordered: {
      true: 'rounded-8 border border-border-subtle',
      false: '',
    },
    split: {
      true: 'divide-y divide-border-subtle',
      false: '',
    },
    size: {
      sm: 'text-12',
      md: 'text-13',
      lg: 'text-14',
    },
  },
  defaultVariants: {
    bordered: false,
    split: true,
    size: 'md',
  },
});

type ListVariantProps = VariantProps<typeof listVariants>;

export type ListItemMeta = {
  avatar?: JSX.Element;
  title?: JSX.Element;
  description?: JSX.Element;
};

export type ListItemData = {
  key?: string;
  children?: JSX.Element;
  actions?: JSX.Element[];
  meta?: ListItemMeta;
  extra?: JSX.Element;
};

export type ListProps = ComponentProps<'div'> &
  ListVariantProps & {
    header?: JSX.Element;
    footer?: JSX.Element;
    loadMore?: JSX.Element;
    loading?: boolean;
    dataSource?: ListItemData[];
    renderItem?: (item: ListItemData, index: number) => JSX.Element;
    virtualized?: boolean;
    itemHeight?: number;
    maxHeight?: number;
  };

/** 通用列表：header/footer、loadMore、可选固定行高滚动。 */
export const List: Component<ListProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'header',
    'footer',
    'loadMore',
    'loading',
    'dataSource',
    'renderItem',
    'bordered',
    'split',
    'size',
    'virtualized',
    'itemHeight',
    'maxHeight',
    'children',
  ]);

  const items = () => local.dataSource ?? [];

  return (
    <div data-slot="list" class={cn(listVariants({ bordered: local.bordered, split: local.split, size: local.size }), local.class)} {...rest}>
      <Show when={local.header}>
        <div data-slot="list-header" class="border-b border-border-subtle px-16 py-12 font-medium text-content-primary">
          {local.header}
        </div>
      </Show>
      <div
        data-slot="list-items"
        class={cn(local.virtualized ? 'overflow-auto' : '')}
        style={local.virtualized
          ? { 'max-height': local.maxHeight ? `${local.maxHeight}px` : '320px' }
          : undefined}
      >
        <Show when={local.loading} fallback={(
          <For each={items()}>
            {(item, index) => (
              <Show when={local.renderItem} fallback={<ListItem item={item} />}>
                {local.renderItem?.(item, index())}
              </Show>
            )}
          </For>
        )}>
          <div class="flex items-center justify-center gap-8 px-16 py-24 text-content-muted">
            <Spinner class="size-16 text-accent-solid" />
            <span>Loading…</span>
          </div>
        </Show>
        {local.children}
      </div>
      <Show when={local.loadMore}>
        <div data-slot="list-load-more" class="border-t border-border-subtle px-16 py-12 text-center">
          {local.loadMore}
        </div>
      </Show>
      <Show when={local.footer}>
        <div data-slot="list-footer" class="border-t border-border-subtle px-16 py-12 text-content-muted">
          {local.footer}
        </div>
      </Show>
    </div>
  );
};

type ListItemProps = { item: ListItemData; class?: string };

export const ListItem: Component<ListItemProps> = (props) => {
  const item = () => props.item;
  return (
    <div
      data-slot="list-item"
      class={cn('flex items-start gap-12 px-16 py-12', props.class)}
      style={props.class?.includes('virtual') ? { height: `${56}px` } : undefined}
    >
      <Show when={item().meta?.avatar}>
        <div class="shrink-0">{item().meta?.avatar}</div>
      </Show>
      <div class="min-w-0 flex-1">
        <Show when={item().meta?.title}>
          <div class="font-medium text-content-primary">{item().meta?.title}</div>
        </Show>
        <Show when={item().meta?.description}>
          <div class="text-12 text-content-muted">{item().meta?.description}</div>
        </Show>
        <Show when={item().children}>{item().children}</Show>
      </div>
      <Show when={item().extra}>
        <div class="shrink-0 text-12 text-content-muted">{item().extra}</div>
      </Show>
      <Show when={item().actions?.length}>
        <div class="flex shrink-0 gap-4">
          <For each={item().actions}>{(action) => action}</For>
        </div>
      </Show>
    </div>
  );
};

export const ListLoadMore: Component<{ loading?: boolean; onClick?: () => void; children?: JSX.Element }> = (props) => (
  <Button variant="ghost" size="sm" busy={props.loading} onClick={props.onClick}>
    {props.children ?? 'Load more'}
  </Button>
);

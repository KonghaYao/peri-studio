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

function itemGridClass(span: number, column: number) {
  const pct = Math.min(span, column) / column;
  return pct >= 1 ? 'col-span-full' : '';
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
            <div class="text-12 text-content-muted">{local.extra}</div>
          </Show>
        </div>
      </Show>
      <div
        data-slot="descriptions-view"
        class={cn(
          'grid gap-0',
          bordered() ? '' : 'gap-y-12',
        )}
        style={{ 'grid-template-columns': `repeat(${column()}, minmax(0, 1fr))` }}
      >
        <For each={local.items ?? []}>
          {(item) => (
            <div
              data-slot="descriptions-item"
              class={cn(
                'min-w-0',
                bordered()
                  ? 'border-b border-r border-border-subtle px-16 py-10 last:border-b-0'
                  : '',
                itemGridClass(item.span ?? 1, column()),
              )}
              style={item.span && item.span > 1 ? { 'grid-column': `span ${Math.min(item.span, column())}` } : undefined}
            >
              <div
                class={cn(
                  layout() === 'vertical' ? 'flex flex-col gap-4' : 'flex gap-8',
                )}
              >
                <span
                  data-slot="descriptions-label"
                  class={cn(
                    'shrink-0 text-content-muted',
                    layout() === 'horizontal' ? 'min-w-80' : '',
                  )}
                >
                  {item.label}
                  <Show when={colon() && layout() === 'horizontal'}>
                    <span aria-hidden="true">:</span>
                  </Show>
                </span>
                <span data-slot="descriptions-content" class="min-w-0 text-content-primary">
                  {item.children}
                </span>
              </div>
            </div>
          )}
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

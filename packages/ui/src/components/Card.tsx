import { cva, type VariantProps } from 'class-variance-authority';
import { createSignal, For, Show, splitProps, type Component, type ComponentProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import { Skeleton } from './Skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs';

const cardVariants = cva('rounded-8 border border-border-subtle bg-surface shadow-none', {
  variants: {
    size: {
      sm: 'text-12',
      md: 'text-13',
    },
    hoverable: {
      true: 'cursor-pointer transition-shadow duration-120 hover:shadow-popover',
      false: '',
    },
    loading: {
      true: 'pointer-events-none',
      false: '',
    },
  },
  defaultVariants: {
    size: 'md',
    hoverable: false,
    loading: false,
  },
});

type CardVariantProps = VariantProps<typeof cardVariants>;

export type CardTab = {
  key: string;
  tab: JSX.Element;
  content: JSX.Element;
};

type CardProps = ComponentProps<'div'> &
  CardVariantProps & {
    cover?: JSX.Element;
    tabList?: CardTab[];
    activeTabKey?: string;
    onTabChange?: (key: string) => void;
  };

export const Card: Component<CardProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'size',
    'hoverable',
    'loading',
    'cover',
    'tabList',
    'activeTabKey',
    'onTabChange',
    'children',
  ]);
  const [tab, setTab] = createSignal(local.activeTabKey ?? local.tabList?.[0]?.key ?? '');
  const currentTab = () => local.activeTabKey ?? tab();

  const onTab = (key: string) => {
    setTab(key);
    local.onTabChange?.(key);
  };

  return (
    <div
      data-slot="card"
      class={cn(cardVariants({ size: local.size, hoverable: local.hoverable, loading: local.loading }), local.class)}
      {...rest}
    >
      <Show when={local.cover}>
        <div data-slot="card-cover" class="overflow-hidden rounded-t-8 border-b border-border-subtle">
          {local.cover}
        </div>
      </Show>
      <Show when={local.loading}>
        <div class="flex flex-col gap-8 p-16">
          <Skeleton class="h-12 w-120" />
          <Skeleton class="h-12 w-full" />
          <Skeleton class="h-12 w-240" />
        </div>
      </Show>
      <Show when={!local.loading && local.tabList?.length}>
        <Tabs value={currentTab()} onChange={onTab}>
          <TabsList class="px-16">
            <For each={local.tabList}>
              {(item) => <TabsTrigger value={item.key}>{item.tab}</TabsTrigger>}
            </For>
          </TabsList>
          <For each={local.tabList}>
            {(item) => (
              <TabsContent value={item.key} class="px-16 pb-16">
                {item.content}
              </TabsContent>
            )}
          </For>
        </Tabs>
      </Show>
      <Show when={!local.loading && !local.tabList?.length}>{local.children}</Show>
    </div>
  );
};

export const CardHeader: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="card-header"
      class={cn('flex flex-col gap-4 px-16 py-12', local.class)}
      {...rest}
    />
  );
};

export const CardTitle: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="card-title"
      class={cn('text-14 font-semibold text-text-primary', local.class)}
      {...rest}
    />
  );
};

export const CardDescription: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="card-description"
      class={cn('text-12 text-content-muted', local.class)}
      {...rest}
    />
  );
};

export const CardContent: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="card-content"
      class={cn('px-16 py-12', local.class)}
      {...rest}
    />
  );
};

export const CardFooter: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="card-footer"
      class={cn('flex items-center px-16 py-12', local.class)}
      {...rest}
    />
  );
};

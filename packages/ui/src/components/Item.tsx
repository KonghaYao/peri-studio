import type { Component, ComponentProps } from 'solid-js';
import { splitProps } from 'solid-js';
import { cn } from '../lib/cn';
import { Separator } from './Separator';

/** 列表项分组容器。 */
export const ItemGroup: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      role="list"
      data-slot="item-group"
      class={cn('flex flex-col', local.class)}
      {...rest}
    />
  );
};

/** 列表项行：媒体 + 内容 + 操作的水平布局。 */
export const Item: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      role="listitem"
      data-slot="item"
      class={cn(
        'flex min-w-0 items-center gap-12 rounded-8 px-12 py-10 hover:bg-interaction-hover',
        local.class,
      )}
      {...rest}
    />
  );
};

/** 列表项分隔线。 */
export const ItemSeparator: Component<ComponentProps<typeof Separator>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <Separator
      data-slot="item-separator"
      orientation="horizontal"
      class={cn('my-0', local.class)}
      {...rest}
    />
  );
};

/** 列表项媒体槽位（图标、头像等）。 */
export const ItemMedia: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="item-media"
      class={cn('flex shrink-0 items-center justify-center', local.class)}
      {...rest}
    />
  );
};

/** 列表项主内容区：标题与描述纵向排列。 */
export const ItemContent: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="item-content"
      class={cn('flex min-w-0 flex-1 flex-col gap-4', local.class)}
      {...rest}
    />
  );
};

/** 列表项标题。 */
export const ItemTitle: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="item-title"
      class={cn('text-13 font-medium text-content-primary', local.class)}
      {...rest}
    />
  );
};

/** 列表项描述。 */
export const ItemDescription: Component<ComponentProps<'p'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <p
      data-slot="item-description"
      class={cn('text-12 text-content-secondary', local.class)}
      {...rest}
    />
  );
};

/** 列表项尾部操作区。 */
export const ItemActions: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="item-actions"
      class={cn('ml-auto flex shrink-0 items-center gap-8', local.class)}
      {...rest}
    />
  );
};

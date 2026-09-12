import type { Component, ComponentProps } from 'solid-js';
import { splitProps } from 'solid-js';
import { ChevronRight, MoreHorizontal } from 'lucide-solid';
import { cn } from '../lib/cn';

/** 面包屑根容器：语义化 nav，默认 aria-label="breadcrumb"。 */
export const Breadcrumb: Component<ComponentProps<'nav'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'aria-label']);
  return (
    <nav
      aria-label={local['aria-label'] ?? 'breadcrumb'}
      class={cn(local.class)}
      {...rest}
    />
  );
};

/** 面包屑列表：ol 结构，muted 12px 文案。 */
export const BreadcrumbList: Component<ComponentProps<'ol'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <ol
      data-slot="breadcrumb-list"
      class={cn('flex flex-wrap items-center gap-8 text-12 text-content-muted', local.class)}
      {...rest}
    />
  );
};

/** 面包屑项：li 行内 flex。 */
export const BreadcrumbItem: Component<ComponentProps<'li'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <li
      data-slot="breadcrumb-item"
      class={cn('inline-flex items-center gap-6', local.class)}
      {...rest}
    />
  );
};

/** 面包屑链接：hover 时提升为 primary 色。 */
export const BreadcrumbLink: Component<ComponentProps<'a'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <a
      data-slot="breadcrumb-link"
      class={cn('transition-colors hover:text-content-primary', local.class)}
      {...rest}
    />
  );
};

/** 当前页：不可点击，aria-current="page"。 */
export const BreadcrumbPage: Component<ComponentProps<'span'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <span
      role="link"
      aria-disabled="true"
      aria-current="page"
      data-slot="breadcrumb-page"
      class={cn('font-medium text-content-primary', local.class)}
      {...rest}
    />
  );
};

/** 分隔符：ChevronRight，presentation 语义。 */
export const BreadcrumbSeparator: Component<ComponentProps<'li'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <li
      role="presentation"
      aria-hidden="true"
      data-slot="breadcrumb-separator"
      class={cn('inline-flex items-center', local.class)}
      {...rest}
    >
      {local.children ?? (
        <ChevronRight size={12} strokeWidth={1.7} class="shrink-0 text-content-muted" aria-hidden="true" />
      )}
    </li>
  );
};

/** 折叠省略：MoreHorizontal + sr-only "More"。 */
export const BreadcrumbEllipsis: Component<ComponentProps<'span'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <span
      role="presentation"
      aria-hidden="true"
      data-slot="breadcrumb-ellipsis"
      class={cn('flex size-24 items-center justify-center', local.class)}
      {...rest}
    >
      <MoreHorizontal size={16} strokeWidth={1.7} class="text-content-muted" aria-hidden="true" />
      <span class="sr-only">More</span>
    </span>
  );
};

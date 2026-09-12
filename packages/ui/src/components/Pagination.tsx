import { cva, type VariantProps } from 'class-variance-authority';
import type { Component, ComponentProps, JSX } from 'solid-js';
import { splitProps } from 'solid-js';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-solid';
import { cn } from '../lib/cn';

const paginationLinkVariants = cva(
  'inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-6 font-medium transition-colors outline-none duration-120 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45',
  {
    variants: {
      variant: {
        ghost:
          'border border-transparent bg-transparent text-content-secondary hover:bg-interaction-hover hover:text-content-primary',
        outline:
          'border border-border-strong bg-surface-overlay text-content-primary hover:border-accent-solid hover:text-accent-solid active:border-accent-active active:text-accent-active',
      },
      size: {
        sm: 'h-24 min-w-24 px-8 text-12',
        md: 'h-32 min-w-32 px-10 text-13',
        icon: 'size-32',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'icon' },
  },
);

type PaginationLinkVariantProps = VariantProps<typeof paginationLinkVariants>;

/** 分页根容器：语义化 nav。 */
export const Pagination: Component<ComponentProps<'nav'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'aria-label']);
  return (
    <nav
      role="navigation"
      aria-label={local['aria-label'] ?? 'pagination'}
      data-slot="pagination"
      class={cn('mx-auto flex w-full justify-center', local.class)}
      {...rest}
    />
  );
};

/** 分页内容列表：ul 行内 flex。 */
export const PaginationContent: Component<ComponentProps<'ul'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <ul
      data-slot="pagination-content"
      class={cn('flex flex-row items-center gap-4', local.class)}
      {...rest}
    />
  );
};

/** 分页项：li 包裹链接或按钮。 */
export const PaginationItem: Component<ComponentProps<'li'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return <li data-slot="pagination-item" class={cn('', local.class)} {...rest} />;
};

type PaginationLinkProps = ComponentProps<'a'> &
  PaginationLinkVariantProps & {
    isActive?: boolean;
  };

/** 分页页码链接：isActive 时 aria-current="page" 且 outline 样式。 */
export const PaginationLink: Component<PaginationLinkProps> = (props) => {
  const [local, variants, rest] = splitProps(
    props,
    ['class', 'isActive'],
    ['variant', 'size'],
  );
  const active = () => !!local.isActive;
  return (
    <a
      aria-current={active() ? 'page' : undefined}
      data-slot="pagination-link"
      data-active={active() ? '' : undefined}
      class={cn(
        paginationLinkVariants({
          variant: active() ? 'outline' : (variants.variant ?? 'ghost'),
          size: variants.size ?? 'icon',
        }),
        local.class,
      )}
      {...rest}
    />
  );
};

type PaginationNavLinkProps = Omit<PaginationLinkProps, 'size' | 'children'> & {
  children?: JSX.Element;
};

/** 上一页：ChevronLeft + 文案。 */
export const PaginationPrevious: Component<PaginationNavLinkProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <PaginationLink
      aria-label="Go to previous page"
      size="md"
      class={cn('gap-6 pl-8', local.class)}
      {...rest}
    >
      <ChevronLeft size={16} strokeWidth={1.7} class="shrink-0" aria-hidden="true" />
      <span>{local.children ?? 'Previous'}</span>
    </PaginationLink>
  );
};

/** 下一页：ChevronRight + 文案。 */
export const PaginationNext: Component<PaginationNavLinkProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <PaginationLink
      aria-label="Go to next page"
      size="md"
      class={cn('gap-6 pr-8', local.class)}
      {...rest}
    >
      <span>{local.children ?? 'Next'}</span>
      <ChevronRight size={16} strokeWidth={1.7} class="shrink-0" aria-hidden="true" />
    </PaginationLink>
  );
};

/** 分页省略：MoreHorizontal + sr-only "More pages"。 */
export const PaginationEllipsis: Component<ComponentProps<'span'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <span
      aria-hidden="true"
      data-slot="pagination-ellipsis"
      class={cn('flex size-32 items-center justify-center', local.class)}
      {...rest}
    >
      <MoreHorizontal size={16} strokeWidth={1.7} class="text-content-muted" aria-hidden="true" />
      <span class="sr-only">More pages</span>
    </span>
  );
};

import { cva, type VariantProps } from 'class-variance-authority';
import type { Component, ComponentProps, JSX } from 'solid-js';
import { createSignal, For, Show, splitProps } from 'solid-js';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-solid';
import { cn } from '../lib/cn';
import { NativeSelect, NativeSelectOption } from './NativeSelect';

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
        sm: 'h-28 min-w-28 px-8 text-12',
        md: 'h-36 min-w-36 px-10 text-13',
        icon: 'size-36',
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
      class={cn('flex size-36 items-center justify-center', local.class)}
      {...rest}
    >
      <MoreHorizontal size={16} strokeWidth={1.7} class="text-content-muted" aria-hidden="true" />
      <span class="sr-only">More pages</span>
    </span>
  );
};

export type PaginationControlsProps = {
  class?: string;
  current?: number;
  pageSize?: number;
  total?: number;
  simple?: boolean;
  showSizeChanger?: boolean;
  showQuickJumper?: boolean;
  pageSizeOptions?: number[];
  showTotal?: boolean | ((total: number, range: [number, number]) => JSX.Element);
  onChange?: (page: number, pageSize: number) => void;
};

function pageNumbers(current: number, totalPages: number) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages = new Set<number>([1, totalPages, current, current - 1, current + 1]);
  return Array.from(pages).filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
}

/** Ant Design 风格分页控制器：simple / size changer / quick jumper / total。 */
export const PaginationControls: Component<PaginationControlsProps> = (props) => {
  const [local] = splitProps(props, [
    'class',
    'current',
    'pageSize',
    'total',
    'simple',
    'showSizeChanger',
    'showQuickJumper',
    'pageSizeOptions',
    'showTotal',
    'onChange',
  ]);
  const [jumpValue, setJumpValue] = createSignal('');
  const current = () => Math.max(1, local.current ?? 1);
  const pageSize = () => Math.max(1, local.pageSize ?? 10);
  const total = () => Math.max(0, local.total ?? 0);
  const totalPages = () => Math.max(1, Math.ceil(total() / pageSize()));
  const range = (): [number, number] => {
    const start = total() === 0 ? 0 : (current() - 1) * pageSize() + 1;
    const end = Math.min(total(), current() * pageSize());
    return [start, end];
  };

  const go = (page: number, size = pageSize()) => {
    const next = Math.min(totalPages(), Math.max(1, page));
    local.onChange?.(next, size);
  };

  const totalLabel = () => {
    if (!local.showTotal) return null;
    if (typeof local.showTotal === 'function') return local.showTotal(total(), range());
    return `Total ${total()} items`;
  };

  return (
    <div data-slot="pagination-controls" class={cn('flex flex-wrap items-center gap-12', local.class)}>
      <Show when={totalLabel()}>
        <span class="text-12 text-content-muted">{totalLabel()}</span>
      </Show>
      <Show
        when={!local.simple}
        fallback={(
          <div class="inline-flex items-center gap-8 text-13">
            <button type="button" class="rounded-6 px-8 py-4 hover:bg-interaction-hover" onClick={() => go(current() - 1)} disabled={current() <= 1}>
              ‹
            </button>
            <span>{current()} / {totalPages()}</span>
            <button type="button" class="rounded-6 px-8 py-4 hover:bg-interaction-hover" onClick={() => go(current() + 1)} disabled={current() >= totalPages()}>
              ›
            </button>
          </div>
        )}
      >
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious href="#" onClick={(event) => { event.preventDefault(); go(current() - 1); }} />
            </PaginationItem>
            <For each={pageNumbers(current(), totalPages())}>
              {(page, index) => {
                const pages = pageNumbers(current(), totalPages());
                const prevPage = () => pages[index() - 1];
                return (
                  <>
                    <Show when={index() > 0 && page - prevPage() > 1}>
                      <PaginationItem><PaginationEllipsis /></PaginationItem>
                    </Show>
                    <PaginationItem>
                      <PaginationLink
                        href="#"
                        isActive={page === current()}
                        onClick={(event) => { event.preventDefault(); go(page); }}
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                  </>
                );
              }}
            </For>
            <PaginationItem>
              <PaginationNext href="#" onClick={(event) => { event.preventDefault(); go(current() + 1); }} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </Show>
      <Show when={local.showSizeChanger}>
        <NativeSelect
          aria-label="Page size"
          value={String(pageSize())}
          onChange={(event) => go(1, Number(event.currentTarget.value))}
        >
          <For each={local.pageSizeOptions ?? [10, 20, 50, 100]}>
            {(size) => <NativeSelectOption value={String(size)}>{size} / page</NativeSelectOption>}
          </For>
        </NativeSelect>
      </Show>
      <Show when={local.showQuickJumper}>
        <div class="flex items-center gap-6 text-12 text-content-muted">
          <span>Go to</span>
          <input
            class="h-32 w-56 rounded-6 border border-border-strong bg-surface px-8 text-13"
            value={jumpValue()}
            onInput={(event) => setJumpValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                const page = Number(jumpValue());
                if (!Number.isNaN(page)) go(page);
              }
            }}
          />
        </div>
      </Show>
    </div>
  );
};

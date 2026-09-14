import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';

export type PageHeaderShellProps = {
  title: string;
  description?: string;
  actions?: JSX.Element;
  class?: string;
  'data-testid'?: string;
};

/** T3 · 页面级标题条：sticky 顶栏 + 标题 / 副标题 / actions 槽。 */
export const PageHeaderShell: Component<PageHeaderShellProps> = (props) => {
  const [local, rest] = splitProps(props, ['title', 'description', 'actions', 'class']);

  return (
    <header
      {...rest}
      class={cn(
        'ui-page-header sticky top-0 z-10 flex h-60 shrink-0 items-center justify-between gap-16 border-b border-border-subtle bg-surface/95 px-24 backdrop-blur supports-backdrop-filter:bg-surface/80',
        local.class,
      )}
    >
      <div class="flex min-w-0 items-baseline gap-12">
        <h1 class="shrink-0 text-16 font-600 tracking-tight text-content-primary">
          {local.title}
        </h1>
        <Show when={local.description}>
          <p class="truncate text-12 text-content-muted">{local.description}</p>
        </Show>
      </div>
      <Show when={local.actions}>
        <div class="flex shrink-0 items-center gap-8">{local.actions}</div>
      </Show>
    </header>
  );
};

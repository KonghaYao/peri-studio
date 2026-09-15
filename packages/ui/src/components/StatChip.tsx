import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../lib/cn';

export type StatChipProps = {
  icon?: JSX.Element;
  label: string;
  value: string;
  class?: string;
  'data-testid'?: string;
};

/** T2 · 指标 chip：图标 + 标签 + 数值，供详情面板与 dashboard 复用。 */
export const StatChip: Component<StatChipProps> = (props) => {
  const [local, rest] = splitProps(props, ['icon', 'label', 'value', 'class']);

  return (
    <div
      {...rest}
      class={cn(
        'flex min-w-0 shrink-0 items-center gap-8 rounded-6 border border-border-subtle bg-surface-sunken px-12 py-8',
        local.class,
      )}
    >
      <Show when={local.icon}>
        <div class="shrink-0 text-content-muted" aria-hidden="true">
          {local.icon}
        </div>
      </Show>
      <div class="min-w-0 leading-tight">
        <div class="whitespace-nowrap text-10 font-600 uppercase tracking-wide text-content-muted">
          {local.label}
        </div>
        <div class="text-12 font-600 tabular-nums text-content-primary">{local.value}</div>
      </div>
    </div>
  );
};

import { Show, splitProps, type JSX } from 'solid-js';
import { cn } from '@/lib/cn';
import { Tooltip } from './Tooltip';

/* 图标按钮：圆角矩形（禁止圆形），默认 ghost；label 即 a11y 名称。 */
export function IconButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  tooltip?: string;
  showTooltip?: boolean;
  size?: 'sm' | 'md';
}) {
  const [local, rest] = splitProps(props, ['class', 'label', 'tooltip', 'showTooltip', 'size', 'children']);
  const tooltipEnabled = () => local.showTooltip !== false;
  const button = (
    <button
      type="button"
      aria-label={local.label}
      title={tooltipEnabled() ? (local.tooltip ? undefined : local.label) : undefined}
      class={cn(
        'inline-flex cursor-pointer items-center justify-center rounded-md text-content-secondary transition-colors duration-(--duration-fast)',
        'hover:bg-interaction-hover hover:text-content-primary',
        'focus-visible:shadow-(--shadow-focus-ring) focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-45',
        local.size === 'sm' ? 'size-(--control-height-sm)' : 'size-(--control-height-md)',
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </button>
  );
  return (
    <Show when={tooltipEnabled() && local.tooltip} fallback={button}>
      <Tooltip content={local.tooltip!}>{button}</Tooltip>
    </Show>
  );
}

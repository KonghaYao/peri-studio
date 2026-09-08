import { cva, type VariantProps } from 'class-variance-authority';
import { Show, splitProps, type JSX } from 'solid-js';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';
import { Tooltip } from './Tooltip';

const iconButtonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md font-medium transition-colors outline-none duration-(--duration-fast) focus-visible:shadow-(--shadow-focus-ring) focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45',
  {
    variants: {
      variant: {
        primary:
          'border border-transparent bg-accent-solid text-content-on-accent hover:bg-accent-hover active:bg-accent-active',
        default:
          'border border-border-strong bg-surface-overlay text-content-primary hover:border-accent-solid hover:text-accent-solid active:border-accent-active active:text-accent-active',
        ghost:
          'border border-transparent bg-transparent text-content-secondary hover:bg-interaction-hover hover:text-content-primary',
        danger:
          'border border-danger-border bg-surface-overlay text-danger-solid hover:border-danger-solid hover:text-danger-strong active:border-danger-strong',
      },
      size: {
        sm: 'size-(--control-height-sm)',
        md: 'size-(--control-height-md)',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
);

type IconButtonVariantProps = VariantProps<typeof iconButtonVariants>;

/* 图标按钮：圆角矩形（禁止圆形），默认 ghost；label 即 a11y 名称。 */
export function IconButton(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> &
    IconButtonVariantProps & {
      label: string;
      /** @deprecated Prefer `title` for parity with web production API */
      tooltip?: string;
      title?: string;
      showTooltip?: boolean;
      busy?: boolean;
    },
) {
  const [local, rest] = splitProps(props, [
    'class',
    'label',
    'tooltip',
    'title',
    'showTooltip',
    'size',
    'variant',
    'busy',
    'children',
    'disabled',
  ]);
  const tooltipText = () => local.title ?? local.tooltip;
  const tooltipEnabled = () => local.showTooltip !== false && !!tooltipText();
  const button = (
    <button
      type="button"
      aria-label={local.label}
      title={tooltipEnabled() ? undefined : local.label}
      disabled={local.disabled || local.busy}
      aria-busy={local.busy || undefined}
      class={cn(iconButtonVariants({ variant: local.variant, size: local.size }), local.class)}
      {...rest}
    >
      <Show when={local.busy}>
        <Spinner class="size-3" />
      </Show>
      <Show when={!local.busy}>{local.children}</Show>
    </button>
  );
  return (
    <Show when={tooltipEnabled()} fallback={button}>
      <Tooltip content={tooltipText()!}>{button}</Tooltip>
    </Show>
  );
}

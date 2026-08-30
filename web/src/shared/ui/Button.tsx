import { cva, type VariantProps } from 'class-variance-authority';
import { createUniqueId, Show, splitProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import { Spinner } from './Spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from './Tooltip';

/* AntD 方向：primary 实底白字（hover 浅档）；default 白底灰边，
   hover 时边框与文字同时染主色；danger 红字红边。尺寸对齐 sandbox T2（24/32/40）。 */
const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-6 whitespace-nowrap rounded-6 font-medium transition-colors outline-none duration-120 focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-44',
  {
    variants: {
      variant: {
        primary:
          'border border-transparent bg-accent-solid [color:var(--content-on-accent)]! hover:bg-accent-hover active:bg-accent-active',
        default:
          'border border-border-strong bg-surface-overlay text-content-primary hover:border-accent-solid hover:text-accent-solid active:border-accent-active active:text-accent-active',
        secondary:
          'border border-border-strong bg-surface-overlay text-content-primary hover:border-accent-solid hover:text-accent-solid active:border-accent-active active:text-accent-active',
        ghost:
          'border border-transparent bg-transparent text-content-secondary hover:bg-interaction-hover hover:text-content-primary',
        danger:
          'border border-danger-border bg-surface text-danger hover:border-danger hover:text-danger active:border-danger',
      },
      size: {
        sm: 'h-24 px-10 text-12',
        md: 'h-32 px-16 text-13',
        lg: 'h-40 px-20 text-14',
        compact: 'h-24 px-10 text-12',
        default: 'h-32 px-16 text-13',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
);

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

type Props = JSX.ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonVariantProps & {
    busy?: boolean;
  };

function resolveButtonVariant(variant: ButtonVariantProps['variant']) {
  return variant === 'secondary' ? 'default' : variant;
}

function resolveButtonSize(size: ButtonVariantProps['size']) {
  if (size === 'compact') return 'sm';
  if (size === 'default') return 'md';
  return size;
}

export function Button(props: Props) {
  const [local, variants, rest] = splitProps(
    props,
    ['class', 'children', 'busy', 'disabled'],
    ['variant', 'size'],
  );
  return (
    <button
      type={rest.type ?? 'button'}
      class={cn(
        buttonVariants({
          variant: resolveButtonVariant(variants.variant),
          size: resolveButtonSize(variants.size),
        }),
        local.class,
      )}
      disabled={local.disabled || local.busy}
      aria-busy={local.busy || undefined}
      data-slot="button"
      {...rest}
    >
      <Show when={local.busy}>
        <Spinner class="size-12" decorative />
        <span class="sr-only">Processing</span>
      </Show>
      {local.children}
    </button>
  );
}

const iconButtonSizeClasses = {
  sm: 'size-24',
  md: 'size-32',
  compact: 'size-24',
  default: 'size-32',
} as const;

/* 图标按钮：圆角矩形（禁止圆形），默认 ghost；label 即 a11y 名称。 */
export function IconButton(
  props: Props & {
    label: string;
    title?: string;
    showTooltip?: boolean;
    tooltipPlacement?: 'start' | 'center' | 'end';
  },
) {
  const [local, button] = splitProps(props, [
    'label',
    'title',
    'class',
    'showTooltip',
    'tooltipPlacement',
    'size',
    'variant',
    'busy',
    'children',
  ]);
  const helpId = `icon-help-${createUniqueId()}`;
  const customHelp = () => !!local.title && local.title !== local.label;
  const tooltipEnabled = () => local.showTooltip !== false;
  const sizeKey = () => local.size ?? 'md';
  const iconButton = (
    <button
      {...button}
      type={button.type ?? 'button'}
      aria-label={local.label}
      aria-description={customHelp() ? local.title : undefined}
      aria-describedby={customHelp() ? helpId : undefined}
      disabled={button.disabled || local.busy}
      aria-busy={local.busy || undefined}
      data-slot="button"
      data-icon-button=""
      class={cn(
        'inline-flex cursor-pointer items-center justify-center rounded-6 text-text-secondary transition-colors duration-120',
        'hover:bg-hover hover:text-text-primary',
        'focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-45',
        iconButtonSizeClasses[sizeKey() as keyof typeof iconButtonSizeClasses] ?? iconButtonSizeClasses.md,
        'pointer-coarse:min-h-44 pointer-coarse:min-w-44',
        local.class,
      )}
    >
      <Show when={local.busy}>
        <Spinner class="size-12" decorative />
      </Show>
      {local.children}
    </button>
  );

  return (
    <Show when={tooltipEnabled()} fallback={iconButton}>
      <Tooltip placement={
          local.tooltipPlacement === 'start'
            ? 'bottom-start'
            : local.tooltipPlacement === 'end'
              ? 'bottom-end'
              : 'bottom'
        }
      >
        <TooltipTrigger as="span" class="ui-tooltip-anchor">
          {iconButton}
        </TooltipTrigger>
        <TooltipContent id={customHelp() ? helpId : undefined}>
          {local.title ?? local.label}
        </TooltipContent>
      </Tooltip>
    </Show>
  );
}

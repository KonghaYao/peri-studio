import { cva, type VariantProps } from 'class-variance-authority';
import { createUniqueId, Show, splitProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import { Spinner } from './Spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from './Tooltip';

/* primary 实底白字（hover 浅档）；default 白底灰边，
   hover 时边框与文字同时染主色；danger 红字红边。尺寸对齐 sandbox T2（28/36/44）。 */
const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-6 whitespace-nowrap rounded-6 font-medium transition-colors outline-none duration-120 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-44',
  {
    variants: {
      variant: {
        primary:
          'border border-transparent bg-accent-solid [color:var(--content-on-accent)]! hover:bg-accent-hover active:bg-accent-active',
        default:
          'border border-border-strong bg-surface-overlay text-content-primary hover:border-accent-solid hover:text-accent-solid active:border-accent-active active:text-accent-active',
        secondary:
          'border border-border-strong bg-surface-overlay text-content-primary hover:border-accent-solid hover:text-accent-solid active:border-accent-active active:text-accent-active',
        dashed:
          'border border-dashed border-border-strong bg-surface-overlay text-content-primary hover:border-accent-solid hover:text-accent-solid active:border-accent-active active:text-accent-active',
        text:
          'border border-transparent bg-transparent text-content-primary hover:bg-interaction-hover',
        link:
          'border border-transparent bg-transparent p-0 text-accent underline-offset-4 hover:text-accent-hover hover:underline',
        ghost:
          'border border-transparent bg-transparent text-content-secondary hover:bg-interaction-hover hover:text-content-primary',
        danger:
          'border border-danger-border bg-surface text-danger hover:border-danger hover:text-danger active:border-danger',
      },
      size: {
        sm: 'h-28 px-10 text-12',
        md: 'h-36 px-16 text-13',
        lg: 'h-44 px-20 text-14',
        compact: 'h-28 px-10 text-12',
        default: 'h-36 px-16 text-13',
      },
      shape: {
        default: 'rounded-6',
        round: 'rounded-full',
        circle: 'rounded-full aspect-square p-0',
      },
      block: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md', shape: 'default', block: false },
  },
);

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

type Props = JSX.ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonVariantProps & {
    busy?: boolean;
    leadingIcon?: JSX.Element;
    trailingIcon?: JSX.Element;
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
    ['class', 'children', 'busy', 'disabled', 'leadingIcon', 'trailingIcon'],
    ['variant', 'size', 'shape', 'block'],
  );
  const shape = () => variants.shape ?? (local.leadingIcon && !local.children && !local.trailingIcon ? 'circle' : 'default');
  return (
    <button
      type={rest.type ?? 'button'}
      class={cn(
        buttonVariants({
          variant: resolveButtonVariant(variants.variant),
          size: resolveButtonSize(variants.size),
          shape: shape(),
          block: variants.block ?? false,
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
      <Show when={!local.busy && local.leadingIcon}>{local.leadingIcon}</Show>
      {local.children}
      <Show when={!local.busy && local.trailingIcon}>{local.trailingIcon}</Show>
    </button>
  );
}

type LinkButtonProps = JSX.AnchorHTMLAttributes<HTMLAnchorElement> & ButtonVariantProps;

/** Anchor styled as a button (external links, downloads). */
export function LinkButton(props: LinkButtonProps) {
  const [local, variants, rest] = splitProps(props, ['class', 'children'], ['variant', 'size']);
  return (
    <a
      class={cn(
        buttonVariants({
          variant: resolveButtonVariant(variants.variant ?? 'primary'),
          size: resolveButtonSize(variants.size),
        }),
        'no-underline',
        local.class,
      )}
      data-slot="link-button"
      {...rest}
    >
      {local.children}
    </a>
  );
}

const iconButtonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-6 font-medium transition-colors outline-none duration-120 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-44 pointer-coarse:min-w-44',
  {
    variants: {
      variant: {
        primary:
          'border border-transparent bg-accent-solid [color:var(--content-on-accent)]! hover:bg-accent-hover active:bg-accent-active',
        default:
          'border border-border-strong bg-surface-overlay text-content-primary hover:border-accent-solid hover:text-accent-solid active:border-accent-active active:text-accent-active',
        ghost:
          'border border-transparent bg-transparent text-content-secondary hover:bg-interaction-hover hover:text-content-primary',
        danger:
          'border border-danger-border bg-surface text-danger hover:border-danger hover:text-danger active:border-danger',
        stop:
          'border-0 bg-btn-primary text-surface hover:bg-btn-primary-hover disabled:bg-border-subtle disabled:text-text-faint',
      },
      size: {
        sm: 'size-28',
        md: 'size-36',
        lg: 'size-44',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
);

type IconButtonVariantProps = VariantProps<typeof iconButtonVariants>;

function resolveIconButtonVariant(
  variant: IconButtonVariantProps['variant'] | ButtonVariantProps['variant'] | 'stop' | undefined,
) {
  if (variant === 'stop') return 'stop';
  if (variant === 'dashed' || variant === 'text' || variant === 'link') return 'ghost';
  const resolved = resolveButtonVariant(variant as ButtonVariantProps['variant']);
  return resolved ?? 'ghost';
}

function resolveIconButtonSize(size: ButtonVariantProps['size']): IconButtonVariantProps['size'] {
  if (size === 'compact' || size === 'sm') return 'sm';
  if (size === 'default') return 'md';
  if (size === 'lg') return 'lg';
  return size ?? 'md';
}

/* 图标按钮：圆角矩形（禁止圆形），默认 ghost；label 即 a11y 名称。 */
export function IconButton(
  props: Omit<Props, 'variant'> & {
    variant?: IconButtonVariantProps['variant'] | 'dashed' | 'text' | 'link';
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
        iconButtonVariants({
          variant: resolveIconButtonVariant(local.variant) as IconButtonVariantProps['variant'],
          size: resolveIconButtonSize(local.size),
        }),
        local.class,
      )}
    >
      <Show when={local.busy}>
        <Spinner class="size-12" decorative />
        <span class="sr-only">Processing</span>
      </Show>
      <Show when={!local.busy}>{local.children}</Show>
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

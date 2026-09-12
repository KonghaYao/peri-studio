import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';

/** 输入控件尺寸与视觉变体，供 Input / InputNumber / Select 触发器复用。 */
export const inputShellVariants = cva(
  'box-border flex w-full items-center gap-8 ui-control-transition',
  {
    variants: {
      size: {
        sm: 'h-28 text-12',
        md: 'h-36 text-13',
        lg: 'h-44 text-14',
      },
      variant: {
        outlined: 'rounded-6 border bg-surface',
        filled: 'rounded-6 border border-transparent bg-surface-muted',
        borderless: 'rounded-6 border border-transparent bg-transparent',
      },
      status: {
        default: '',
        error: '',
        warning: '',
      },
    },
    compoundVariants: [
      {
        variant: 'outlined',
        status: 'default',
        class: 'border-border-strong hover:border-accent-border-hover focus-within:border-focus-ring',
      },
      {
        variant: 'outlined',
        status: 'error',
        class: 'border-danger focus-within:border-danger',
      },
      {
        variant: 'outlined',
        status: 'warning',
        class: 'border-warning focus-within:border-warning',
      },
      {
        variant: 'filled',
        status: 'default',
        class: 'hover:bg-surface-sunken focus-within:border-focus-ring',
      },
      {
        variant: 'filled',
        status: 'error',
        class: 'border-danger focus-within:border-danger',
      },
      {
        variant: 'filled',
        status: 'warning',
        class: 'border-warning focus-within:border-warning',
      },
      {
        variant: 'borderless',
        status: 'default',
        class: 'focus-within:border-focus-ring',
      },
      {
        variant: 'borderless',
        status: 'error',
        class: 'focus-within:border-danger',
      },
      {
        variant: 'borderless',
        status: 'warning',
        class: 'focus-within:border-warning',
      },
    ],
    defaultVariants: {
      size: 'md',
      variant: 'outlined',
      status: 'default',
    },
  },
);

export const inputFieldVariants = cva(
  'min-w-0 flex-1 border-0 bg-transparent outline-none placeholder:text-text-faint disabled:cursor-not-allowed disabled:text-text-muted',
  {
    variants: {
      size: {
        sm: 'text-12',
        md: 'text-13',
        lg: 'text-14',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export type InputShellVariantProps = VariantProps<typeof inputShellVariants>;

export function inputShellPadding(size: InputShellVariantProps['size']) {
  switch (size) {
    case 'sm':
      return 'px-10';
    case 'lg':
      return 'px-14';
    default:
      return 'px-12';
  }
}

export function resolveInputStatus(invalid?: boolean, status?: 'error' | 'warning' | 'default') {
  if (status === 'error' || invalid) return 'error';
  if (status === 'warning') return 'warning';
  return 'default';
}

export function inputShellClass(
  props: InputShellVariantProps & { class?: string; invalid?: boolean },
) {
  const status = resolveInputStatus(props.invalid, props.status ?? 'default');
  return cn(
    inputShellVariants({ size: props.size, variant: props.variant, status }),
    inputShellPadding(props.size),
    'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-muted disabled:opacity-45',
    props.class,
  );
}

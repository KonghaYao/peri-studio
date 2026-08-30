import { cva, type VariantProps } from 'class-variance-authority';
import { Show, splitProps, type JSX } from 'solid-js';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

/* AntD 方向：primary 实底白字（hover 浅档）；default 白底灰边，
   hover 时边框与文字同时染主色（AntD 签名行为）；danger 红字红边。 */
const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors outline-none duration-(--duration-fast) focus-visible:shadow-(--shadow-focus-ring) disabled:cursor-not-allowed disabled:opacity-45',
  {
    variants: {
      variant: {
        primary:
          'bg-accent-solid text-content-on-accent hover:bg-accent-hover active:bg-accent-active',
        default:
          'border border-border-strong bg-surface-overlay text-content-primary hover:border-accent-solid hover:text-accent-solid active:border-accent-active active:text-accent-active',
        ghost:
          'text-content-secondary hover:bg-interaction-hover hover:text-content-primary',
        danger:
          'border border-danger-border bg-surface-overlay text-danger-solid hover:border-danger-solid hover:text-danger-strong active:border-danger-strong',
      },
      size: {
        sm: 'h-(--control-height-sm) px-2.5 text-12',
        md: 'h-(--control-height-md) px-4 text-13',
        lg: 'h-(--control-height-lg) px-5 text-14',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { busy?: boolean };

export function Button(props: ButtonProps) {
  const [local, variants, rest] = splitProps(props, ['class', 'children', 'busy', 'disabled'], ['variant', 'size']);
  return (
    <button
      type={rest.type ?? 'button'}
      class={cn(buttonVariants(variants), local.class)}
      disabled={local.disabled || local.busy}
      aria-busy={local.busy || undefined}
      {...rest}
    >
      <Show when={local.busy}><Spinner class="size-3" /></Show>
      {local.children}
    </button>
  );
}

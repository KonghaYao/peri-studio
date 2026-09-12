import { cva, type VariantProps } from 'class-variance-authority';
import type { ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as ToggleButtonPrimitive from '@kobalte/core/toggle-button';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../lib/cn';

export const toggleVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-6 rounded-6 font-medium transition-colors outline-none duration-120 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-44',
  {
    variants: {
      variant: {
        default:
          'border border-transparent bg-transparent text-content-secondary hover:bg-interaction-hover hover:text-content-primary data-pressed:bg-interaction-hover data-pressed:text-content-primary',
        outline:
          'border border-border-strong bg-surface-overlay text-content-primary hover:border-accent-solid hover:text-accent-solid data-pressed:border-accent-solid data-pressed:bg-accent-subtle data-pressed:text-accent-solid',
      },
      size: {
        default: 'h-32 px-16 text-13',
        sm: 'h-24 px-10 text-12',
        lg: 'h-40 px-20 text-14',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

type ToggleVariantProps = VariantProps<typeof toggleVariants>;

type ToggleProps<T extends ValidComponent = 'button'> = ToggleButtonPrimitive.ToggleButtonRootProps<T> &
  ToggleVariantProps & { class?: string };

export function Toggle<T extends ValidComponent = 'button'>(props: PolymorphicProps<T, ToggleProps<T>>) {
  const [local, variants, rest] = splitProps(props as ToggleProps, ['class'], ['variant', 'size']);
  return (
    <ToggleButtonPrimitive.Root
      type="button"
      class={cn(toggleVariants({ variant: variants.variant, size: variants.size }), local.class)}
      {...rest}
    />
  );
}

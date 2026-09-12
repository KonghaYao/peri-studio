import type { JSX, ValidComponent } from 'solid-js';
import { Show, splitProps } from 'solid-js';
import * as SeparatorPrimitive from '@kobalte/core/separator';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const separatorVariants = cva('shrink-0 border-0 bg-divider', {
  variants: {
    orientation: {
      horizontal: 'h-px w-full',
      vertical: 'h-full w-px',
    },
    variant: {
      solid: 'bg-divider',
      dashed: 'bg-transparent',
      dotted: 'bg-transparent',
    },
    dashed: {
      true: '',
      false: '',
    },
  },
  compoundVariants: [
    {
      orientation: 'horizontal',
      variant: 'dashed',
      class: 'h-0 border-t border-dashed border-divider bg-transparent',
    },
    {
      orientation: 'vertical',
      variant: 'dashed',
      class: 'w-0 border-l border-dashed border-divider bg-transparent',
    },
    {
      orientation: 'horizontal',
      variant: 'dotted',
      class: 'h-0 border-t border-dotted border-divider bg-transparent',
    },
    {
      orientation: 'vertical',
      variant: 'dotted',
      class: 'w-0 border-l border-dotted border-divider bg-transparent',
    },
    {
      orientation: 'horizontal',
      dashed: true,
      variant: 'solid',
      class: 'h-0 border-t border-dashed border-divider bg-transparent',
    },
    {
      orientation: 'vertical',
      dashed: true,
      variant: 'solid',
      class: 'w-0 border-l border-dashed border-divider bg-transparent',
    },
  ],
  defaultVariants: {
    orientation: 'horizontal',
    variant: 'solid',
    dashed: false,
  },
});

type SeparatorVariantProps = VariantProps<typeof separatorVariants>;

type SeparatorProps<T extends ValidComponent = 'hr'> = SeparatorPrimitive.SeparatorRootProps<T> &
  SeparatorVariantProps & {
    class?: string;
    children?: JSX.Element;
    /** @deprecated 使用 orientation */
    decorative?: boolean;
  };

export function Separator<T extends ValidComponent = 'hr'>(
  props: PolymorphicProps<T, SeparatorProps<T>>,
) {
  const [local, rest] = splitProps(props as SeparatorProps, [
    'class',
    'orientation',
    'variant',
    'dashed',
    'children',
  ]);

  const orientation = () =>
    (local.orientation as 'horizontal' | 'vertical' | undefined) ?? 'horizontal';
  const variant = () => (local.dashed ? 'dashed' : (local.variant ?? 'solid'));

  const lineClass = () =>
    cn(
      separatorVariants({
        orientation: orientation(),
        variant: variant(),
        dashed: local.dashed ?? false,
      }),
      local.children && orientation() === 'horizontal' && 'flex-1',
    );

  return (
    <Show
      when={local.children && orientation() === 'horizontal'}
      fallback={
        <SeparatorPrimitive.Root
          orientation={orientation()}
          class={cn(lineClass(), local.class)}
          data-slot="separator"
          {...rest}
        />
      }
    >
      <div
        data-slot="separator"
        role="separator"
        class={cn('flex w-full items-center gap-12', local.class)}
      >
        <SeparatorPrimitive.Root orientation="horizontal" class={lineClass()} />
        <span class="shrink-0 text-12 text-content-muted">{local.children}</span>
        <SeparatorPrimitive.Root orientation="horizontal" class={lineClass()} />
      </div>
    </Show>
  );
}

/** Ant Design Divider 别名。 */
export const Divider = Separator;

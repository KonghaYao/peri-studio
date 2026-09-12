import type { ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as SeparatorPrimitive from '@kobalte/core/separator';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../lib/cn';

type SeparatorProps<T extends ValidComponent = 'hr'> = SeparatorPrimitive.SeparatorRootProps<T> & { class?: string };

export function Separator<T extends ValidComponent = 'hr'>(props: PolymorphicProps<T, SeparatorProps<T>>) {
  const [local, rest] = splitProps(props as SeparatorProps, ['class']);
  return (
    <SeparatorPrimitive.Root
      class={cn(
        // Preflight styles <hr> with border-top: 1px solid currentColor — reset before bg fill.
        'shrink-0 border-0 bg-divider',
        'data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full',
        'data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
        local.class,
      )}
      {...rest}
    />
  );
}

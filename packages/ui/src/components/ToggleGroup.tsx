import type { ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as ToggleGroupPrimitive from '@kobalte/core/toggle-group';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../lib/cn';
import { type VariantProps } from 'class-variance-authority';
import { toggleVariants } from './Toggle';

type ToggleGroupVariantProps = VariantProps<typeof toggleVariants>;

type RootProps<T extends ValidComponent = 'div'> = ToggleGroupPrimitive.ToggleGroupRootProps<T> & { class?: string };
export function ToggleGroup<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, RootProps<T>>) {
  const [local, rest] = splitProps(props as RootProps, ['class']);
  return (
    <ToggleGroupPrimitive.Root class={cn('inline-flex items-center gap-4', local.class)} {...rest} />
  );
}

type ItemProps<T extends ValidComponent = 'button'> = ToggleGroupPrimitive.ToggleGroupItemProps<T> &
  ToggleGroupVariantProps & { class?: string };

export function ToggleGroupItem<T extends ValidComponent = 'button'>(props: PolymorphicProps<T, ItemProps<T>>) {
  const [local, variants, rest] = splitProps(props as ItemProps, ['class'], ['variant', 'size']);
  return (
    <ToggleGroupPrimitive.Item
      class={cn(toggleVariants({ variant: variants.variant, size: variants.size }), local.class)}
      {...rest}
    />
  );
}

import type { ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as RadioGroupPrimitive from '@kobalte/core/radio-group';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../../lib/cn';

export const RadioGroup = RadioGroupPrimitive.Root;
export const RadioGroupItem = RadioGroupPrimitive.Item;
export const RadioGroupItemInput = RadioGroupPrimitive.ItemInput;
export const RadioGroupItemLabel = RadioGroupPrimitive.ItemLabel;

type ControlProps<T extends ValidComponent = 'div'> = RadioGroupPrimitive.RadioGroupItemControlProps<T> & { class?: string };
export function RadioGroupItemControl<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ControlProps<T>>) {
  const [local, rest] = splitProps(props as ControlProps, ['class']);
  return <RadioGroupPrimitive.ItemControl class={cn('h-16 w-16 shrink-0 rounded-full border border-border-strong bg-surface data-checked:border-success data-checked:bg-success data-checked:shadow-[inset_0_0_0_3px_var(--surface)]', local.class)} {...rest} />;
}

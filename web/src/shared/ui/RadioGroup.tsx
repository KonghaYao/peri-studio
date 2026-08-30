import type { ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as RadioGroupPrimitive from '@kobalte/core/radio-group';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../lib/cn';

export const RadioGroup = RadioGroupPrimitive.Root;
export const RadioGroupItem = RadioGroupPrimitive.Item;

type InputProps<T extends ValidComponent = 'input'> = RadioGroupPrimitive.RadioGroupItemInputProps<T> & { class?: string };
export function RadioGroupItemInput<T extends ValidComponent = 'input'>(props: PolymorphicProps<T, InputProps<T>>) {
  const [local, rest] = splitProps(props as InputProps, ['class']);
  return <RadioGroupPrimitive.ItemInput class={cn('peer', local.class)} {...rest} />;
}

export const RadioGroupItemLabel = RadioGroupPrimitive.ItemLabel;

type ControlProps<T extends ValidComponent = 'div'> = RadioGroupPrimitive.RadioGroupItemControlProps<T> & { class?: string };
export function RadioGroupItemControl<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ControlProps<T>>) {
  const [local, rest] = splitProps(props as ControlProps, ['class']);
  return (
    <RadioGroupPrimitive.ItemControl
      class={cn(
        'grid size-16 flex-none place-items-center rounded-full border border-border-strong bg-surface [transition:border-color_120ms_ease,box-shadow_120ms_ease]',
        'hover:border-accent peer-focus-visible:shadow-accent-ring',
        'data-checked:border-accent',
        local.class,
      )}
      {...rest}
    >
      <RadioGroupPrimitive.ItemIndicator class="size-8 rounded-full bg-accent" />
    </RadioGroupPrimitive.ItemControl>
  );
}

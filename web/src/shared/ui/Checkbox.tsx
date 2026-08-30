import type { ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as CheckboxPrimitive from '@kobalte/core/checkbox';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { Check } from 'lucide-solid';
import { cn } from '../lib/cn';

export const Checkbox = CheckboxPrimitive.Root;

type InputProps<T extends ValidComponent = 'input'> = CheckboxPrimitive.CheckboxInputProps<T> & { class?: string };
export function CheckboxInput<T extends ValidComponent = 'input'>(props: PolymorphicProps<T, InputProps<T>>) {
  const [local, rest] = splitProps(props as InputProps, ['class']);
  return <CheckboxPrimitive.Input class={cn('peer', local.class)} {...rest} />;
}

export const CheckboxLabel = CheckboxPrimitive.Label;

type ControlProps<T extends ValidComponent = 'div'> = CheckboxPrimitive.CheckboxControlProps<T> & { class?: string };
export function CheckboxControl<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ControlProps<T>>) {
  const [local, rest] = splitProps(props as ControlProps, ['class']);
  return (
    <CheckboxPrimitive.Control
      class={cn(
        'grid size-16 flex-none place-items-center rounded-4 border border-border-strong bg-surface [transition:border-color_120ms_ease,background-color_120ms_ease,box-shadow_120ms_ease]',
        'hover:border-accent peer-focus-visible:shadow-accent-ring',
        'data-checked:border-accent data-checked:bg-accent data-checked:text-surface',
        local.class,
      )}
      {...rest}
    >
      <CheckboxPrimitive.Indicator><Check size={12} strokeWidth={3} /></CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Control>
  );
}

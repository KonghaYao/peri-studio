import type { ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as CheckboxPrimitive from '@kobalte/core/checkbox';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../../lib/cn';

export const Checkbox = CheckboxPrimitive.Root;
export const CheckboxInput = CheckboxPrimitive.Input;
export const CheckboxLabel = CheckboxPrimitive.Label;

type ControlProps<T extends ValidComponent = 'div'> = CheckboxPrimitive.CheckboxControlProps<T> & { class?: string };
export function CheckboxControl<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ControlProps<T>>) {
  const [local, rest] = splitProps(props as ControlProps, ['class']);
  return <CheckboxPrimitive.Control class={cn('ui-checkbox-control', local.class)} {...rest} />;
}

import type { ValidComponent } from 'solid-js';
import { Show, splitProps } from 'solid-js';
import * as CheckboxPrimitive from '@kobalte/core/checkbox';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { Check, Minus } from 'lucide-solid';
import { cn } from '../lib/cn';

export const Checkbox = CheckboxPrimitive.Root;

type InputProps<T extends ValidComponent = 'input'> = CheckboxPrimitive.CheckboxInputProps<T> & { class?: string };
export function CheckboxInput<T extends ValidComponent = 'input'>(props: PolymorphicProps<T, InputProps<T>>) {
  const [local, rest] = splitProps(props as InputProps, ['class']);
  return <CheckboxPrimitive.Input class={cn('peer', local.class)} {...rest} />;
}

type LabelProps<T extends ValidComponent = 'label'> = CheckboxPrimitive.CheckboxLabelProps<T> & { class?: string };
export function CheckboxLabel<T extends ValidComponent = 'label'>(props: PolymorphicProps<T, LabelProps<T>>) {
  const [local, rest] = splitProps(props as LabelProps, ['class']);
  return (
    <CheckboxPrimitive.Label
      class={cn(
        'text-13 text-content-primary data-disabled:cursor-not-allowed data-disabled:text-content-muted',
        local.class,
      )}
      {...rest}
    />
  );
}

type ControlProps<T extends ValidComponent = 'div'> = CheckboxPrimitive.CheckboxControlProps<T> & {
  class?: string;
  indeterminate?: boolean;
};

export function CheckboxControl<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ControlProps<T>>) {
  const [local, rest] = splitProps(props as ControlProps, ['class', 'indeterminate']);
  return (
    <CheckboxPrimitive.Control
      class={cn(
        'grid size-16 flex-none place-items-center rounded-4 border border-border-strong bg-surface ui-control-transition',
        'hover:border-accent peer-focus-visible:shadow-accent-ring',
        'data-checked:border-accent data-checked:bg-accent data-checked:text-surface',
        'data-[indeterminate]:border-accent data-[indeterminate]:bg-accent data-[indeterminate]:text-surface',
        'data-disabled:cursor-not-allowed data-disabled:border-border-subtle data-disabled:bg-surface-sunken data-disabled:hover:border-border-subtle',
        'data-disabled:data-checked:border-content-faint data-disabled:data-checked:bg-content-faint',
        local.class,
      )}
      data-indeterminate={local.indeterminate ? '' : undefined}
      {...rest}
    >
      <CheckboxPrimitive.Indicator>
        <Show when={local.indeterminate} fallback={<Check size={12} strokeWidth={3} />}>
          <Minus size={12} strokeWidth={3} />
        </Show>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Control>
  );
}

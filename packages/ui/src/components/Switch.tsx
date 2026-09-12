import type { ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as SwitchPrimitive from '@kobalte/core/switch';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../lib/cn';

export const Switch = SwitchPrimitive.Root;

type InputProps<T extends ValidComponent = 'input'> = SwitchPrimitive.SwitchInputProps<T> & { class?: string };
export function SwitchInput<T extends ValidComponent = 'input'>(props: PolymorphicProps<T, InputProps<T>>) {
  const [local, rest] = splitProps(props as InputProps, ['class']);
  return <SwitchPrimitive.Input class={cn('peer', local.class)} {...rest} />;
}

export const SwitchLabel = SwitchPrimitive.Label;

type ControlProps<T extends ValidComponent = 'div'> = SwitchPrimitive.SwitchControlProps<T> & { class?: string };
export function SwitchControl<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ControlProps<T>>) {
  const [local, rest] = splitProps(props as ControlProps, ['class']);
  return (
    <SwitchPrimitive.Control
      class={cn(
        'inline-flex h-20 w-36 flex-none items-center rounded-full border border-border-strong bg-surface px-2 ui-control-transition',
        'hover:border-accent peer-focus-visible:shadow-accent-ring',
        'data-checked:border-accent data-checked:bg-accent',
        'data-disabled:cursor-not-allowed data-disabled:border-border-strong data-disabled:bg-surface-sunken',
        'data-disabled:data-checked:border-content-faint data-disabled:data-checked:bg-content-faint',
        local.class,
      )}
      {...rest}
    />
  );
}

type ThumbProps<T extends ValidComponent = 'div'> = SwitchPrimitive.SwitchThumbProps<T> & { class?: string };
export function SwitchThumb<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ThumbProps<T>>) {
  const [local, rest] = splitProps(props as ThumbProps, ['class']);
  return (
    <SwitchPrimitive.Thumb
      class={cn(
        'block size-16 rounded-full bg-surface ui-control-transition',
        'data-checked:translate-x-16',
        'data-disabled:bg-border-strong data-disabled:data-checked:bg-surface',
        local.class,
      )}
      {...rest}
    />
  );
}

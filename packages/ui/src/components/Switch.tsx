import type { ValidComponent } from 'solid-js';
import { Show, splitProps, type JSX } from 'solid-js';
import * as SwitchPrimitive from '@kobalte/core/switch';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../lib/cn';
import { Spinner } from './Spinner';

export const Switch = SwitchPrimitive.Root;

type InputProps<T extends ValidComponent = 'input'> = SwitchPrimitive.SwitchInputProps<T> & { class?: string };
export function SwitchInput<T extends ValidComponent = 'input'>(props: PolymorphicProps<T, InputProps<T>>) {
  const [local, rest] = splitProps(props as InputProps, ['class']);
  return <SwitchPrimitive.Input class={cn('peer', local.class)} {...rest} />;
}

export const SwitchLabel = SwitchPrimitive.Label;

type ControlProps<T extends ValidComponent = 'div'> = SwitchPrimitive.SwitchControlProps<T> & {
  class?: string;
  checkedChildren?: JSX.Element;
  unCheckedChildren?: JSX.Element;
  loading?: boolean;
};

export function SwitchControl<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ControlProps<T>>) {
  const [local, rest] = splitProps(props as ControlProps, [
    'class',
    'checkedChildren',
    'unCheckedChildren',
    'loading',
  ]);

  const hasText = () => Boolean(local.checkedChildren || local.unCheckedChildren);

  return (
    <SwitchPrimitive.Control
      class={cn(
        'relative inline-flex flex-none items-center rounded-full border border-border-strong bg-border-strong ui-control-transition',
        hasText() ? 'h-24 min-w-48 justify-center gap-6 px-8 text-11 font-medium' : 'h-20 w-36 px-2',
        'hover:border-accent peer-focus-visible:shadow-accent-ring',
        'data-checked:border-accent data-checked:bg-accent data-checked:text-surface',
        'data-disabled:cursor-not-allowed data-disabled:border-border-strong data-disabled:bg-surface-sunken',
        'data-disabled:data-checked:border-content-faint data-disabled:data-checked:bg-content-faint',
        local.class,
      )}
      {...rest}
    >
      <Show when={local.loading}>
        <Spinner class="absolute inset-0 m-auto text-content-muted" decorative />
      </Show>
      <Show when={hasText()}>
        <span class="data-[checked=false]:inline data-[checked=true]:hidden">{local.unCheckedChildren}</span>
        <span class="hidden data-[checked=true]:inline">{local.checkedChildren}</span>
      </Show>
      <Show when={!hasText()}>
        <SwitchThumb />
      </Show>
    </SwitchPrimitive.Control>
  );
}

type ThumbProps<T extends ValidComponent = 'div'> = SwitchPrimitive.SwitchThumbProps<T> & { class?: string };
export function SwitchThumb<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ThumbProps<T>>) {
  const [local, rest] = splitProps(props as ThumbProps, ['class']);
  return (
    <SwitchPrimitive.Thumb
      data-testid="switch-thumb"
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

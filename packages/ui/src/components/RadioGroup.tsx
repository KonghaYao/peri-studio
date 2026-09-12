import type { ValidComponent } from 'solid-js';
import { splitProps, type JSX } from 'solid-js';
import * as RadioGroupPrimitive from '@kobalte/core/radio-group';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn';

export const RadioGroup = RadioGroupPrimitive.Root;
export const RadioGroupItem = RadioGroupPrimitive.Item;

const radioButtonClass = cva(
  'inline-flex min-h-36 cursor-pointer items-center justify-center border border-border-strong bg-surface px-16 text-13 text-content-primary ui-control-transition',
  {
    variants: {
      position: {
        start: 'rounded-l-6',
        middle: 'rounded-none border-l-0',
        end: 'rounded-r-6 border-l-0',
        solo: 'rounded-6',
      },
    },
    defaultVariants: { position: 'solo' },
  },
);

type InputProps<T extends ValidComponent = 'input'> = RadioGroupPrimitive.RadioGroupItemInputProps<T> & { class?: string };
export function RadioGroupItemInput<T extends ValidComponent = 'input'>(props: PolymorphicProps<T, InputProps<T>>) {
  const [local, rest] = splitProps(props as InputProps, ['class']);
  return <RadioGroupPrimitive.ItemInput class={cn('peer sr-only', local.class)} {...rest} />;
}

export const RadioGroupItemLabel = RadioGroupPrimitive.ItemLabel;

type ControlProps<T extends ValidComponent = 'div'> = RadioGroupPrimitive.RadioGroupItemControlProps<T> & { class?: string };
export function RadioGroupItemControl<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ControlProps<T>>) {
  const [local, rest] = splitProps(props as ControlProps, ['class']);
  return (
    <RadioGroupPrimitive.ItemControl
      class={cn(
        'grid size-16 flex-none place-items-center rounded-full border border-border-strong bg-surface ui-control-transition',
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

type RadioButtonProps = {
  value: string;
  children: JSX.Element;
  class?: string;
  disabled?: boolean;
  position?: 'start' | 'middle' | 'end' | 'solo';
};

/** 按钮样式单选项，对齐 Ant Design Radio.Button。 */
export function RadioButton(props: RadioButtonProps) {
  const [local, rest] = splitProps(props, ['class', 'children', 'value', 'disabled', 'position']);
  return (
    <RadioGroupItem value={local.value} disabled={local.disabled} class={cn('inline-flex', local.class)} {...rest}>
      <RadioGroupItemInput />
      <RadioGroupItemLabel
        class={cn(
          radioButtonClass({ position: local.position ?? 'solo' }),
          'peer-data-[checked]:border-accent peer-data-[checked]:bg-interaction-hover peer-data-[checked]:font-medium peer-data-[checked]:text-accent',
          'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45',
        )}
      >
        {local.children}
      </RadioGroupItemLabel>
    </RadioGroupItem>
  );
}

type RadioGroupCompound = typeof RadioGroup & { Button: typeof RadioButton };
(RadioGroup as RadioGroupCompound).Button = RadioButton;

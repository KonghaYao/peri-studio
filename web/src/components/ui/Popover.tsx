import type { Component, ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as PopoverPrimitive from '@kobalte/core/popover';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../../lib/cn';

const Popover: Component<PopoverPrimitive.PopoverRootProps> = (props) => <PopoverPrimitive.Root gutter={4} {...props} />;
const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = <T extends ValidComponent = 'div'>(props: PolymorphicProps<T, PopoverPrimitive.PopoverContentProps<T> & { class?: string }>) => {
  const [local, others] = splitProps(props as PopoverPrimitive.PopoverContentProps & { class?: string }, ['class']);
  return <PopoverPrimitive.Portal><PopoverPrimitive.Content class={cn('ui-popover z-50 w-72 origin-[var(--kb-popover-content-transform-origin)] outline-none data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95', local.class)} {...others} /></PopoverPrimitive.Portal>;
};

export { Popover, PopoverContent, PopoverTrigger };

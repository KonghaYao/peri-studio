import type { JSX, ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as AccordionPrimitive from '@kobalte/core/accordion';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { ChevronDown } from 'lucide-solid';
import { cn } from '../lib/cn';

export const Accordion = AccordionPrimitive.Root;

type ItemProps<T extends ValidComponent = 'div'> = AccordionPrimitive.AccordionItemProps<T> & { class?: string };
export function AccordionItem<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ItemProps<T>>) {
  const [local, rest] = splitProps(props as ItemProps, ['class']);
  return (
    <AccordionPrimitive.Item
      class={cn('border-b border-border-subtle last:border-b-0', local.class)}
      {...rest}
    />
  );
}

type TriggerProps<T extends ValidComponent = 'button'> = AccordionPrimitive.AccordionTriggerProps<T> & {
  class?: string;
  children?: JSX.Element;
};
export function AccordionTrigger<T extends ValidComponent = 'button'>(props: PolymorphicProps<T, TriggerProps<T>>) {
  const [local, rest] = splitProps(props as TriggerProps, ['class', 'children']);
  return (
    <AccordionPrimitive.Header class="flex">
      <AccordionPrimitive.Trigger
        class={cn(
          'ui-accordion-trigger flex flex-1 cursor-pointer items-center justify-between gap-8 border-0 bg-transparent px-16 py-12 text-left text-13 font-medium text-content-primary transition-colors outline-none duration-120 hover:text-accent-solid data-expanded:text-accent-solid focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45',
          local.class,
        )}
        {...rest}
      >
        {local.children}
        <ChevronDown
          size={16}
          strokeWidth={1.7}
          class="ui-accordion-chevron shrink-0 text-content-muted"
          aria-hidden="true"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

type ContentProps<T extends ValidComponent = 'div'> = AccordionPrimitive.AccordionContentProps<T> & {
  class?: string;
  children?: JSX.Element;
};
export function AccordionContent<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ContentProps<T>>) {
  const [local, rest] = splitProps(props as ContentProps, ['class', 'children']);
  return (
    <AccordionPrimitive.Content
      class={cn('overflow-hidden text-12 text-content-secondary transition-all duration-120 ease-in-out', local.class)}
      {...rest}
    >
      <div class="px-16 pb-12">{local.children}</div>
    </AccordionPrimitive.Content>
  );
}

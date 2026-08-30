import type { Component, ComponentProps, ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as TabsPrimitive from '@kobalte/core/tabs';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../lib/cn';

export const Tabs = TabsPrimitive.Root;

type ListProps<T extends ValidComponent = 'div'> = TabsPrimitive.TabsListProps<T> & { class?: string };
export function TabsList<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ListProps<T>>) {
  const [local, rest] = splitProps(props as ListProps, ['class']);
  return <TabsPrimitive.List class={cn('relative flex gap-16 border-b border-border-subtle', local.class)} {...rest} />;
}

type TriggerProps<T extends ValidComponent = 'button'> = TabsPrimitive.TabsTriggerProps<T> & { class?: string };
export function TabsTrigger<T extends ValidComponent = 'button'>(props: PolymorphicProps<T, TriggerProps<T>>) {
  const [local, rest] = splitProps(props as TriggerProps, ['class']);
  return <TabsPrimitive.Trigger class={cn('-mb-px cursor-pointer border-0 border-b-2 border-transparent bg-transparent px-4 py-8 text-13 text-text-secondary transition-[color,border-color] duration-120 ease-in-out outline-none hover:text-text-primary focus-visible:text-text-primary data-selected:border-b-accent data-selected:font-medium data-selected:text-accent data-disabled:cursor-not-allowed data-disabled:opacity-45', local.class)} {...rest} />;
}

type ContentProps<T extends ValidComponent = 'div'> = TabsPrimitive.TabsContentProps<T> & { class?: string };
export function TabsContent<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ContentProps<T>>) {
  const [local, rest] = splitProps(props as ContentProps, ['class']);
  return <TabsPrimitive.Content class={cn('pt-16 outline-none', local.class)} {...rest} />;
}

export const TabsIndicator: Component<ComponentProps<typeof TabsPrimitive.Indicator>> = TabsPrimitive.Indicator;

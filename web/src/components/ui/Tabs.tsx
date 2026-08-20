import type { Component, ComponentProps, ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as TabsPrimitive from '@kobalte/core/tabs';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../../lib/cn';

export const Tabs = TabsPrimitive.Root;

type ListProps<T extends ValidComponent = 'div'> = TabsPrimitive.TabsListProps<T> & { class?: string };
export function TabsList<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ListProps<T>>) {
  const [local, rest] = splitProps(props as ListProps, ['class']);
  return <TabsPrimitive.List class={cn('ui-tabs__list', local.class)} {...rest} />;
}

type TriggerProps<T extends ValidComponent = 'button'> = TabsPrimitive.TabsTriggerProps<T> & { class?: string };
export function TabsTrigger<T extends ValidComponent = 'button'>(props: PolymorphicProps<T, TriggerProps<T>>) {
  const [local, rest] = splitProps(props as TriggerProps, ['class']);
  return <TabsPrimitive.Trigger class={cn('cursor-pointer border-0 border-b-2 border-transparent bg-transparent text-text-muted hover:text-text-primary data-selected:-mb-1 data-selected:border-b-accent data-selected:text-text-primary data-disabled:cursor-not-allowed data-disabled:opacity-45', local.class)} {...rest} />;
}

type ContentProps<T extends ValidComponent = 'div'> = TabsPrimitive.TabsContentProps<T> & { class?: string };
export function TabsContent<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ContentProps<T>>) {
  const [local, rest] = splitProps(props as ContentProps, ['class']);
  return <TabsPrimitive.Content class={cn('ui-tabs__content', local.class)} {...rest} />;
}

export const TabsIndicator: Component<ComponentProps<typeof TabsPrimitive.Indicator>> = TabsPrimitive.Indicator;

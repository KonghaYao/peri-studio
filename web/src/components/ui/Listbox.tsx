import type { ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as ListboxPrimitive from '@kobalte/core/listbox';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../../lib/cn';

export const Listbox = ListboxPrimitive.Root;

type ItemProps<T extends ValidComponent = 'div'> = ListboxPrimitive.ListboxItemProps<T> & { class?: string };
export function ListboxItem<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ItemProps<T>>) {
  const [local, rest] = splitProps(props as ItemProps, ['class']);
  return <ListboxPrimitive.Item class={cn('cursor-pointer outline-none data-[selected]:bg-selected focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2', local.class)} {...rest} />;
}

export const ListboxItemLabel = ListboxPrimitive.ItemLabel;
export const ListboxItemDescription = ListboxPrimitive.ItemDescription;

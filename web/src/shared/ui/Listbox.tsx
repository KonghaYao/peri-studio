import type { ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import { cva, type VariantProps } from 'class-variance-authority';
import * as ListboxPrimitive from '@kobalte/core/listbox';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../lib/cn';

export const Listbox = ListboxPrimitive.Root;

const listboxItemBase =
  'cursor-pointer outline-none data-[selected]:bg-selected focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2';

const listboxItemRecipes = cva(listboxItemBase, {
  variants: {
    recipe: {
      plain:
        'w-full min-h-54 rounded-10 border border-transparent bg-transparent px-10 py-9 text-left text-text-primary hover:bg-hover data-[selected]:border-border-strong',
      search:
        'flex w-full min-h-32 items-center justify-between gap-10 rounded-md border-0 bg-transparent px-10 py-6 text-left text-content-primary hover:bg-interaction-hover focus-visible:bg-interaction-hover data-[disabled]:cursor-not-allowed data-[disabled]:opacity-52 pointer-coarse:min-h-44',
      menu:
        'mx-6 rounded-lg border-0 bg-transparent px-10 py-6 text-left text-content-primary transition-colors duration-120 data-[selected]:bg-sidebar-selected data-[highlighted]:bg-sidebar-selected pointer-coarse:min-h-44',
    },
  },
});

type ListboxItemRecipeProps = VariantProps<typeof listboxItemRecipes>;

type ItemProps<T extends ValidComponent = 'div'> = ListboxPrimitive.ListboxItemProps<T> &
  ListboxItemRecipeProps & { class?: string };

export function ListboxItem<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ItemProps<T>>) {
  const [local, rest] = splitProps(props as ItemProps, ['class', 'recipe']);
  return (
    <ListboxPrimitive.Item
      class={cn(listboxItemRecipes({ recipe: local.recipe }), local.class)}
      {...rest}
    />
  );
}

export const ListboxItemLabel = ListboxPrimitive.ItemLabel;
export const ListboxItemDescription = ListboxPrimitive.ItemDescription;

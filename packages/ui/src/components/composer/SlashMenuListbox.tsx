import { createEffect, Show, type Accessor } from 'solid-js';
import { Listbox, ListboxItem } from '../Listbox';
import { cn } from '../../lib/cn';
import {
  SlashMenuDivider,
  SlashMenuOptionContent,
  SlashMenuShell,
  type SlashMenuItem,
} from './SlashMenu';

export type SlashMenuListboxProps<T> = {
  id: string;
  items: T[] | Accessor<T[]>;
  activeIndex: number | Accessor<number>;
  toMenuItem: (item: T, next?: T) => SlashMenuItem;
  optionValue: (item: T) => string;
  optionTextValue: (item: T) => string;
  getOptionId?: (menuId: string, item: T) => string;
  onActiveIndex: (index: number) => void;
  onSelect: (item: T) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  namePrefix?: string;
  class?: string;
  shellClass?: string;
  'data-testid'?: string;
  listClass?: string;
};

/** 可键盘导航的 Slash 菜单：Listbox a11y + Slash 行视觉；业务侧注入 items 映射。 */
export function SlashMenuListbox<T>(props: SlashMenuListboxProps<T>) {
  const items = () => (typeof props.items === 'function' ? props.items() : props.items);
  const activeIndex = () => (typeof props.activeIndex === 'function' ? props.activeIndex() : props.activeIndex);
  const activeName = () => items()[activeIndex()] ? props.optionValue(items()[activeIndex()]) : undefined;

  createEffect(() => {
    const name = activeName();
    if (!name || !props.getOptionId) return;
    const element = document.getElementById(props.getOptionId(props.id, items()[activeIndex()]));
    element?.scrollIntoView?.({ block: 'nearest' });
  });

  return (
    <SlashMenuShell
      data-testid={props['data-testid'] ?? 'slash-menu'}
      class={props.shellClass}
    >
      <Listbox
        id={props.id}
        aria-label="Available commands and skills"
        options={items()}
        optionValue={props.optionValue}
        optionTextValue={props.optionTextValue}
        value={activeName() ? [activeName()!] : []}
        selectionMode="single"
        shouldUseVirtualFocus
        shouldFocusWrap
        onKeyDown={(event) => props.onKeyDown?.(event)}
        onChange={(selected) => {
          const name = [...selected][0];
          const index = items().findIndex((item) => props.optionValue(item) === name);
          if (index >= 0) props.onActiveIndex(index);
        }}
        class={cn(
          'slash-menu__items ui-scrollbar max-h-(--container-slash) overflow-auto py-6 max-tight:max-h-(--container-slash-tight)',
          props.listClass,
        )}
        renderItem={(item) => {
          const command = item.rawValue as T;
          const index = () => items().findIndex((candidate) => props.optionValue(candidate) === props.optionValue(command));
          const active = () => index() === activeIndex();
          const next = () => items()[index() + 1];
          const menuItem = () => props.toMenuItem(command, next());
          const optionId = props.getOptionId?.(props.id, command);

          return (
            <>
              <ListboxItem
                id={optionId}
                item={item}
                recipe="menu"
                aria-selected={active()}
                class={cn(
                  'slash-menu__item transition-colors duration-(--duration-fast)',
                  active() && 'bg-sidebar-selected',
                )}
                onPointerMove={() => props.onActiveIndex(index())}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => props.onSelect(command)}
              >
                <SlashMenuOptionContent item={menuItem()} namePrefix={props.namePrefix} />
              </ListboxItem>
              <Show when={menuItem().dividerAfter}>
                <SlashMenuDivider />
              </Show>
            </>
          );
        }}
      />
    </SlashMenuShell>
  );
}

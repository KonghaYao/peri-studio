import { createEffect, Show } from 'solid-js';
import { Listbox, ListboxItem, SlashMenuDivider, SlashMenuOptionContent, SlashMenuShell, type SlashMenuItem } from '@peri/ui';
import { cn } from '@peri/ui';
import type { AgentCommandInfo } from '@/entities/chat/control-view';
import { slashMenuOptionId } from '@/features/composer/slash-menu';

interface Props {
  id: string;
  items: AgentCommandInfo[];
  activeIndex: number;
  onActiveIndex: (index: number) => void;
  onSelect: (item: AgentCommandInfo) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
}

function kindDividerAfter(item: AgentCommandInfo, next?: AgentCommandInfo) {
  if (!next) return false;
  if (item.kind === 'command' && next.kind !== 'command') return true;
  if (item.kind === 'skill' && next.kind === 'mcp_skill') return true;
  return false;
}

function toSlashMenuItem(item: AgentCommandInfo, next?: AgentCommandInfo): SlashMenuItem {
  return {
    name: item.name,
    description: item.description,
    kind: item.kind,
    accent: item.kind === 'skill',
    dividerAfter: kindDividerAfter(item, next),
  };
}

/** Composer slash 面板：Listbox 键盘/a11y + @peri/ui 行视觉。 */
export function SlashMenu(props: Props) {
  const activeName = () => props.items[props.activeIndex]?.name;

  createEffect(() => {
    const name = activeName();
    if (!name) return;
    const element = document.getElementById(slashMenuOptionId(props.id, name));
    element?.scrollIntoView?.({ block: 'nearest' });
  });

  return (
    <SlashMenuShell
      data-testid="slash-menu"
      class="slash-menu absolute z-35 right-20 bottom-full left-20 mb-8 max-tight:right-10 max-tight:left-10"
    >
      <Listbox
        id={props.id}
        aria-label="Available commands and skills"
        options={props.items}
        optionValue={(item) => item.name}
        optionTextValue={(item) => `${item.name} ${item.description}`}
        value={activeName() ? [activeName()!] : []}
        selectionMode="single"
        shouldUseVirtualFocus
        shouldFocusWrap
        onKeyDown={(event) => props.onKeyDown?.(event)}
        onChange={(selected) => {
          const name = [...selected][0];
          const index = props.items.findIndex((item) => item.name === name);
          if (index >= 0) props.onActiveIndex(index);
        }}
        class="slash-menu__items ui-scrollbar max-h-(--container-slash) overflow-auto py-6 max-tight:max-h-(--container-slash-tight)"
        renderItem={(item) => {
          const command = item.rawValue;
          const index = () => props.items.findIndex((candidate) => candidate.name === command.name);
          const active = () => index() === props.activeIndex;
          const next = () => props.items[index() + 1];
          const menuItem = () => toSlashMenuItem(command, next());
          return <>
            <ListboxItem
              id={slashMenuOptionId(props.id, command.name)}
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
              <SlashMenuOptionContent item={menuItem()} namePrefix="/" />
            </ListboxItem>
            <Show when={menuItem().dividerAfter}>
              <SlashMenuDivider />
            </Show>
          </>;
        }}
      />
    </SlashMenuShell>
  );
}

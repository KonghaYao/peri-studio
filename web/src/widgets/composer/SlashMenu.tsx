import { createEffect, Show } from 'solid-js';
import { Box, SlidersHorizontal } from 'lucide-solid';
import { Listbox, ListboxItem } from '@peri/ui';
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

function SlashIcon(props: { kind: AgentCommandInfo['kind'] }) {
  if (props.kind === 'skill') {
    return <SlidersHorizontal size={15} strokeWidth={1.7} class="text-warning-solid" />;
  }
  return <Box size={15} strokeWidth={1.7} class="text-content-muted" />;
}

function kindDividerAfter(item: AgentCommandInfo, next?: AgentCommandInfo) {
  if (!next) return false;
  if (item.kind === 'command' && next.kind !== 'command') return true;
  if (item.kind === 'skill' && next.kind === 'mcp_skill') return true;
  return false;
}

/** Composer slash 面板：图标 + 命令名 + 同行说明；分组分隔线。 */
export function SlashMenu(props: Props) {
  const activeName = () => props.items[props.activeIndex]?.name;

  createEffect(() => {
    const name = activeName();
    if (!name) return;
    const element = document.getElementById(slashMenuOptionId(props.id, name));
    element?.scrollIntoView?.({ block: 'nearest' });
  });

  return (
    <div data-testid="slash-menu" class="slash-menu absolute z-35 right-20 bottom-full left-20 mb-8 overflow-hidden rounded-xl border border-border-subtle bg-surface-overlay shadow-overlay max-tight:right-10 max-tight:left-10">
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
              <div class="flex min-w-0 items-center gap-10">
                <span class="grid size-16 shrink-0 place-items-center">
                  <SlashIcon kind={command.kind} />
                </span>
                <p class="min-w-0 truncate text-13 leading-snug">
                  <span class={cn('font-medium', command.kind === 'skill' ? 'text-warning-strong' : 'text-content-primary')}>
                    /{command.name}
                  </span>
                  <Show when={command.description}>
                    <span class="text-content-muted"> {command.description}</span>
                  </Show>
                </p>
              </div>
            </ListboxItem>
            <Show when={kindDividerAfter(command, next())}>
              <div class="mx-12 my-4 border-t border-border-subtle" role="presentation" />
            </Show>
          </>;
        }}
      />
    </div>
  );
}

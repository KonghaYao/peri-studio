import { createEffect, Show } from 'solid-js';
import { Listbox, ListboxItem } from '../../components/ui';
import { cn } from '../../lib/cn';
import type { AgentCommandInfo } from '../lib/control-view';
import { slashMenuOptionId } from '../lib/slash-menu';

interface Props {
  id: string;
  items: AgentCommandInfo[];
  activeIndex: number;
  onActiveIndex: (index: number) => void;
  onSelect: (item: AgentCommandInfo) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
}

const kindLabel = (kind: AgentCommandInfo['kind']) => kind === 'skill'
  ? 'Peri Skill'
  : kind === 'mcp_skill' ? 'MCP Skill' : 'Command';

export function SlashMenu(props: Props) {
  const activeName = () => props.items[props.activeIndex]?.name;

  createEffect(() => {
    const name = activeName();
    if (!name) return;
    const element = document.getElementById(slashMenuOptionId(props.id, name));
    element?.scrollIntoView?.({ block: 'nearest' });
  });

  return (
    <div class="slash-menu absolute z-35 right-20 bottom-[calc(100%+8px)] left-20 overflow-hidden rounded-14 border border-border-subtle bg-surface shadow-popover max-tight:right-10 max-tight:left-10">
      <div class="slash-menu__heading flex items-baseline justify-between gap-16 pt-12 pr-14 pb-9 pl-14 border-b border-divider"><strong class="text-12">Invoke capabilities</strong><span class="text-text-muted text-10 max-tight:hidden">Writes to the draft when selected; does not run immediately</span></div>
      <Listbox
        id={props.id}
        aria-label="Available commands and skills"
        options={props.items}
        optionValue={(item) => item.name}
        optionTextValue={(item) => item.name}
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
        class="slash-menu__items ui-scrollbar max-h-(--container-slash) overflow-auto p-5 max-tight:max-h-(--container-slash-tight)"
        renderItem={(item) => {
          const command = item.rawValue;
          const index = () => props.items.findIndex((candidate) => candidate.name === command.name);
          const active = () => index() === props.activeIndex;
          return <ListboxItem
            id={slashMenuOptionId(props.id, command.name)}
            item={item}
            aria-selected={active()}
            class={cn(
              'slash-menu__item grid w-full grid-cols-slash items-center gap-12 p-9 border-0 rounded-11 bg-transparent text-text-primary text-left cursor-pointer data-[selected]:bg-selected data-[highlighted]:bg-selected pointer-coarse:min-h-44 max-tight:grid-cols-1 max-tight:gap-3 max-tight:min-h-52',
              active() && 'bg-selected',
            )}
            onPointerMove={() => props.onActiveIndex(index())}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => props.onSelect(command)}
          >
            <span class="slash-menu__command flex min-w-0 items-center gap-8"><code class="overflow-hidden text-text-primary font-mono text-12 leading-14 text-ellipsis whitespace-nowrap">/{command.name}</code><small class="flex-none px-6 py-3 border border-border-subtle rounded-full text-text-secondary text-9 font-650">{kindLabel(command.kind)}</small></span>
            <Show when={command.description}><span class="slash-menu__description overflow-hidden text-text-secondary text-11 leading-135 text-ellipsis whitespace-nowrap max-tight:whitespace-normal">{command.description}</span></Show>
          </ListboxItem>;
        }}
      />
      <div class="slash-menu__hint flex gap-14 py-7 px-14 border-t border-divider text-text-muted text-9 max-tight:hidden" aria-hidden="true"><span>↑↓ Select</span><span>Enter Insert</span><span>Esc Close</span></div>
    </div>
  );
}

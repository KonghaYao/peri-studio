import { For, Show } from 'solid-js';
import type { AgentCommandInfo } from '../lib/control-view';

interface Props {
  id: string;
  items: AgentCommandInfo[];
  activeIndex: number;
  onActiveIndex: (index: number) => void;
  onSelect: (item: AgentCommandInfo) => void;
}

const kindLabel = (kind: AgentCommandInfo['kind']) => kind === 'skill'
  ? 'Peri Skill'
  : kind === 'mcp_skill' ? 'MCP Skill' : 'Command';

export function SlashMenu(props: Props) {
  return (
    <div class="slash-menu absolute z-35 right-20 bottom-full-8 left-20 overflow-hidden border border-border-subtle rounded-17 bg-surface shadow-popover max-tight:right-10 max-tight:left-10" id={props.id} role="listbox" aria-label="Available commands and skills">
      <div class="slash-menu__heading flex items-baseline justify-between gap-16 pt-12 pr-14 pb-9 pl-14 border-b border-divider"><strong class="text-12">Invoke capabilities</strong><span class="text-text-muted text-10 max-tight:hidden">Writes to the draft when selected; does not run immediately</span></div>
      <div class="slash-menu__items ui-scrollbar max-h-(--container-slash) overflow-auto p-5 max-tight:max-h-(--container-slash-tight)">
        <For each={props.items}>{(item, index) => (
          <button
            type="button"
            id={`${props.id}-option-${index()}`}
            role="option"
            aria-selected={index() === props.activeIndex}
            class="slash-menu__item grid w-full grid-cols-slash items-center gap-12 p-9 border-0 rounded-11 bg-transparent text-text-primary text-left cursor-pointer aria-selected:bg-selected pointer-coarse:min-h-44 max-tight:grid-cols-1 max-tight:gap-3 max-tight:min-h-52"
            onPointerMove={() => props.onActiveIndex(index())}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => props.onSelect(item)}
          >
            <span class="slash-menu__command flex min-w-0 items-center gap-8"><code class="overflow-hidden text-text-primary font-mono text-12 leading-14 text-ellipsis whitespace-nowrap">/{item.name}</code><small class="flex-none px-6 py-3 border border-border-subtle rounded-full text-text-secondary text-9 font-650">{kindLabel(item.kind)}</small></span>
            <Show when={item.description}><span class="slash-menu__description overflow-hidden text-text-secondary text-11 leading-135 text-ellipsis whitespace-nowrap max-tight:whitespace-normal">{item.description}</span></Show>
          </button>
        )}</For>
      </div>
      <div class="slash-menu__hint flex gap-14 py-7 px-14 border-t border-divider text-text-muted text-9 max-tight:hidden" aria-hidden="true"><span>↑↓ Select</span><span>Enter Insert</span><span>Esc Close</span></div>
    </div>
  );
}

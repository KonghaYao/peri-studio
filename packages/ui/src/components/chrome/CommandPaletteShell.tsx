import { CornerDownLeft, Search } from 'lucide-solid';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  splitProps,
  type Component,
  type JSX,
} from 'solid-js';
import { cn } from '../../lib/cn';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../Dialog';
import { Input } from '../Field';

export type CommandPaletteItem = {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  icon?: JSX.Element;
  disabled?: boolean;
  onSelect: () => void;
};

export type CommandPaletteShellProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandPaletteItem[];
  placeholder?: string;
  emptyMessage?: string;
  title?: string;
  /** 自定义 footer；`null` 隐藏；缺省显示键盘提示。 */
  footer?: JSX.Element | null;
  class?: string;
  'data-testid'?: string;
};

const DEFAULT_KEYBOARD_HINT = (
  <span class="text-11 text-content-muted">
    ↑↓ Navigate · ↵ Select · Esc Close
  </span>
);

function wrapIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

function matchesQuery(item: CommandPaletteItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = `${item.label} ${item.hint ?? ''} ${item.keywords ?? ''}`.toLowerCase();
  return haystack.includes(normalized);
}

/** T3 · 无路由绑定的命令面板壳：搜索过滤 + 键盘导航 + item 回调。 */
export const CommandPaletteShell: Component<CommandPaletteShellProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'open',
    'onOpenChange',
    'items',
    'placeholder',
    'emptyMessage',
    'title',
    'footer',
    'class',
  ]);

  const [query, setQuery] = createSignal('');
  const [activeIndex, setActiveIndex] = createSignal(0);

  const filtered = createMemo(() => local.items.filter((item) => matchesQuery(item, query())));

  createEffect(() => {
    if (!local.open) {
      setQuery('');
      setActiveIndex(0);
      return;
    }
    setActiveIndex(0);
  });

  createEffect(() => {
    const count = filtered().length;
    if (activeIndex() >= count) setActiveIndex(Math.max(0, count - 1));
  });

  const selectItem = (item: CommandPaletteItem) => {
    if (item.disabled) return;
    local.onOpenChange(false);
    item.onSelect();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const items = filtered();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => wrapIndex(index + 1, items.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => wrapIndex(index - 1, items.length));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const item = items[activeIndex()];
      if (item) selectItem(item);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      local.onOpenChange(false);
    }
  };

  let listRef: HTMLDivElement | undefined;
  createEffect(() => {
    const node = listRef?.querySelector<HTMLElement>(`[data-command-index="${activeIndex()}"]`);
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' });
    }
  });

  return (
    <Dialog open={local.open} onOpenChange={local.onOpenChange}>
      <DialogContent
        {...rest}
        size="search"
        class={cn('ui-command-palette gap-0 p-0', local.class)}
        aria-label={local.title ?? 'Command palette'}
      >
        <DialogTitle class="sr-only">{local.title ?? 'Command palette'}</DialogTitle>
        <DialogDescription class="sr-only">
          Search commands and navigate with arrow keys.
        </DialogDescription>
        <div class="flex items-center gap-8 border-b border-border-subtle px-12 py-10">
          <Search size={16} class="shrink-0 text-content-muted" aria-hidden="true" />
          <Input
            autofocus
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={local.placeholder ?? 'Search commands…'}
            class="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            aria-label="Search commands"
          />
          <kbd class="hidden rounded-4 border border-border-subtle bg-surface-sunken px-6 py-2 font-mono text-10 text-content-muted desk:inline">
            Esc
          </kbd>
        </div>
        <div
          ref={listRef}
          class="ui-scrollbar max-h-320 overflow-auto p-6"
          role="listbox"
          aria-activedescendant={filtered()[activeIndex()]?.id}
        >
          <Show
            when={filtered().length > 0}
            fallback={(
              <p class="px-12 py-24 text-center text-12 text-content-muted">
                {local.emptyMessage ?? 'No matching commands.'}
              </p>
            )}
          >
            <For each={filtered()}>
              {(item, index) => (
                <button
                  type="button"
                  data-command-index={index()}
                  id={item.id}
                  role="option"
                  aria-selected={activeIndex() === index()}
                  disabled={item.disabled}
                  class={cn(
                    'flex w-full items-center gap-10 rounded-6 px-10 py-8 text-left text-12 transition-colors',
                    activeIndex() === index()
                      ? 'bg-interaction-hover text-content-primary'
                      : 'text-content-secondary hover:bg-interaction-hover',
                    item.disabled && 'cursor-not-allowed opacity-45',
                  )}
                  onMouseEnter={() => setActiveIndex(index())}
                  onClick={() => selectItem(item)}
                >
                  <Show when={item.icon}>
                    <span class="shrink-0 text-content-muted" aria-hidden="true">{item.icon}</span>
                  </Show>
                  <span class="min-w-0 flex-1 truncate font-500">{item.label}</span>
                  <Show when={item.hint}>
                    <span class="shrink-0 text-11 text-content-muted">{item.hint}</span>
                  </Show>
                  <Show when={activeIndex() === index()}>
                    <CornerDownLeft size={14} class="shrink-0 text-content-muted" aria-hidden="true" />
                  </Show>
                </button>
              )}
            </For>
          </Show>
        </div>
        <Show when={local.footer !== null}>
          <div class="border-t border-border-subtle px-12 py-8">
            {local.footer ?? DEFAULT_KEYBOARD_HINT}
          </div>
        </Show>
      </DialogContent>
    </Dialog>
  );
};

/** T4 可选：imperative open 事件名（非 fuse 产品常量）。 */
export const COMMAND_PALETTE_OPEN_EVENT = 'peri-ui:command-palette-open';

/** 派发命令面板打开事件；T4 用 `bindCommandPaletteOpenEvent` 监听。 */
export function dispatchCommandPaletteOpen(target: EventTarget = window): void {
  target.dispatchEvent(new CustomEvent(COMMAND_PALETTE_OPEN_EVENT, { bubbles: true }));
}

/** 监听 imperative open 事件；返回清理函数。 */
export function bindCommandPaletteOpenEvent(
  onOpen: () => void,
  target: EventTarget = window,
): () => void {
  const handler = () => onOpen();
  target.addEventListener(COMMAND_PALETTE_OPEN_EVENT, handler);
  return () => target.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, handler);
}

/** 注册全局 Cmd/Ctrl+K 快捷键；返回清理函数。 */
export function bindCommandPaletteHotkey(onToggle: () => void): () => void {
  const handler = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
    event.preventDefault();
    onToggle();
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}

/** 在 typing target 外按 `?` 打开快捷键帮助。 */
export function bindShortcutsHelpHotkey(onOpen: () => void): () => void {
  const isTypingTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  };
  const handler = (event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key !== '?') return;
    event.preventDefault();
    onOpen();
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}

import {
  For,
  Show,
  splitProps,
  type Component,
  type JSX,
} from 'solid-js';
import { cn } from '../../lib/cn';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '../Command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../Dialog';

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

function itemKeywords(item: CommandPaletteItem): string | undefined {
  const parts = [item.keywords, item.hint].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : undefined;
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

  const selectItem = (item: CommandPaletteItem) => {
    if (item.disabled) return;
    local.onOpenChange(false);
    item.onSelect();
  };

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
        <Command
          open={local.open}
          class="rounded-none border-0 bg-transparent shadow-none"
        >
          <div class="flex items-center gap-8 border-b border-border-subtle px-12 py-10">
            <CommandInput
              autofocus
              wrapperClass="flex-1 border-0 px-0"
              class="h-auto px-0 text-12 shadow-none focus-visible:ring-0"
              placeholder={local.placeholder ?? 'Search commands…'}
              aria-label="Search commands"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  local.onOpenChange(false);
                }
              }}
            />
            <kbd class="hidden rounded-4 border border-border-subtle bg-surface-sunken px-6 py-2 font-mono text-10 text-content-muted desk:inline">
              Esc
            </kbd>
          </div>
          <CommandList
            class="ui-scrollbar max-h-320 p-6"
            shouldFocusWrap
            navigateDisabledItems
            autoFocusFirst
          >
            <CommandEmpty class="px-12 py-24 text-12 text-content-muted">
              {local.emptyMessage ?? 'No matching commands.'}
            </CommandEmpty>
            <For each={local.items}>
              {(item) => (
                <CommandItem
                  id={item.id}
                  value={item.id}
                  keywords={itemKeywords(item)}
                  hint={item.hint}
                  icon={item.icon}
                  disabled={item.disabled}
                  onSelect={() => selectItem(item)}
                >
                  {item.label}
                </CommandItem>
              )}
            </For>
          </CommandList>
        </Command>
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

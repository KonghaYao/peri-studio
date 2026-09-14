import { CornerDownLeft, Search } from 'lucide-solid';
import {
  type Accessor,
  type Component,
  type ComponentProps,
  type JSX,
  Show,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
  splitProps,
  useContext,
} from 'solid-js';
import { Listbox, ListboxItem } from './Listbox';
import { Separator } from './Separator';
import { cn } from '../lib/cn';
import { menuShortcutClass } from './menu-styles';

interface CommandItemRecord {
  id: string;
  value: string;
  label: string;
  keywords?: string;
  hint?: string;
  icon?: JSX.Element;
  disabled?: boolean;
  groupId?: string;
  onSelect?: () => void;
}

interface CommandGroupRecord {
  id: string;
  heading?: string;
}

interface CommandInputNavigation {
  focusedValue: Accessor<string | undefined>;
  moveFocus: (delta: number) => void;
  moveFocusTo: (value: string) => void;
  selectFocused: () => void;
}

interface CommandContextValue {
  search: Accessor<string>;
  setSearch: (value: string) => void;
  registerItem: (item: CommandItemRecord) => void;
  unregisterItem: (id: string) => void;
  registerGroup: (group: CommandGroupRecord) => void;
  unregisterGroup: (id: string) => void;
  emptyContent: Accessor<JSX.Element | undefined>;
  setEmptyContent: (content: JSX.Element | undefined) => void;
  visibleItems: Accessor<CommandItemRecord[]>;
  groups: Accessor<CommandGroupRecord[]>;
  listboxRef: Accessor<HTMLElement | undefined>;
  setListboxRef: (element: HTMLElement | undefined) => void;
  inputNavigation: Accessor<CommandInputNavigation | undefined>;
  setInputNavigation: (navigation: CommandInputNavigation | undefined) => void;
}

const CommandContext = createContext<CommandContextValue>();
const CommandGroupContext = createContext<{ groupId: string }>();

function useCommandContext() {
  const context = useContext(CommandContext);
  if (!context) {
    throw new Error('Command compound components must be used within <Command>.');
  }
  return context;
}

function matchesQuery(item: CommandItemRecord, query: string) {
  if (!query) return true;
  const haystack = `${item.label} ${item.value} ${item.keywords ?? ''}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function wrapIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

function activateHighlightedItem(context: CommandContextValue) {
  const listbox = context.listboxRef();
  if (!listbox) return;

  const highlighted = listbox.querySelector<HTMLElement>('[role="option"][data-highlighted]');
  if (!highlighted) return;

  const item = context
    .visibleItems()
    .find((candidate) => candidate.value === highlighted.id || candidate.id === highlighted.id);
  if (!item || item.disabled) return;
  item.onSelect?.();
}

/** 命令面板根容器：管理搜索词与选项注册表。 */
export const Command: Component<
  ComponentProps<'div'> & {
    /** 为 false 时清空搜索词（供 Dialog 命令面板复用）。 */
    open?: boolean;
  }
> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'open']);
  const [search, setSearch] = createSignal('');
  const [items, setItems] = createSignal<Record<string, CommandItemRecord>>({});
  const [groups, setGroups] = createSignal<Record<string, CommandGroupRecord>>({});
  const [emptyContent, setEmptyContent] = createSignal<JSX.Element | undefined>();
  const [listboxRef, setListboxRef] = createSignal<HTMLElement | undefined>();
  const [inputNavigation, setInputNavigation] = createSignal<CommandInputNavigation | undefined>();

  const visibleItems = createMemo(() =>
    Object.values(items()).filter((item) => matchesQuery(item, search())),
  );

  const groupList = createMemo(() => Object.values(groups()));

  createEffect(() => {
    if (local.open === false) setSearch('');
  });

  const value: CommandContextValue = {
    search,
    setSearch,
    registerItem: (item) => setItems((current) => ({ ...current, [item.id]: item })),
    unregisterItem: (id) =>
      setItems((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      }),
    registerGroup: (group) => setGroups((current) => ({ ...current, [group.id]: group })),
    unregisterGroup: (id) =>
      setGroups((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      }),
    emptyContent,
    setEmptyContent,
    visibleItems,
    groups: groupList,
    listboxRef,
    setListboxRef,
    inputNavigation,
    setInputNavigation,
  };

  return (
    <CommandContext.Provider value={value}>
      <div
        data-slot="command"
        class={cn(
          'flex w-full flex-col overflow-hidden rounded-8 border border-border-subtle bg-surface text-text-primary outline-none',
          local.class,
        )}
        {...rest}
      >
        {local.children}
      </div>
    </CommandContext.Provider>
  );
};

/** 搜索输入：左侧搜索图标，更新 Command 过滤词。 */
export function CommandInput(props: ComponentProps<'input'> & { wrapperClass?: string }) {
  const [local, input] = splitProps(props, ['class', 'wrapperClass', 'value', 'onInput', 'onKeyDown']);
  const context = useCommandContext();

  return (
    <div
      data-slot="command-input-wrapper"
      class={cn(
        'flex items-center gap-8 border-b border-border-subtle px-12',
        local.wrapperClass,
      )}
    >
      <Search size={14} class="shrink-0 text-content-muted" strokeWidth={1.8} aria-hidden="true" />
      <input
        {...input}
        type="text"
        role="searchbox"
        inputMode="search"
        enterkeyhint="search"
        data-slot="command-input"
        value={typeof local.value === 'string' ? local.value : context.search()}
        onInput={(event) => {
          context.setSearch(event.currentTarget.value);
          if (typeof local.onInput === 'function') {
            local.onInput(event);
          }
        }}
        onKeyDown={(event) => {
          const navigation = context.inputNavigation();
          if (navigation) {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              navigation.moveFocus(1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              navigation.moveFocus(-1);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              navigation.selectFocused();
            } else if (event.key === 'Home') {
              event.preventDefault();
              const first = context.visibleItems()[0];
              if (first) navigation.moveFocusTo(first.value);
            } else if (event.key === 'End') {
              event.preventDefault();
              const visible = context.visibleItems();
              const last = visible[visible.length - 1];
              if (last) navigation.moveFocusTo(last.value);
            }
          } else if (event.key === 'Enter' && context.listboxRef()) {
            event.preventDefault();
            activateHighlightedItem(context);
          }

          if (typeof local.onKeyDown === 'function') {
            local.onKeyDown(event);
          }
        }}
        class={cn(
          'box-border h-36 min-w-0 flex-1 border-0 bg-transparent text-13 text-text-primary outline-none',
          'placeholder:text-text-faint',
          local.class,
        )}
      />
    </div>
  );
}

type CommandListProps = ComponentProps<'div'> & {
  /** 首尾循环导航；默认 false，命令面板传 true。 */
  shouldFocusWrap?: boolean;
  /** 键盘导航包含 disabled 项；默认 false，命令面板传 true。 */
  navigateDisabledItems?: boolean;
  /** 打开时聚焦首项；默认 false，命令面板传 true。 */
  autoFocusFirst?: boolean;
  /** 由 CommandInput 驱动焦点环；默认随 autoFocusFirst / shouldFocusWrap 启用。 */
  coordinateInput?: boolean;
};

/** 可滚动结果列表：Kobalte Listbox 承担键盘导航。 */
export function CommandList(props: CommandListProps) {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'shouldFocusWrap',
    'navigateDisabledItems',
    'autoFocusFirst',
    'coordinateInput',
  ]);
  const context = useCommandContext();
  const options = () => context.visibleItems();
  const coordinate = () =>
    local.coordinateInput ?? Boolean(local.autoFocusFirst || local.shouldFocusWrap);
  const [focusedValue, setFocusedValue] = createSignal<string | undefined>();

  const moveFocus = (delta: number) => {
    const visible = options();
    if (visible.length === 0) return;
    const currentIndex = visible.findIndex((item) => item.value === focusedValue());
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = local.shouldFocusWrap
      ? wrapIndex(baseIndex + delta, visible.length)
      : Math.min(Math.max(baseIndex + delta, 0), visible.length - 1);
    setFocusedValue(visible[nextIndex]?.value);
  };

  createEffect(() => {
    context.search();
    const visible = options();
    setFocusedValue(visible[0]?.value);
  });

  createEffect(() => {
    if (!coordinate()) return;
    const value = focusedValue();
    if (!value) return;
    const node = context.listboxRef()?.querySelector<HTMLElement>(`#${CSS.escape(value)}`);
    node?.scrollIntoView?.({ block: 'nearest' });
  });

  onMount(() => {
    if (!coordinate()) return;
    context.setInputNavigation({
      focusedValue,
      moveFocus,
      moveFocusTo: setFocusedValue,
      selectFocused: () => {
        const item = options().find((candidate) => candidate.value === focusedValue());
        if (!item || item.disabled) return;
        item.onSelect?.();
      },
    });
  });
  onCleanup(() => context.setInputNavigation(undefined));

  return (
    <div
      data-slot="command-list"
      class={cn('max-h-(--container-search-results) overflow-y-auto p-4', local.class)}
      {...rest}
    >
      <Show when={options().length === 0}>
        {context.emptyContent() ?? (
          <div data-slot="command-empty" class="px-12 py-10 text-center text-13 text-text-muted">
            No results found.
          </div>
        )}
      </Show>
      <Listbox
        ref={(element) => context.setListboxRef(element)}
        options={options()}
        optionValue="id"
        optionTextValue="label"
        optionDisabled={local.navigateDisabledItems ? () => false : 'disabled'}
        shouldUseVirtualFocus={!coordinate()}
        shouldFocusWrap={local.shouldFocusWrap}
        autoFocus={!coordinate() && local.autoFocusFirst ? 'first' : undefined}
        aria-label="Command results"
        renderItem={(item) => {
          const record = item.rawValue as CommandItemRecord;
          const isFocused = () => coordinate() && focusedValue() === record.value;
          return (
            <ListboxItem
              id={record.value}
              item={item}
              recipe="search"
              aria-disabled={record.disabled || undefined}
              aria-selected={coordinate() ? isFocused() : undefined}
              class={cn(
                'group text-12',
                isFocused() && 'bg-interaction-hover text-content-primary',
                record.disabled && 'cursor-not-allowed opacity-45',
              )}
              onPointerMove={() => {
                if (coordinate()) setFocusedValue(record.value);
              }}
              onClick={() => {
                if (!record.disabled) record.onSelect?.();
              }}
            >
              <span class="flex w-full items-center gap-10">
                <Show when={record.icon}>
                  <span class="shrink-0 text-content-muted" aria-hidden="true">
                    {record.icon}
                  </span>
                </Show>
                <span class="min-w-0 flex-1 truncate font-500">{record.label}</span>
                <Show when={record.hint}>
                  <span class="shrink-0 text-11 text-content-muted">{record.hint}</span>
                </Show>
                <CornerDownLeft
                  size={14}
                  class={cn(
                    'shrink-0 text-content-muted',
                    isFocused() ? 'inline' : 'hidden',
                  )}
                  aria-hidden="true"
                />
              </span>
            </ListboxItem>
          );
        }}
      />
      {local.children}
    </div>
  );
}

/** 无结果时展示：由 CommandList 读取注册内容。 */
export function CommandEmpty(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class', 'children']);
  const context = useCommandContext();

  onMount(() => {
    context.setEmptyContent(
      <div
        data-slot="command-empty"
        class={cn('px-12 py-10 text-center text-13 text-text-muted', local.class)}
        {...rest}
      >
        {local.children}
      </div>,
    );
  });
  onCleanup(() => context.setEmptyContent(undefined));

  return null;
}

/** 选项分组：子 CommandItem 自动归入本组。 */
export function CommandGroup(props: ComponentProps<'div'> & { heading?: string }) {
  const [local, rest] = splitProps(props, ['class', 'heading', 'children']);
  const context = useCommandContext();
  const groupId = createUniqueId();

  onMount(() => context.registerGroup({ id: groupId, heading: local.heading }));
  onCleanup(() => context.unregisterGroup(groupId));

  return (
    <CommandGroupContext.Provider value={{ groupId }}>
      <div data-slot="command-group" class={cn('flex flex-col gap-2', local.class)} {...rest}>
        <Show when={local.heading}>
          <div class="px-12 py-6 text-11 font-600 text-text-muted">{local.heading}</div>
        </Show>
        {local.children}
      </div>
    </CommandGroupContext.Provider>
  );
}

/** 可过滤命令项：注册到 Command 根，由 CommandList 统一渲染。 */
export function CommandItem(
  props: ComponentProps<'div'> & {
    id?: string;
    value: string;
    keywords?: string;
    hint?: string;
    icon?: JSX.Element;
    disabled?: boolean;
    onSelect?: () => void;
  },
) {
  const [local] = splitProps(props, [
    'class',
    'id',
    'value',
    'keywords',
    'hint',
    'icon',
    'disabled',
    'onSelect',
    'children',
  ]);
  const context = useCommandContext();
  const group = useContext(CommandGroupContext);
  const generatedId = createUniqueId();
  const resolvedId = () => local.id ?? generatedId;
  const label = () => {
    const child = local.children;
    return typeof child === 'string' || typeof child === 'number' ? String(child) : local.value;
  };

  context.registerItem({
    id: resolvedId(),
    value: local.value,
    label: label(),
    keywords: local.keywords,
    hint: local.hint,
    icon: local.icon,
    disabled: local.disabled,
    onSelect: local.onSelect,
    groupId: group?.groupId,
  });
  onCleanup(() => context.unregisterItem(resolvedId()));

  return null;
}

/** 分组或项之间的分隔线。 */
export function CommandSeparator(props: ComponentProps<typeof Separator>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <Separator
      data-slot="command-separator"
      class={cn('-mx-4 my-4', local.class)}
      {...rest}
    />
  );
}

/** 命令项右侧快捷键提示。 */
export function CommandShortcut(props: ComponentProps<'span'>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <span
      data-slot="command-shortcut"
      class={cn(menuShortcutClass, local.class)}
      {...rest}
    />
  );
}

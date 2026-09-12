import { Search } from 'lucide-solid';
import {
  type Accessor,
  type Component,
  type ComponentProps,
  type JSX,
  Show,
  createContext,
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
  disabled?: boolean;
  groupId?: string;
  onSelect?: () => void;
}

interface CommandGroupRecord {
  id: string;
  heading?: string;
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

/** 命令面板根容器：管理搜索词与选项注册表。 */
export const Command: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  const [search, setSearch] = createSignal('');
  const [items, setItems] = createSignal<Record<string, CommandItemRecord>>({});
  const [groups, setGroups] = createSignal<Record<string, CommandGroupRecord>>({});
  const [emptyContent, setEmptyContent] = createSignal<JSX.Element | undefined>();

  const visibleItems = createMemo(() =>
    Object.values(items()).filter((item) => matchesQuery(item, search())),
  );

  const groupList = createMemo(() => Object.values(groups()));

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
  };

  return (
    <CommandContext.Provider value={value}>
      <div
        data-slot="command"
        class={cn(
          'flex w-full flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface text-text-primary shadow-popover',
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
  const [local, input] = splitProps(props, ['class', 'wrapperClass', 'value', 'onInput']);
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
        type="search"
        role="searchbox"
        data-slot="command-input"
        value={typeof local.value === 'string' ? local.value : context.search()}
        onInput={(event) => {
          context.setSearch(event.currentTarget.value);
          if (typeof local.onInput === 'function') {
            local.onInput(event);
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

/** 可滚动结果列表：Kobalte Listbox 承担键盘导航。 */
export function CommandList(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class', 'children']);
  const context = useCommandContext();
  const options = () => context.visibleItems();

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
        options={options()}
        optionValue="id"
        optionTextValue="label"
        optionDisabled="disabled"
        shouldUseVirtualFocus
        aria-label="Command results"
        renderItem={(item) => (
          <ListboxItem
            item={item}
            recipe="search"
            onClick={() => item.rawValue.onSelect?.()}
          >
            {item.rawValue.label}
          </ListboxItem>
        )}
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
    value: string;
    keywords?: string;
    disabled?: boolean;
    onSelect?: () => void;
  },
) {
  const [local] = splitProps(props, ['class', 'value', 'keywords', 'disabled', 'onSelect', 'children']);
  const context = useCommandContext();
  const group = useContext(CommandGroupContext);
  const itemId = createUniqueId();
  const label = () => {
    const child = local.children;
    return typeof child === 'string' || typeof child === 'number' ? String(child) : local.value;
  };

  context.registerItem({
    id: itemId,
    value: local.value,
    label: label(),
    keywords: local.keywords,
    disabled: local.disabled,
    onSelect: local.onSelect,
    groupId: group?.groupId,
  });
  onCleanup(() => context.unregisterItem(itemId));

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

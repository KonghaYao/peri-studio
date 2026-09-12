import { Box, SlidersHorizontal } from 'lucide-solid';
import { For, Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';

export type SlashKind = 'command' | 'skill' | 'mcp_skill';

export type SlashMenuItem = {
  name: string;
  description: string;
  kind?: SlashKind;
  accent?: boolean;
  variant?: 'default' | 'plan' | 'plugin';
  dividerAfter?: boolean;
};

export type SlashMenuProps = {
  items: SlashMenuItem[];
  activeIndex?: number;
  class?: string;
};

export type SlashMenuShellProps = {
  class?: string;
  children: JSX.Element;
  'data-slot'?: string;
  'data-testid'?: string;
};

export type SlashMenuOptionContentProps = {
  item: SlashMenuItem;
  namePrefix?: string;
};

export type SlashMenuOptionProps = SlashMenuOptionContentProps & {
  active?: boolean;
  class?: string;
};

function slashIconClass(item: SlashMenuItem) {
  if (item.variant === 'plan' || item.kind === 'skill') {
    return cn(item.accent || item.kind === 'skill' ? 'text-warning-solid' : 'text-content-muted');
  }
  return 'text-content-muted';
}

function SlashIcon(props: { item: SlashMenuItem }) {
  if (props.item.variant === 'plan' || props.item.kind === 'skill') {
    return <SlidersHorizontal size={15} strokeWidth={1.7} class={slashIconClass(props.item)} />;
  }
  return <Box size={15} strokeWidth={1.7} class="text-content-muted" />;
}

function slashNameClass(item: SlashMenuItem) {
  return cn(
    'min-w-0 truncate text-13 font-medium leading-snug',
    item.accent || item.kind === 'skill' ? 'text-warning-strong' : 'text-content-primary',
  );
}

/** Slash 菜单行内容：图标 + 命令名 + 说明列。 */
export const SlashMenuOptionContent: Component<SlashMenuOptionContentProps> = (props) => {
  const prefix = () => props.namePrefix ?? '';
  const displayName = () => `${prefix()}${props.item.name}`;

  return (
    <div class="grid w-full min-w-0 grid-cols-slash-menu items-center gap-x-10">
      <span class="grid size-16 shrink-0 place-items-center">
        <SlashIcon item={props.item} />
      </span>
      <span class={slashNameClass(props.item)} title={displayName()}>
        {displayName()}
      </span>
      <Show when={props.item.description}>
        <span class="min-w-0 truncate text-13 leading-snug text-content-muted" title={props.item.description}>
          {props.item.description}
        </span>
      </Show>
    </div>
  );
};

/** Slash 菜单选项表面（独立 listbox 模式）。 */
export const SlashMenuOption: Component<SlashMenuOptionProps> = (props) => {
  const [local, rest] = splitProps(props, ['item', 'active', 'class', 'namePrefix']);

  return (
    <div
      role="option"
      aria-selected={local.active}
      class={cn(
        'mx-6 cursor-pointer rounded-lg px-10 py-6 transition-colors duration-(--duration-fast)',
        local.active ? 'bg-sidebar-selected' : 'hover:bg-interaction-hover',
        local.class,
      )}
      {...rest}
    >
      <SlashMenuOptionContent item={local.item} namePrefix={local.namePrefix} />
    </div>
  );
};

export const SlashMenuDivider: Component = () => (
  <div class="mx-12 my-4 border-t border-border-subtle" role="presentation" />
);

export const SlashMenuShell: Component<SlashMenuShellProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'data-slot', 'data-testid']);

  return (
    <div
      data-slot={local['data-slot'] ?? 'slash-menu'}
      data-testid={local['data-testid']}
      class={cn('overflow-hidden rounded-xl border border-border-subtle bg-surface-overlay', local.class)}
      {...rest}
    >
      {local.children}
    </div>
  );
};

/** Composer slash 面板：图标 + 命令名（省略）+ 左对齐说明列；分组分隔线。 */
export const SlashMenu: Component<SlashMenuProps> = (props) => {
  const [local] = splitProps(props, ['items', 'activeIndex', 'class']);
  const active = () => local.activeIndex ?? 0;

  return (
    <SlashMenuShell class={local.class}>
      <ul class="max-h-240 overflow-auto py-6" role="listbox" aria-label="Slash commands">
        <For each={local.items}>
          {(item, index) => (
            <li class="list-none">
              <SlashMenuOption item={item} active={index() === active()} />
              <Show when={item.dividerAfter}>
                <SlashMenuDivider />
              </Show>
            </li>
          )}
        </For>
      </ul>
    </SlashMenuShell>
  );
};

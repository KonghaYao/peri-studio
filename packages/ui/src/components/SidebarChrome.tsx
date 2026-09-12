import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { Archive, MoreHorizontal, Pin, Plus } from 'lucide-solid';
import { cn } from '../lib/cn';
import { ButtonGroup, buttonGroupItemClass } from './ButtonGroup';
import { IconButton } from './Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { RowAccessorySlot } from './RowAccessorySlot';

export function SectionHeader(props: { title: string; icon?: JSX.Element; children?: JSX.Element }) {
  return (
    <div class="flex items-center gap-4 px-10 pb-4 pt-12">
      <span class="flex min-w-0 flex-1 items-center gap-6 text-12 text-content-muted">
        <Show when={props.icon}>
          <span class="grid size-16 shrink-0 place-items-center text-content-faint">{props.icon}</span>
        </Show>
        {props.title}
      </span>
      {props.children}
    </div>
  );
}

export function NavAction(props: {
  icon: JSX.Element;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      class="flex w-full min-h-36 items-center gap-10 rounded-md px-10 text-left text-13 text-content-primary transition-colors duration-(--duration-fast) hover:bg-interaction-hover disabled:cursor-not-allowed disabled:opacity-50"
      onClick={props.onClick}
      disabled={props.disabled}
    >
      <span class="grid size-16 shrink-0 place-items-center text-content-muted">{props.icon}</span>
      {props.label}
    </button>
  );
}

export type SidebarChromeMenuItem = {
  id: string;
  label: string;
  icon?: JSX.Element;
  disabled?: boolean;
  danger?: boolean;
  suffix?: string;
};

function SidebarChromeMenuItems(props: {
  items: SidebarChromeMenuItem[];
  onSelect?: (id: string) => void;
}) {
  return (
    <For each={props.items}>
      {(item) => (
        <DropdownMenuItem
          disabled={item.disabled}
          class={item.danger ? 'text-danger' : undefined}
          onSelect={() => props.onSelect?.(item.id)}
        >
          {item.icon}
          {item.label}
          <Show when={item.suffix}>
            <span class="ml-auto text-11 text-content-muted">{item.suffix}</span>
          </Show>
        </DropdownMenuItem>
      )}
    </For>
  );
}

/** 侧栏顶部导航：左侧主操作 + 右侧更多菜单。 */
export function SidebarNavBar(props: {
  children: JSX.Element;
  menuItems: SidebarChromeMenuItem[];
  onMenuSelect?: (id: string) => void;
  moreLabel?: string;
}) {
  return (
    <div class="sidebar-nav flex items-start gap-4">
      <div class="flex min-w-0 flex-1 flex-col">{props.children}</div>
      <DropdownMenu placement="bottom-end">
        <DropdownMenuTrigger
          as={IconButton}
          size="sm"
          showTooltip={false}
          label={props.moreLabel ?? 'More'}
          class="sidebar-nav-more mt-1 size-36 shrink-0 text-content-muted"
        >
          <MoreHorizontal size={16} strokeWidth={1.7} />
        </DropdownMenuTrigger>
        <DropdownMenuContent class="ui-menu min-w-180" aria-label={props.moreLabel ?? 'More'}>
          <SidebarChromeMenuItems items={props.menuItems} onSelect={props.onMenuSelect} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Session 行右侧：live/unread 指示 + Pin / Archive / More 浮动按钮组。 */
export function SessionRowAccessory(props: {
  live?: boolean;
  liveLabel?: string;
  unread?: boolean;
  pinned?: boolean;
  readOnly?: boolean;
  actionsVisible?: boolean;
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
  onTogglePin?: () => void;
  onPin?: () => void;
  onArchive?: () => void;
  onMore?: () => void;
  menuId?: string;
  menuLabel?: string;
  menuItems?: SidebarChromeMenuItem[];
  onMenuSelect?: (id: string) => void;
}) {
  const actionsVisible = () => props.menuOpen ?? props.actionsVisible;
  const togglePin = () => props.onTogglePin?.() ?? props.onPin?.();

  const moreControl = () => {
    if (props.menuItems) {
      return (
        <DropdownMenu
          open={props.menuOpen}
          onOpenChange={props.onMenuOpenChange}
          placement="bottom-end"
        >
          <DropdownMenuTrigger
            as={IconButton}
            size="sm"
            showTooltip={false}
            data-testid="session-menu"
            class={cn(buttonGroupItemClass, 'session-menu data-[expanded]:text-content-primary')}
            label="Session actions"
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal size={14} strokeWidth={1.7} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            id={props.menuId}
            aria-label={props.menuLabel}
            class="ui-menu"
          >
            <SidebarChromeMenuItems items={props.menuItems} onSelect={props.onMenuSelect} />
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    return (
      <IconButton
        size="sm"
        showTooltip={false}
        label="Session actions"
        class={cn(buttonGroupItemClass, 'session-menu')}
        onClick={(event) => {
          event.stopPropagation();
          props.onMore?.();
        }}
      >
        <MoreHorizontal size={14} strokeWidth={1.7} />
      </IconButton>
    );
  };

  return (
    <RowAccessorySlot
      group="row"
      actionsVisible={actionsVisible()}
      meta={(
        <span class="ui-row-accessory-meta flex items-center gap-6 bg-surface pl-8 tabular-nums text-11 text-content-muted">
          <Show when={props.live}>
            <span
              data-testid="session-loading-wave"
              class="session-loading-wave relative flex size-6"
              role="status"
              aria-label={props.liveLabel}
            >
              <span
                data-testid="session-loading-wave-halo"
                class="session-loading-wave__halo absolute inline-flex size-full animate-ping rounded-full bg-success-solid opacity-30 motion-reduce:animate-none"
                aria-hidden="true"
              />
              <span
                data-testid="session-loading-wave-core"
                class="session-loading-wave__core relative inline-flex size-6 rounded-full bg-success-solid"
                aria-hidden="true"
              />
            </span>
          </Show>
          <Show when={props.unread}>
            <span class="size-6 rounded-full bg-accent-solid" aria-label="Unread" />
          </Show>
        </span>
      )}
      actions={(
        <ButtonGroup aria-label="Session actions" class="h-full">
          <IconButton
            size="sm"
            showTooltip={false}
            label={props.pinned ? 'Unpin session' : 'Pin session'}
            class={cn(buttonGroupItemClass, props.pinned && 'text-accent-solid')}
            onClick={(event) => {
              event.stopPropagation();
              togglePin();
            }}
          >
            <Pin size={14} strokeWidth={1.7} />
          </IconButton>
          <IconButton
            size="sm"
            showTooltip={false}
            label="Archive session"
            disabled={props.readOnly}
            class={cn(buttonGroupItemClass, 'text-content-muted hover:text-danger-solid disabled:opacity-45')}
            onClick={(event) => {
              event.stopPropagation();
              props.onArchive?.();
            }}
          >
            <Archive size={14} strokeWidth={1.7} />
          </IconButton>
          {moreControl()}
        </ButtonGroup>
      )}
    />
  );
}

/** 项目行右侧：会话计数 + More / New session 浮动按钮组。 */
export function ProjectRowAccessory(props: {
  count?: number;
  actionsVisible?: boolean;
  children?: JSX.Element;
  menuItems?: SidebarChromeMenuItem[];
  onMenuSelect?: (id: string) => void;
  onMore?: () => void;
  onCreateSession?: () => void;
}) {
  const builtInActions = () => {
    const moreButton = (
      <IconButton
        size="sm"
        showTooltip={false}
        label="Project actions"
        class={cn(buttonGroupItemClass, 'project-menu-trigger')}
        onClick={(event) => {
          if (props.menuItems) return;
          event.stopPropagation();
          props.onMore?.();
        }}
      >
        <MoreHorizontal size={14} strokeWidth={1.7} />
      </IconButton>
    );

    return (
      <ProjectRowActionGroup>
        {props.menuItems ? (
          <DropdownMenu placement="bottom-end">
            <DropdownMenuTrigger as="span" class="inline-flex">{moreButton}</DropdownMenuTrigger>
            <DropdownMenuContent aria-label="Project actions">
              <SidebarChromeMenuItems items={props.menuItems} onSelect={props.onMenuSelect} />
            </DropdownMenuContent>
          </DropdownMenu>
        ) : moreButton}
        <IconButton
          size="sm"
          showTooltip={false}
          label="New session"
          class={cn(buttonGroupItemClass, 'row-create-action')}
          onClick={(event) => {
            event.stopPropagation();
            props.onCreateSession?.();
          }}
        >
          <Plus size={14} strokeWidth={1.7} />
        </IconButton>
      </ProjectRowActionGroup>
    );
  };

  return (
    <RowAccessorySlot
      group="workspace"
      actionsVisible={props.actionsVisible}
      meta={(
        <Show when={(props.count ?? 0) > 0}>
          <span class="ui-row-accessory-meta bg-surface pl-8 tabular-nums text-11 text-content-muted" aria-hidden="true">{props.count}</span>
        </Show>
      )}
      actions={props.children ?? builtInActions()}
    />
  );
}

export function ProjectRowActionGroup(props: { 'aria-label'?: string; children: JSX.Element }) {
  return (
    <ButtonGroup aria-label={props['aria-label'] ?? 'Project actions'} class="h-full">
      {props.children}
    </ButtonGroup>
  );
}

import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { cn } from '@peri/ui';
import { Archive, MoreHorizontal, Pin } from 'lucide-solid';
import { ButtonGroup, buttonGroupItemClass, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, IconButton } from '@peri/ui';

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

export function NavAction(props: { icon: JSX.Element; label: string; onClick?: () => void; disabled?: boolean }) {
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

/** 侧栏顶部导航：左侧主操作 + 右侧更多菜单。 */
export function SidebarNavBar(props: { children: JSX.Element; more: JSX.Element; moreLabel?: string }) {
  return (
    <div class="sidebar-nav flex items-start gap-4">
      <div class="flex min-w-0 flex-1 flex-col">{props.children}</div>
      <DropdownMenu placement="bottom-end">
        <DropdownMenuTrigger
          as={IconButton}
          size="sm"
          showTooltip={false}
          label={props.moreLabel ?? 'More'}
          class="sidebar-nav-more mt-1 size-32 shrink-0 text-content-muted"
        >
          <MoreHorizontal size={16} strokeWidth={1.7} />
        </DropdownMenuTrigger>
        <DropdownMenuContent class="ui-menu min-w-180" aria-label={props.moreLabel ?? 'More'}>
          {props.more}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

type RowAccessorySlotProps = {
  group: 'row' | 'workspace';
  meta: JSX.Element;
  actions: JSX.Element;
  actionsVisible?: boolean;
  class?: string;
};

/** 侧栏行右侧浮动槽（对齐 ui-sandbox RowAccessorySlot）。 */
export function RowAccessorySlot(props: RowAccessorySlotProps) {
  const actionsVisible = () => props.actionsVisible;
  const rowGroup = props.group === 'row';
  return (
    <div
      class={cn(
        'row-accessory-slot pointer-events-none absolute top-1/2 z-40 h-24 -translate-y-1/2',
        rowGroup ? 'right-4 min-w-72' : 'right-4 min-w-48',
        props.class,
      )}
    >
      <span
        class={cn(
          'row-accessory-slot__meta absolute inset-0 flex items-center justify-end transition-opacity duration-(--duration-fast)',
          rowGroup
            ? 'group-hover/row:opacity-0 group-focus-within/row:opacity-0'
            : 'group-hover/workspace:opacity-0 group-focus-within/workspace:opacity-0',
          'pointer-coarse:opacity-0',
          actionsVisible() && 'opacity-0',
        )}
      >
        {props.meta}
      </span>
      <div
        class={cn(
          'row-accessory-slot__actions absolute inset-0 flex items-center justify-end opacity-0 transition-opacity duration-(--duration-fast)',
          rowGroup
            ? 'group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100'
            : 'group-hover/workspace:pointer-events-auto group-hover/workspace:opacity-100 group-focus-within/workspace:pointer-events-auto group-focus-within/workspace:opacity-100',
          'focus-within:pointer-events-auto focus-within:opacity-100',
          'pointer-coarse:pointer-events-auto pointer-coarse:opacity-100',
          actionsVisible() && 'pointer-events-auto opacity-100',
        )}
      >
        {props.actions}
      </div>
    </div>
  );
}

/** Session 行右侧：时间戳 + Pin / Archive / More 浮动按钮组（对齐 ui-sandbox SessionRowAccessory）。 */
export function SessionRowAccessory(props: {
  time: string;
  live?: boolean;
  liveLabel?: string;
  pinned?: boolean;
  readOnly?: boolean;
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
  onTogglePin?: () => void;
  onArchive?: () => void;
  menuId: string;
  menuLabel: string;
  menuContent: JSX.Element;
}) {
  return (
    <RowAccessorySlot
      group="row"
      actionsVisible={props.menuOpen}
      meta={(
        <span class="flex items-center gap-6 tabular-nums text-11 text-content-muted">
          <Show when={props.live}>
            <span data-testid="session-loading-wave" class="session-loading-wave relative flex size-6" role="status" aria-label={props.liveLabel}>
              <span data-testid="session-loading-wave-halo" class="session-loading-wave__halo absolute inline-flex size-full animate-ping rounded-full bg-success-solid opacity-30 motion-reduce:animate-none" aria-hidden="true" />
              <span data-testid="session-loading-wave-core" class="session-loading-wave__core relative inline-flex size-6 rounded-full bg-success-solid" aria-hidden="true" />
            </span>
          </Show>
          <span>{props.time}</span>
        </span>
      )}
      actions={(
        <ButtonGroup aria-label="Session actions">
          <IconButton
            size="sm"
            showTooltip={false}
            label={props.pinned ? 'Unpin session' : 'Pin session'}
            class={cn(buttonGroupItemClass, props.pinned && 'text-accent-solid')}
            onClick={(event) => {
              event.stopPropagation();
              props.onTogglePin?.();
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
          <DropdownMenu open={props.menuOpen} onOpenChange={props.onMenuOpenChange} placement="bottom-end">
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
            <DropdownMenuContent id={props.menuId} aria-label={props.menuLabel} class="ui-menu">
              {props.menuContent}
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
      )}
    />
  );
}

/** 项目行右侧：会话计数 + More / New session 浮动按钮组（对齐 ui-sandbox ProjectRowAccessory）。 */
export function ProjectRowAccessory(props: { count?: number; actionsVisible?: boolean; children: JSX.Element }) {
  return (
    <RowAccessorySlot
      group="workspace"
      actionsVisible={props.actionsVisible}
      meta={(
        <Show when={(props.count ?? 0) > 0}>
          <span class="tabular-nums text-11 text-content-muted" aria-hidden="true">{props.count}</span>
        </Show>
      )}
      actions={props.children}
    />
  );
}

export function ProjectRowActionGroup(props: { 'aria-label'?: string; children: JSX.Element }) {
  return (
    <ButtonGroup aria-label={props['aria-label'] ?? 'Project actions'}>
      {props.children}
    </ButtonGroup>
  );
}

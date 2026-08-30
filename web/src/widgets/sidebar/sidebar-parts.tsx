import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { cn } from '@/shared/lib/cn';
import { Archive, MoreHorizontal, Pin } from 'lucide-solid';
import { ButtonGroup, buttonGroupItemClass, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, IconButton } from '@/shared/ui';

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

type RowAccessorySlotProps = {
  group: 'row' | 'workspace';
  meta: JSX.Element;
  actions: JSX.Element;
  actionsVisible?: boolean;
  class?: string;
};

/** 侧栏行右侧浮动槽（对齐 ui-sandbox RowAccessorySlot）。 */
export function RowAccessorySlot(props: RowAccessorySlotProps) {
  const hoverGroup = () => (props.group === 'row' ? 'group-hover/row' : 'group-hover/workspace');
  const focusGroup = () => (props.group === 'row' ? 'group-focus-within/row' : 'group-focus-within/workspace');
  const actionsVisible = () => props.actionsVisible;
  return (
    <div
      class={cn(
        'row-accessory-slot pointer-events-none absolute right-4 top-1/2 z-1 h-24 min-w-48 -translate-y-1/2',
        props.class,
      )}
    >
      <span
        class={cn(
          'absolute inset-0 flex items-center justify-end transition-opacity duration-(--duration-fast)',
          `${hoverGroup()}:opacity-0 ${focusGroup()}:opacity-0 pointer-coarse:opacity-0`,
          actionsVisible() && 'opacity-0',
        )}
      >
        {props.meta}
      </span>
      <div
        class={cn(
          'absolute inset-0 flex items-center justify-end opacity-0 transition-opacity duration-(--duration-fast)',
          `${hoverGroup()}:pointer-events-auto ${hoverGroup()}:opacity-100`,
          `${focusGroup()}:pointer-events-auto ${focusGroup()}:opacity-100`,
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
            <span class="session-loading-wave relative flex size-6" role="status" aria-label={props.liveLabel}>
              <span class="session-loading-wave__halo absolute inline-flex size-full animate-ping rounded-full bg-success-solid opacity-30 motion-reduce:animate-none" aria-hidden="true" />
              <span class="session-loading-wave__core relative inline-flex size-6 rounded-full bg-success-solid" aria-hidden="true" />
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

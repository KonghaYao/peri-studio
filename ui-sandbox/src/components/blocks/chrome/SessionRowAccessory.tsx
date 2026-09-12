import { Show } from 'solid-js';
import { Archive, MoreHorizontal, Pin } from 'lucide-solid';
import { ButtonGroup, buttonGroupItemClass, IconButton } from '@/lib/catalog-ui';
import { cn } from '@/lib/catalog-ui';
import { RowAccessorySlot } from './RowAccessorySlot';

/** Session 行右侧：时间戳 + Pin / Archive / More 浮动按钮组。 */
export function SessionRowAccessory(props: {
  time: string;
  live?: boolean;
  unread?: boolean;
  pinned?: boolean;
  actionsVisible?: boolean;
  onPin?: () => void;
  onArchive?: () => void;
  onMore?: () => void;
}) {
  return (
    <RowAccessorySlot
      group="row"
      actionsVisible={props.actionsVisible}
      meta={(
        <span class="flex items-center gap-6 tabular-nums text-11 text-content-muted">
          <Show when={props.live}>
            <span class="relative flex size-6" aria-hidden="true">
              <span class="absolute inline-flex size-full animate-ping rounded-full bg-success-solid opacity-30" />
              <span class="relative inline-flex size-6 rounded-full bg-success-solid" />
            </span>
          </Show>
          <Show when={props.unread}>
            <span class="size-6 rounded-full bg-accent-solid" aria-label="Unread" />
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
              props.onPin?.();
            }}
          >
            <Pin size={14} strokeWidth={1.7} />
          </IconButton>
          <IconButton
            size="sm"
            showTooltip={false}
            label="Archive session"
            class={cn(buttonGroupItemClass, 'text-content-muted hover:text-danger-solid')}
            onClick={(event) => {
              event.stopPropagation();
              props.onArchive?.();
            }}
          >
            <Archive size={14} strokeWidth={1.7} />
          </IconButton>
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
        </ButtonGroup>
      )}
    />
  );
}

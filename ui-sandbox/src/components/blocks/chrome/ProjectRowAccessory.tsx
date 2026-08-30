import { Show } from 'solid-js';
import { MoreHorizontal, Plus } from 'lucide-solid';
import { ButtonGroup, buttonGroupItemClass, IconButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { RowAccessorySlot } from './RowAccessorySlot';

/** 项目行右侧：会话计数 + More / New session 浮动按钮组。 */
export function ProjectRowAccessory(props: {
  count?: number;
  actionsVisible?: boolean;
  onMore?: () => void;
  onCreateSession?: () => void;
}) {
  return (
    <RowAccessorySlot
      group="workspace"
      actionsVisible={props.actionsVisible}
      meta={(
        <Show when={(props.count ?? 0) > 0}>
          <span class="tabular-nums text-11 text-content-muted" aria-hidden="true">{props.count}</span>
        </Show>
      )}
      actions={(
        <ButtonGroup aria-label="Project actions">
          <IconButton
            size="sm"
            showTooltip={false}
            label="Project actions"
            class={cn(buttonGroupItemClass, 'project-menu-trigger')}
            onClick={(event) => {
              event.stopPropagation();
              props.onMore?.();
            }}
          >
            <MoreHorizontal size={14} strokeWidth={1.7} />
          </IconButton>
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
        </ButtonGroup>
      )}
    />
  );
}

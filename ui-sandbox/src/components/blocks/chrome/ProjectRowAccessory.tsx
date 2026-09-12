import { Show } from 'solid-js';
import { MoreHorizontal, Plus } from 'lucide-solid';
import { ButtonGroup, buttonGroupItemClass, DropdownMenu, IconButton, type MenuItem } from '@/lib/catalog-ui';
import { cn } from '@/lib/catalog-ui';
import { RowAccessorySlot } from './RowAccessorySlot';

/** 项目行右侧：会话计数 + More / New session 浮动按钮组。 */
export function ProjectRowAccessory(props: {
  count?: number;
  actionsVisible?: boolean;
  menuItems?: MenuItem[];
  onMenuSelect?: (id: string) => void;
  onMore?: () => void;
  onCreateSession?: () => void;
}) {
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
          {props.menuItems ? (
            <DropdownMenu
              label="Project actions"
              trigger={moreButton}
              items={props.menuItems}
              onSelect={(id) => props.onMenuSelect?.(id)}
            />
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
        </ButtonGroup>
      )}
    />
  );
}

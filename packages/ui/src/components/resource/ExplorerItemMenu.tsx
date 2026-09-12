import {
  Copy,
  FilePlus,
  FolderInput,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-solid';
import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { IconButton } from '../Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../dropdown-menu';

export type ExplorerMenuContext = 'file' | 'folder' | 'root';

export type ExplorerMenuAction =
  | 'new-file'
  | 'new-folder'
  | 'rename'
  | 'move'
  | 'copy-path'
  | 'delete';

export type ExplorerMenuItem = {
  id: ExplorerMenuAction;
  label: string;
  icon: JSX.Element;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
};

export function buildExplorerContextMenuItems(
  ctx: ExplorerMenuContext,
  options?: {
    mutationsDisabled?: boolean;
    newFileDisabled?: boolean;
    newFileDisabledReason?: string;
    disabledReason?: string;
  },
): ExplorerMenuItem[] {
  const mutationsDisabled = options?.mutationsDisabled ?? false;
  const newFileDisabled = options?.newFileDisabled ?? mutationsDisabled;
  const mutationTitle = mutationsDisabled ? options?.disabledReason : undefined;
  const newFileTitle = newFileDisabled ? (options?.newFileDisabledReason ?? options?.disabledReason) : undefined;
  const items: ExplorerMenuItem[] = [];

  if (ctx === 'folder' || ctx === 'root') {
    items.push(
      {
        id: 'new-file',
        label: 'New File',
        icon: <FilePlus size={14} />,
        disabled: newFileDisabled,
        title: newFileTitle,
      },
      {
        id: 'new-folder',
        label: 'New Folder',
        icon: <FolderPlus size={14} />,
        disabled: mutationsDisabled,
        title: mutationTitle,
      },
    );
  }
  if (ctx !== 'root') {
    items.push(
      {
        id: 'rename',
        label: 'Rename',
        icon: <Pencil size={14} />,
        disabled: mutationsDisabled,
        title: mutationTitle,
      },
      {
        id: 'move',
        label: 'Move to…',
        icon: <FolderInput size={14} />,
        disabled: mutationsDisabled,
        title: mutationTitle,
      },
      { id: 'copy-path', label: 'Copy Path', icon: <Copy size={14} /> },
      {
        id: 'delete',
        label: 'Delete',
        icon: <Trash2 size={14} />,
        danger: true,
        disabled: mutationsDisabled,
        title: mutationTitle,
      },
    );
  }
  return items;
}

export type ExplorerItemMenuProps = {
  context: ExplorerMenuContext;
  mutationsDisabled?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  newFileDisabled?: boolean;
  newFileDisabledReason?: string;
  trigger?: JSX.Element;
  onAction: (action: ExplorerMenuAction) => void;
  menuLabel?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function ExplorerMenuItemRow(props: {
  item: ExplorerMenuItem;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      disabled={props.item.disabled}
      title={props.item.title}
      class={cn(props.item.danger && 'text-danger')}
      onSelect={props.onSelect}
    >
      {props.item.icon}
      <span>{props.item.label}</span>
    </DropdownMenuItem>
  );
}

/** 行尾 More 或任意 trigger 的 Explorer 上下文菜单。 */
export const ExplorerItemMenu: Component<ExplorerItemMenuProps> = (props) => {
  const [local] = splitProps(props, [
    'context',
    'mutationsDisabled',
    'disabled',
    'disabledReason',
    'newFileDisabled',
    'newFileDisabledReason',
    'trigger',
    'onAction',
    'menuLabel',
    'open',
    'onOpenChange',
  ]);

  const mutationsDisabled = () => local.mutationsDisabled ?? local.disabled ?? false;
  const items = () => buildExplorerContextMenuItems(local.context, {
    mutationsDisabled: mutationsDisabled(),
    disabledReason: local.disabledReason,
    newFileDisabled: local.newFileDisabled,
    newFileDisabledReason: local.newFileDisabledReason,
  });
  const select = (action: ExplorerMenuAction) => () => local.onAction(action);

  return (
    <DropdownMenu placement="bottom-start" open={local.open} onOpenChange={local.onOpenChange}>
      <DropdownMenuTrigger as="span" class="inline-flex">
        {local.trigger ?? (
          <IconButton
            size="sm"
            label="More actions"
            showTooltip={false}
            class="opacity-0 group-hover/tree-row:opacity-100 focus-visible:opacity-100"
          >
            <MoreHorizontal size={14} />
          </IconButton>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent aria-label={local.menuLabel ?? 'Explorer item actions'}>
        <Show when={mutationsDisabled() && local.disabledReason}>
          <div class="max-w-(--container-menu-min) px-12 py-8 text-11 text-text-muted">{local.disabledReason}</div>
        </Show>
        <Show when={local.context !== 'file'}>
          <ExplorerMenuItemRow item={items().find((item) => item.id === 'new-file')!} onSelect={select('new-file')} />
          <ExplorerMenuItemRow item={items().find((item) => item.id === 'new-folder')!} onSelect={select('new-folder')} />
        </Show>
        <Show when={local.context !== 'root'}>
          <ExplorerMenuItemRow item={items().find((item) => item.id === 'rename')!} onSelect={select('rename')} />
          <ExplorerMenuItemRow item={items().find((item) => item.id === 'move')!} onSelect={select('move')} />
          <ExplorerMenuItemRow item={items().find((item) => item.id === 'copy-path')!} onSelect={select('copy-path')} />
          <DropdownMenuSeparator />
          <ExplorerMenuItemRow item={items().find((item) => item.id === 'delete')!} onSelect={select('delete')} />
        </Show>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

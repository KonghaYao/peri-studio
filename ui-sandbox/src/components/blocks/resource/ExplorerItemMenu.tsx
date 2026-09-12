import {
  Copy,
  FilePlus,
  FolderInput,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-solid';
import type { JSX } from 'solid-js';
import { DropdownMenu, type MenuItem } from '@/lib/catalog-ui';
import { IconButton } from '@/lib/catalog-ui';

export type ExplorerMenuContext = 'file' | 'folder' | 'root';

export type ExplorerMenuAction =
  | 'new-file'
  | 'new-folder'
  | 'rename'
  | 'move'
  | 'copy-path'
  | 'delete';

export function buildExplorerContextMenuItems(ctx: ExplorerMenuContext, options?: {
  mutationsDisabled?: boolean;
}): MenuItem[] {
  const disabled = options?.mutationsDisabled ?? false;
  const items: MenuItem[] = [];

  if (ctx === 'folder' || ctx === 'root') {
    items.push(
      { id: 'new-file', label: 'New File', icon: <FilePlus size={14} />, disabled },
      { id: 'new-folder', label: 'New Folder', icon: <FolderPlus size={14} />, disabled },
    );
  }
  if (ctx !== 'root') {
    items.push(
      { id: 'rename', label: 'Rename', icon: <Pencil size={14} />, disabled },
      { id: 'move', label: 'Move to…', icon: <FolderInput size={14} />, disabled },
      { id: 'copy-path', label: 'Copy Path', icon: <Copy size={14} /> },
      { id: 'delete', label: 'Delete', icon: <Trash2 size={14} />, danger: true, disabled },
    );
  }
  return items;
}

/** 行尾 More 或任意 trigger 的 Explorer 上下文菜单。 */
export function ExplorerItemMenu(props: {
  context: ExplorerMenuContext;
  mutationsDisabled?: boolean;
  trigger?: JSX.Element;
  onAction: (action: ExplorerMenuAction) => void;
  menuLabel?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const items = () => buildExplorerContextMenuItems(props.context, { mutationsDisabled: props.mutationsDisabled });

  return (
    <DropdownMenu
      label={props.menuLabel ?? 'Explorer item actions'}
      open={props.open}
      onOpenChange={props.onOpenChange}
      items={items()}
      onSelect={(id) => props.onAction(id as ExplorerMenuAction)}
      trigger={
        props.trigger ?? (
          <IconButton size="sm" label="More actions" showTooltip={false} class="opacity-0 group-hover/tree-row:opacity-100 focus-visible:opacity-100">
            <MoreHorizontal size={14} />
          </IconButton>
        )
      }
    />
  );
}

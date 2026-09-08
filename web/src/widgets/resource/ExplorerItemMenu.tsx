import { Copy, FilePlus, FolderInput, FolderPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-solid';
import type { JSX } from 'solid-js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from '@/shared/ui';

export type ExplorerMenuAction = 'new-file' | 'new-folder' | 'rename' | 'move' | 'copy-path' | 'delete';

export function ExplorerItemMenu(props: {
  context: 'file' | 'folder' | 'root';
  disabled: boolean;
  disabledReason: string;
  newFileDisabled?: boolean;
  newFileDisabledReason?: string;
  trigger?: JSX.Element;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onAction: (action: ExplorerMenuAction) => void;
}) {
  const mutationItem = (id: ExplorerMenuAction, label: string, icon: JSX.Element, danger = false) => {
    const disabled = id === 'new-file' ? (props.newFileDisabled ?? props.disabled) : props.disabled;
    const disabledReason = id === 'new-file' ? (props.newFileDisabledReason ?? props.disabledReason) : props.disabledReason;
    return (
      <DropdownMenuItem
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        class={danger ? 'text-danger' : undefined}
        onSelect={() => props.onAction(id)}
      >{icon}<span>{label}</span></DropdownMenuItem>
    );
  };
  return <DropdownMenu placement="bottom-start" open={props.open} onOpenChange={props.onOpenChange}>
    <DropdownMenuTrigger as="span" class="inline-flex">
      {props.trigger ?? <IconButton label="More actions" size="compact" showTooltip={false}><MoreHorizontal size={14} /></IconButton>}
    </DropdownMenuTrigger>
    <DropdownMenuContent aria-label="Explorer item actions">
      {props.disabled && <div class="max-w-(--container-menu-min) px-12 py-8 text-11 text-text-muted">{props.disabledReason}</div>}
      {props.context !== 'file' && mutationItem('new-file', 'New File', <FilePlus size={14} />)}
      {props.context !== 'file' && mutationItem('new-folder', 'New Folder', <FolderPlus size={14} />)}
      {props.context !== 'root' && mutationItem('rename', 'Rename', <Pencil size={14} />)}
      {props.context !== 'root' && mutationItem('move', 'Move to…', <FolderInput size={14} />)}
      {props.context !== 'root' && <DropdownMenuItem onSelect={() => props.onAction('copy-path')}><Copy size={14} /><span>Copy Path</span></DropdownMenuItem>}
      {props.context !== 'root' && <DropdownMenuSeparator />}
      {props.context !== 'root' && mutationItem('delete', 'Delete', <Trash2 size={14} />, true)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

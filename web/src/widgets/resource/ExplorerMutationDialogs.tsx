import { createMemo, createSignal } from 'solid-js';
import {
  ExplorerDeleteDialog as ExplorerDeleteDialogBase,
  ExplorerMoveDialog as ExplorerMoveDialogBase,
  type FileTreeNode,
} from '@peri/ui';
import { joinPath, parentPath } from '@/features/resource/fs-mutation-controller';

export type ExplorerEdit =
  | { mode: 'new-file' | 'new-folder'; parentPath: string }
  | { mode: 'rename'; node: FileTreeNode };

export function ExplorerMoveDialog(props: {
  node: FileTreeNode | null;
  onClose: () => void;
  onMove: (target: string) => void;
}) {
  const [error, setError] = createSignal<string | null>(null);
  const sourceName = createMemo(() => props.node?.name ?? '');
  const initialDestination = createMemo(() => (
    props.node ? joinPath(parentPath(props.node.path), props.node.name) : ''
  ));

  return (
    <ExplorerMoveDialogBase
      open={!!props.node}
      onOpenChange={(open) => {
        if (!open) {
          setError(null);
          props.onClose();
        }
      }}
      sourceName={sourceName()}
      initialDestination={initialDestination()}
      conflictMessage={error() ?? undefined}
      onConfirm={(target) => {
        const value = target.trim();
        if (!value || value.startsWith('/') || value.includes('\\') || value.split('/').some((part) => !part || part === '.' || part === '..')) {
          setError('Enter a workspace-relative destination.');
          return;
        }
        props.onMove(value);
      }}
    />
  );
}

export function ExplorerDeleteDialog(props: {
  node: FileTreeNode | null;
  onClose: () => void;
  onDelete: (recursive: boolean) => void;
}) {
  const kind = () => (props.node?.kind === 'folder' ? 'folder' : 'file');
  const recursive = () => props.node?.kind === 'folder';

  return (
    <ExplorerDeleteDialogBase
      open={!!props.node}
      onOpenChange={(open) => { if (!open) props.onClose(); }}
      name={props.node?.name ?? ''}
      kind={kind()}
      recursive={recursive()}
      onConfirm={() => props.onDelete(recursive())}
    />
  );
}

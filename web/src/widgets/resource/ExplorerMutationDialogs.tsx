import { createEffect, createSignal, Show } from 'solid-js';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, TextField, type FileTreeNode } from '@peri/ui';
import { joinPath, parentPath } from '@/features/resource/fs-mutation-controller';

export type ExplorerEdit =
  | { mode: 'new-file' | 'new-folder'; parentPath: string }
  | { mode: 'rename'; node: FileTreeNode };

export function ExplorerMoveDialog(props: {
  node: FileTreeNode | null;
  onClose: () => void;
  onMove: (target: string) => void;
}) {
  const [target, setTarget] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  createEffect(() => {
    const node = props.node;
    setTarget(node ? joinPath(parentPath(node.path), node.name) : '');
    setError(null);
  });
  const submit = () => {
    const value = target().trim();
    if (!value || value.startsWith('/') || value.includes('\\') || value.split('/').some((part) => !part || part === '.' || part === '..')) {
      setError('Enter a workspace-relative destination.');
      return;
    }
    props.onMove(value);
  };
  return <Dialog open={!!props.node} onOpenChange={(open) => { if (!open) props.onClose(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>Move item</DialogTitle></DialogHeader>
      <div class="grid gap-8 px-20 py-16">
        <DialogDescription>Move <strong>{props.node?.path}</strong> without replacing an existing item.</DialogDescription>
        <TextField aria-label="Destination path" value={target()} onInput={(event) => { setTarget(event.currentTarget.value); setError(null); }} />
        <Show when={error()}><span class="text-12 text-danger" role="alert">{error()}</span></Show>
      </div>
      <DialogFooter><Button variant="ghost" onClick={props.onClose}>Cancel</Button><Button onClick={submit}>Move</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function ExplorerDeleteDialog(props: {
  node: FileTreeNode | null;
  onClose: () => void;
  onDelete: (recursive: boolean) => void;
}) {
  const recursive = () => props.node?.kind === 'folder';
  return <Dialog open={!!props.node} onOpenChange={(open) => { if (!open) props.onClose(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>Delete permanently?</DialogTitle></DialogHeader>
      <div class="grid gap-8 px-20 py-16">
        <DialogDescription>
          {recursive()
            ? `Delete “${props.node?.path}” and all of its contents permanently? This cannot be undone.`
            : `Delete “${props.node?.path}” permanently? This cannot be undone.`}
        </DialogDescription>
      </div>
      <DialogFooter><Button variant="ghost" onClick={props.onClose}>Cancel</Button><Button variant="danger" onClick={() => props.onDelete(recursive())}>Delete Permanently</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

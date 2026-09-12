import { createSignal, Show } from 'solid-js';
import { Button, Dialog, DialogContent, DialogTitle, TextField } from '@peri/ui';

type BranchDialogMode = 'create' | 'rename';

export function GitGraphBranchDialog(props: {
  open: boolean;
  mode: BranchDialogMode;
  initialName?: string;
  title?: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = createSignal(props.initialName ?? '');

  const submit = () => {
    const name = value().trim();
    if (!name) return;
    props.onSubmit(name);
    props.onClose();
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent size="default" class="gap-12">
        <DialogTitle>{props.title ?? (props.mode === 'create' ? 'Create branch' : 'Rename branch')}</DialogTitle>
        <TextField
          label="Branch name"
          value={value()}
          onInput={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div class="flex justify-end gap-8">
          <Button variant="ghost" onClick={() => props.onClose()}>Cancel</Button>
          <Button onClick={submit}>{props.mode === 'create' ? 'Create' : 'Rename'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function GitGraphConfirmDialog(props: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Show when={props.open}>
      <Dialog open={props.open} onOpenChange={(open) => { if (!open) props.onClose(); }}>
        <DialogContent size="default" class="gap-12">
          <DialogTitle>{props.title}</DialogTitle>
          <p class="text-12 text-content-muted">{props.description}</p>
          <div class="flex justify-end gap-8">
            <Button variant="ghost" onClick={() => props.onClose()}>Cancel</Button>
            <Button variant="danger" onClick={() => { props.onConfirm(); props.onClose(); }}>
              {props.confirmLabel ?? 'Confirm'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Show>
  );
}

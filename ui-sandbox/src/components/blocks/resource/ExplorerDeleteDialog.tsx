import { Show } from 'solid-js';
import { Button, Dialog } from '@/lib/catalog-ui';

/** 永久删除确认（文件 / 空目录 / 非空目录 recursive）。 */
export function ExplorerDeleteDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  kind: 'file' | 'folder';
  recursive?: boolean;
  affectedCount?: number;
  busy?: boolean;
  onConfirm: () => void;
}) {
  const title = () => {
    if (props.kind === 'folder' && props.recursive) {
      return `Delete "${props.name}" and all contents?`;
    }
    return `Delete "${props.name}"?`;
  };

  const body = () => {
    if (props.kind === 'file') {
      return 'This file will be permanently deleted.';
    }
    if (props.recursive) {
      const count = props.affectedCount;
      if (count != null && count > 0) {
        return `This folder and ${count} item(s) inside will be permanently deleted. This cannot be undone.`;
      }
      return 'This folder and all contents will be permanently deleted. This cannot be undone.';
    }
    return 'This folder will be permanently deleted.';
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={title()}
      width="var(--container-dialog-default)"
      footer={
        <>
          <Button variant="default" disabled={props.busy} onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" busy={props.busy} onClick={props.onConfirm}>
            {props.busy ? 'Deleting…' : 'Delete'}
          </Button>
        </>
      }
    >
      <Show when={props.busy}>
        <p class="mb-2 text-12 text-content-muted" role="status">
          Deleting…
        </p>
      </Show>
      {body()}
    </Dialog>
  );
}

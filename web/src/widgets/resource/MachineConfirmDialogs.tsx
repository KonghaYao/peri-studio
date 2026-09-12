import { ConfirmDialog } from '@/widgets/shell/shared/ConfirmDialog';

interface ConfirmProps {
  open: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function MachineDisconnectConfirmDialog(props: ConfirmProps) {
  return (
    <ConfirmDialog
      open={props.open}
      onOpenChange={(open) => { if (!open && !props.busy) props.onCancel(); }}
      title="Disconnect tunnel"
      description="Agents on this computer keep running. Only the tunnel to this Peri will close."
      confirmLabel="Disconnect tunnel"
      confirmBusy={props.busy}
      cancelDisabled={props.busy}
      onCancel={props.onCancel}
      onConfirm={props.onConfirm}
    />
  );
}

export function MachineStopConfirmDialog(props: ConfirmProps) {
  return (
    <ConfirmDialog
      open={props.open}
      onOpenChange={(open) => { if (!open && !props.busy) props.onCancel(); }}
      title="Stop agents"
      description="This stops Peri Studio and agents on that computer. Conversations stay saved."
      confirmLabel="Stop agents"
      confirmBusy={props.busy}
      cancelDisabled={props.busy}
      onCancel={props.onCancel}
      onConfirm={props.onConfirm}
    />
  );
}

export function MachineRemoveConfirmDialog(props: ConfirmProps) {
  return (
    <ConfirmDialog
      open={props.open}
      onOpenChange={(open) => { if (!open && !props.busy) props.onCancel(); }}
      title="Remove from Peri"
      description="This removes the computer from Peri and revokes its access. Agents must be stopped first."
      confirmLabel="Remove from Peri"
      confirmBusy={props.busy}
      cancelDisabled={props.busy}
      onCancel={props.onCancel}
      onConfirm={props.onConfirm}
    />
  );
}

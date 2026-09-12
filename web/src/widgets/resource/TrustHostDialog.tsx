import { Show } from 'solid-js';
import { Button, CopyButton, Dialog, DialogContent } from '@peri/ui';
import { readOnly } from '@/features/auth/auth-state';
import { FormDialogShell } from '@/widgets/shell/shared/FormDialogShell';

interface TrustHostDialogProps {
  open: boolean;
  displayName: string;
  fingerprint: string;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onTrust: () => void;
  onCancel: () => void;
}

export function TrustHostDialog(props: TrustHostDialogProps) {
  const locked = () => readOnly() || props.busy;

  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>
    <DialogContent dismissible={!props.busy}>
      <Show when={readOnly()} fallback={
        <FormDialogShell
          title="Trust host"
          description="Verify this fingerprint matches the SSH host you intend to connect to."
        >
          <div class="flex items-start gap-8 rounded-12 border border-border-subtle bg-surface-muted px-12 py-10">
            <code class="min-w-0 flex-1 break-all font-mono text-11 leading-145 text-text-primary">{props.fingerprint}</code>
            <CopyButton text={props.fingerprint} label="Copy fingerprint" copiedLabel="Fingerprint copied" />
          </div>
          <p class="mt-12 mb-0 text-13 leading-155 text-text-secondary">This fingerprint is stored only for Peri Studio.</p>
          <div class="mt-20 flex justify-end gap-6">
            <Button type="button" variant="secondary" disabled={props.busy} onClick={props.onCancel}>Cancel</Button>
            <Button type="button" variant="primary" busy={props.busy} disabled={locked()} onClick={props.onTrust}>Trust</Button>
          </div>
        </FormDialogShell>
      }>
        <FormDialogShell
          title="Trust host"
          description="Waiting for the owner to trust this host."
        >
          <code class="block break-all font-mono text-11 leading-145 text-text-primary">{props.fingerprint}</code>
        </FormDialogShell>
      </Show>
    </DialogContent>
  </Dialog>;
}

import { Show } from 'solid-js';
import { Button, CopyButton, Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { readOnly } from '../../panel/lib/auth-state';

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
      <DialogTitle>Trust host</DialogTitle>
      <Show when={readOnly()} fallback={
        <>
          <p class="m-0 mb-10 text-11 text-text-muted">
            Verify this fingerprint matches the SSH host you intend to connect to.
          </p>
          <div class="mb-10 flex items-start gap-8 rounded-8 border border-border-faint bg-surface-overlay px-10 py-8">
            <code class="min-w-0 flex-1 break-all font-mono text-11 leading-145 text-text-primary">{props.fingerprint}</code>
            <CopyButton text={props.fingerprint} label="Copy fingerprint" copiedLabel="Fingerprint copied" />
          </div>
          <p class="m-0 mb-12 text-10 text-text-muted">This fingerprint is stored only for Peri Studio.</p>
          <div class="flex justify-end gap-6">
            <Button type="button" variant="secondary" disabled={props.busy} onClick={props.onCancel}>Cancel</Button>
            <Button type="button" variant="primary" busy={props.busy} disabled={locked()} onClick={props.onTrust}>Trust</Button>
          </div>
        </>
      }>
        <p class="m-0 text-11 text-text-muted">Waiting for the owner to trust this host.</p>
        <p class="mt-8 mb-0 font-mono text-10 text-text-secondary">{props.fingerprint}</p>
      </Show>
    </DialogContent>
  </Dialog>;
}

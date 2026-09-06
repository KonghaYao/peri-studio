import { createEffect, createSignal, Show } from 'solid-js';
import { Button, Dialog, DialogContent, DialogTitle, Spinner, TextField } from '@/shared/ui';
import { addComputer, confirmMachineReplace, instances, machines, retryMachine, toast } from '@/store';
import { readOnly } from '../../panel/lib/auth-state';
import { runConfirmedMutation } from '../../panel/lib/form-mutation';
import {
  findActiveMachineByDestination,
  isMachineLiveOnline,
  machineErrorCopy,
  machinePipelineProgressLabel,
} from '@/entities/machine/machine-view';

interface AddComputerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFocusExisting?: (instanceId: string) => void;
}

export function AddComputerDialog(props: AddComputerDialogProps) {
  const [destination, setDestination] = createSignal('');
  const [displayName, setDisplayName] = createSignal('');
  const [port, setPort] = createSignal('');
  const [identityFile, setIdentityFile] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [fieldError, setFieldError] = createSignal<string | null>(null);
  const [progressMode, setProgressMode] = createSignal(false);
  const [pendingDestination, setPendingDestination] = createSignal<string | null>(null);
  const [pendingPort, setPendingPort] = createSignal<number | undefined>(undefined);
  const [pendingLabel, setPendingLabel] = createSignal('');
  const [pendingInstanceId, setPendingInstanceId] = createSignal<string | null>(null);
  const [progressPhase, setProgressPhase] = createSignal('pending');

  const resetForm = () => {
    setDestination('');
    setDisplayName('');
    setPort('');
    setIdentityFile('');
    setFieldError(null);
    setProgressMode(false);
    setPendingDestination(null);
    setPendingPort(undefined);
    setPendingLabel('');
    setPendingInstanceId(null);
    setProgressPhase('pending');
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && progressMode()) {
      toast(`Still adding ${pendingLabel()}…`);
    }
    if (!open) resetForm();
    props.onOpenChange(open);
  };

  const validate = (): boolean => {
    const dest = destination().trim();
    if (!dest) {
      setFieldError('Destination is required.');
      return false;
    }
    if (dest.length > 255 || dest.startsWith('-') || dest.includes('://')) {
      setFieldError('Enter a valid SSH destination (user@host or config Host).');
      return false;
    }
    if (dest.includes('@') && dest.split('@')[0]?.includes(':')) {
      setFieldError('Passwords in the destination are not supported.');
      return false;
    }
    const portText = port().trim();
    let portNum: number | undefined;
    if (portText) {
      if (!/^\d{1,5}$/.test(portText)) {
        setFieldError('Port must be a number.');
        return false;
      }
      portNum = Number(portText);
    }
    const identity = identityFile().trim();
    if (identity && (identity.startsWith('-') || (!identity.startsWith('/') && !identity.startsWith('./')))) {
      setFieldError('Identity file must be an absolute path or start with ./');
      return false;
    }
    const existing = findActiveMachineByDestination(dest, portNum, machines());
    if (existing) {
      setFieldError('This computer is already in the list.');
      props.onFocusExisting?.(existing.instanceId);
      return false;
    }
    setFieldError(null);
    return true;
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (progressMode() || !validate()) return;
    const dest = destination().trim();
    const portNum = port().trim() ? Number(port().trim()) : undefined;
    const label = displayName().trim() || dest;
    runConfirmedMutation(
      () => setSubmitting(true),
      () => setSubmitting(false),
      (onCommitted, onFailed) => addComputer(
        dest,
        displayName().trim() || undefined,
        portNum,
        identityFile().trim() || undefined,
        () => {
          setProgressMode(true);
          setPendingDestination(dest);
          setPendingPort(portNum);
          setPendingLabel(label);
          onCommitted();
        },
        onFailed,
      ),
      () => undefined,
    );
  };

  createEffect(() => {
    const dest = pendingDestination();
    if (!dest || !progressMode()) return;
    const match = findActiveMachineByDestination(dest, pendingPort(), machines())
      ?? machines().find((machine) => machine.instanceId === pendingInstanceId());
    if (!match) return;
    setPendingInstanceId(match.instanceId);
    setProgressPhase(match.phase);
    if (isMachineLiveOnline(match, instances())) {
      toast('Computer online');
      resetForm();
      props.onOpenChange(false);
      return;
    }
    if (match.phase === 'failed') {
      setFieldError(machineErrorCopy(match.errorCode)?.closeHint ?? 'Keep this computer in the list to retry.');
    }
  });

  const retryFailed = () => {
    const id = pendingInstanceId();
    if (!id) return;
    runConfirmedMutation(
      () => setSubmitting(true),
      () => setSubmitting(false),
      (committed, failed) => retryMachine(id, committed, failed),
      () => setFieldError(null),
    );
  };

  const confirmReplace = () => {
    const id = pendingInstanceId();
    if (!id) return;
    runConfirmedMutation(
      () => setSubmitting(true),
      () => setSubmitting(false),
      (committed, failed) => confirmMachineReplace(id, committed, failed),
      () => undefined,
    );
  };

  return <Dialog open={props.open} onOpenChange={handleOpenChange}>
    <DialogContent dismissible={!submitting()}>
      <DialogTitle>Add computer</DialogTitle>
      <Show when={progressMode()} fallback={
        <>
          <p class="m-0 mb-10 text-11 text-text-muted">
            Uses OpenSSH on the computer running Peri. Put keys in ssh-agent or pick an identity file. Passwords cannot be entered here.
          </p>
          <form class="m-0 flex flex-col gap-8" onSubmit={submit}>
            <TextField label="Destination" value={destination()} onInput={(event) => setDestination(event.currentTarget.value)} placeholder="user@host" disabled={readOnly() || submitting()} />
            <TextField label="Display name" value={displayName()} onInput={(event) => setDisplayName(event.currentTarget.value)} placeholder="Optional" disabled={readOnly() || submitting()} />
            <TextField label="Port" value={port()} onInput={(event) => setPort(event.currentTarget.value)} placeholder="Optional" disabled={readOnly() || submitting()} />
            <TextField label="Identity file" value={identityFile()} onInput={(event) => setIdentityFile(event.currentTarget.value)} placeholder="Optional absolute path" disabled={readOnly() || submitting()} />
            <Show when={fieldError()}>
              <p class="m-0 text-10 text-danger">{fieldError()}</p>
            </Show>
            <div class="flex justify-end gap-6 pt-4">
              <Button type="button" variant="secondary" disabled={submitting()} onClick={() => handleOpenChange(false)}>Cancel</Button>
              <Button type="submit" variant="primary" busy={submitting()} disabled={readOnly()}>Add</Button>
            </div>
          </form>
        </>
      }>
        <div aria-current="step" class="flex flex-col gap-10 py-4">
          <div class="flex items-center gap-8">
            <Spinner label="Adding computer" />
            <p class="m-0 text-13 text-text-primary">Adding {pendingLabel()}…</p>
          </div>
          <p class="m-0 text-11 text-text-secondary">{machinePipelineProgressLabel(progressPhase())}</p>
          <Show when={progressPhase() === 'awaiting_replace'}>
            <p class="m-0 text-10 text-text-muted">This will replace the existing Peri Studio binary on that computer.</p>
            <div class="flex justify-end gap-6">
              <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>Close</Button>
              <Button type="button" variant="primary" disabled={readOnly() || submitting()} busy={submitting()} onClick={confirmReplace}>Confirm replace</Button>
            </div>
          </Show>
          <Show when={progressPhase() === 'failed'}>
            <p class="m-0 text-10 text-text-muted">{fieldError() ?? 'Keep this computer in the list to retry.'}</p>
            <div class="flex justify-end gap-6">
              <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>Close</Button>
              <Button type="button" variant="primary" disabled={readOnly() || submitting()} busy={submitting()} onClick={retryFailed}>Retry</Button>
            </div>
          </Show>
          <Show when={progressPhase() !== 'failed' && progressPhase() !== 'awaiting_replace'}>
            <div class="flex justify-end">
              <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>Close</Button>
            </div>
          </Show>
        </div>
      </Show>
    </DialogContent>
  </Dialog>;
}

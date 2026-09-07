import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { Button, CopyButton, Dialog, DialogContent, InlineNotice, Spinner, TextField } from '@/shared/ui';
import { FormDialogShell } from '@/widgets/shell/shared/FormDialogShell';
import { applyParsedSshToFields } from '@/features/machine/ssh-command-parse';
import {
  buildSshAddKeyCommand,
  buildSshVerifyShellCommand,
  shouldOfferSshVerifyCommand,
} from '@/features/machine/ssh-verify-command';
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
  const [sshCommandInput, setSshCommandInput] = createSignal('');
  const [parseWarnings, setParseWarnings] = createSignal<string[]>([]);
  const [destination, setDestination] = createSignal('');
  const [displayName, setDisplayName] = createSignal('');
  const [port, setPort] = createSignal('');
  const [identityFile, setIdentityFile] = createSignal('');
  const [credentialStripped, setCredentialStripped] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  const [fieldError, setFieldError] = createSignal<string | null>(null);
  const [progressMode, setProgressMode] = createSignal(false);
  const [pendingDestination, setPendingDestination] = createSignal<string | null>(null);
  const [pendingPort, setPendingPort] = createSignal<number | undefined>(undefined);
  const [pendingLabel, setPendingLabel] = createSignal('');
  const [pendingInstanceId, setPendingInstanceId] = createSignal<string | null>(null);
  const [progressPhase, setProgressPhase] = createSignal('pending');

  const resetForm = () => {
    setSshCommandInput('');
    setParseWarnings([]);
    setDestination('');
    setDisplayName('');
    setPort('');
    setIdentityFile('');
    setCredentialStripped(false);
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

  const parseSshLine = (): boolean => {
    const line = sshCommandInput().trim();
    if (!line) return true;
    return applyParsedSshToFields(line, {
      setDestination,
      setPort,
      setIdentityFile,
      setParseWarnings,
      setParseError: (message) => setFieldError(message),
      setCredentialStripped,
    });
  };

  const parsedPort = () => {
    const text = port().trim();
    if (!text || !/^\d{1,5}$/.test(text)) return undefined;
    const value = Number(text);
    return value >= 1 && value <= 65535 ? value : undefined;
  };

  const verifyShellCommand = createMemo(() => buildSshVerifyShellCommand({
    destination: destination().trim(),
    port: parsedPort(),
    identityFile: identityFile().trim() || undefined,
    interactivePassword: credentialStripped(),
  }));

  const sshAddKeyCommand = createMemo(() => {
    const identity = identityFile().trim();
    if (!identity || credentialStripped()) return '';
    return buildSshAddKeyCommand(identity);
  });

  const showAuthSetupCommands = createMemo(() => shouldOfferSshVerifyCommand({
    destination: destination(),
    credentialStripped: credentialStripped(),
    identityFile: identityFile(),
  }));

  const commitSshCommandParse = () => {
    const line = sshCommandInput().trim();
    if (!line) {
      setParseWarnings([]);
      setCredentialStripped(false);
      setFieldError(null);
      return;
    }
    if (parseSshLine()) setFieldError(null);
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
    if (identity.startsWith('~')) {
      setFieldError('Identity file must be an absolute path on this Mac (replace ~).');
      return false;
    }
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
    if (progressMode()) return;
    if (!destination().trim() && sshCommandInput().trim() && !parseSshLine()) return;
    if (!validate()) return;
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
      <Show when={progressMode()} fallback={
        <FormDialogShell
          title="Add computer"
          description="Paste an ssh command or fill in the fields below. Peri stores destination, port, and identity file only—never passwords or API keys."
        >
          <form class="m-0 flex flex-col gap-12" onSubmit={submit}>
            <TextField
              label="SSH command or destination"
              value={sshCommandInput()}
              onInput={(event) => setSshCommandInput(event.currentTarget.value)}
              onBlur={commitSshCommandParse}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitSshCommandParse();
                }
              }}
              placeholder="ssh -p 2222 -i ~/.ssh/id_ed25519 user@host"
              disabled={readOnly() || submitting()}
            />
            <TextField label="Destination" value={destination()} onInput={(event) => { setDestination(event.currentTarget.value); setFieldError(null); }} placeholder="user@host" disabled={readOnly() || submitting()} />
            <TextField label="Display name" value={displayName()} onInput={(event) => setDisplayName(event.currentTarget.value)} placeholder="Optional" disabled={readOnly() || submitting()} />
            <TextField label="Port" value={port()} onInput={(event) => setPort(event.currentTarget.value)} placeholder="Optional" disabled={readOnly() || submitting()} />
            <TextField label="Identity file" value={identityFile()} onInput={(event) => setIdentityFile(event.currentTarget.value)} placeholder="Optional absolute path" disabled={readOnly() || submitting()} />
            <Show when={showAuthSetupCommands()}>
              <div class="flex flex-col gap-10 rounded-12 border border-border-subtle bg-surface-muted px-12 py-10">
                <p class="m-0 text-13 leading-155 text-text-secondary">
                  Run this on the Mac that runs Peri Studio before you click Add. If it prompts for a password or API key, enter it in Terminal—Peri cannot store that secret.
                </p>
                <div class="flex items-start gap-8">
                  <code class="min-w-0 flex-1 break-all font-mono text-11 leading-145 text-text-primary">{verifyShellCommand()}</code>
                  <CopyButton text={verifyShellCommand()} label="Copy ssh command" copiedLabel="Command copied" />
                </div>
                <Show when={sshAddKeyCommand()}>
                  <p class="m-0 text-13 leading-155 text-text-secondary">
                    After login works, load your private key into ssh-agent so Peri can connect without a prompt:
                  </p>
                  <div class="flex items-start gap-8">
                    <code class="min-w-0 flex-1 break-all font-mono text-11 leading-145 text-text-primary">{sshAddKeyCommand()}</code>
                    <CopyButton text={sshAddKeyCommand()} label="Copy ssh-add command" copiedLabel="Command copied" />
                  </div>
                </Show>
              </div>
            </Show>
            <Show when={parseWarnings().length}>
              <div class="flex flex-col gap-8">
                <For each={parseWarnings()}>{(warning) => (
                  <InlineNotice tone="warning" class="m-0">{warning}</InlineNotice>
                )}</For>
              </div>
            </Show>
            <Show when={fieldError()}>
              <p class="m-0 text-13 text-danger">{fieldError()}</p>
            </Show>
            <div class="mt-20 flex justify-end gap-6">
              <Button type="button" variant="secondary" disabled={submitting()} onClick={() => handleOpenChange(false)}>Cancel</Button>
              <Button type="submit" variant="primary" busy={submitting()} disabled={readOnly()}>Add</Button>
            </div>
          </form>
        </FormDialogShell>
      }>
        <FormDialogShell
          title={`Adding ${pendingLabel()}…`}
          description={machinePipelineProgressLabel(progressPhase())}
        >
          <div aria-current="step" class="flex flex-col gap-12">
            <div class="flex items-center gap-8">
              <Spinner label="Adding computer" />
              <span class="text-13 text-text-primary">Connecting and provisioning…</span>
            </div>
            <Show when={progressPhase() === 'awaiting_replace'}>
              <p class="m-0 text-13 leading-155 text-text-secondary">This will replace the existing Peri Studio binary on that computer.</p>
              <div class="mt-20 flex justify-end gap-6">
                <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>Close</Button>
                <Button type="button" variant="primary" disabled={readOnly() || submitting()} busy={submitting()} onClick={confirmReplace}>Confirm replace</Button>
              </div>
            </Show>
            <Show when={progressPhase() === 'failed'}>
              <p class="m-0 text-13 leading-155 text-text-secondary">{fieldError() ?? 'Keep this computer in the list to retry.'}</p>
              <div class="mt-20 flex justify-end gap-6">
                <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>Close</Button>
                <Button type="button" variant="primary" disabled={readOnly() || submitting()} busy={submitting()} onClick={retryFailed}>Retry</Button>
              </div>
            </Show>
            <Show when={progressPhase() !== 'failed' && progressPhase() !== 'awaiting_replace'}>
              <div class="mt-20 flex justify-end gap-6">
                <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>Close</Button>
              </div>
            </Show>
          </div>
        </FormDialogShell>
      </Show>
    </DialogContent>
  </Dialog>;
}

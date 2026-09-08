import { createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js';
import { Plus } from 'lucide-solid';
import { connState } from '@/features/connection/connection';
import { readOnly } from '@/features/auth/auth-state';
import { runConfirmedMutation } from '@/features/session/form-mutation';
import {
  cancelMachine,
  connectMachine,
  disconnectMachine,
  instances,
  machines,
  removeMachine,
  renameMachine,
  restoreMachine,
  retryMachine,
  setMachineAutoReconnect,
  stopMachine,
  trustMachineHost,
} from '@/store';
import {
  canTrustMachineHost,
  isLocalMachine,
  isMachineLiveOnline,
  sortMachinesForPanel,
} from '@/entities/machine/machine-view';
import type { MachineInfo } from '@/entities/registry/registry-view';
import { ResourceSectionTitle } from './ResourceSectionTitle';
import { Button, Dialog, DialogContent, TextField } from '@/shared/ui';
import { FormDialogShell } from '@/widgets/shell/shared/FormDialogShell';
import { AddComputerDialog } from '@/widgets/resource/AddComputerDialog';
import { MachineRow } from '@/widgets/resource/MachineRow';
import {
  MachineDisconnectConfirmDialog,
  MachineRemoveConfirmDialog,
  MachineStopConfirmDialog,
} from '@/widgets/resource/MachineConfirmDialogs';
import { TrustHostDialog } from '@/widgets/resource/TrustHostDialog';

const ONLINE_HINT_KEY = 'peri-machine-online-hints';

function loadOnlineHints(): Set<string> {
  try {
    const raw = sessionStorage.getItem(ONLINE_HINT_KEY);
    return new Set(raw ? JSON.parse(raw) as string[] : []);
  } catch {
    return new Set();
  }
}

function persistOnlineHints(values: Set<string>): void {
  sessionStorage.setItem(ONLINE_HINT_KEY, JSON.stringify([...values]));
}

/** Machines 管理列表（R2：行动作、Trust、确认对话框）。 */
export function MachinePanel() {
  const [addOpen, setAddOpen] = createSignal(false);
  const [focusInstanceId, setFocusInstanceId] = createSignal<string | null>(null);
  const [trustTarget, setTrustTarget] = createSignal<MachineInfo | null>(null);
  const [trustBusy, setTrustBusy] = createSignal(false);
  const [disconnectTarget, setDisconnectTarget] = createSignal<MachineInfo | null>(null);
  const [stopTarget, setStopTarget] = createSignal<MachineInfo | null>(null);
  const [removeTarget, setRemoveTarget] = createSignal<MachineInfo | null>(null);
  const [renameTarget, setRenameTarget] = createSignal<MachineInfo | null>(null);
  const [renameDraft, setRenameDraft] = createSignal('');
  const [renameBusy, setRenameBusy] = createSignal(false);
  const [disconnectBusy, setDisconnectBusy] = createSignal(false);
  const [stopBusy, setStopBusy] = createSignal(false);
  const [removeBusy, setRemoveBusy] = createSignal(false);
  const [onlineHints, setOnlineHints] = createSignal(loadOnlineHints());
  const [autoTrustSeen, setAutoTrustSeen] = createSignal<Set<string>>(new Set());

  const sshMachines = () => machines().filter((machine) => !isLocalMachine(machine) && !machine.archivedAt);
  const list = createMemo(() => sortMachinesForPanel(machines().filter((machine) => !machine.archivedAt)));

  const showOnlineHint = (machine: MachineInfo) => !onlineHints().has(machine.instanceId)
    && isMachineLiveOnline(machine, instances());

  createEffect(() => {
    if (readOnly()) return;
    for (const machine of machines()) {
      if (!canTrustMachineHost(machine)) continue;
      if (autoTrustSeen().has(machine.instanceId)) continue;
      setAutoTrustSeen((seen) => new Set(seen).add(machine.instanceId));
      setTrustTarget(machine);
      break;
    }
  });

  createEffect(() => {
    for (const machine of machines()) {
      if (!isMachineLiveOnline(machine, instances()) || onlineHints().has(machine.instanceId)) continue;
      const next = new Set(onlineHints());
      next.add(machine.instanceId);
      setOnlineHints(next);
      persistOnlineHints(next);
    }
  });

  onMount(() => {
    const id = focusInstanceId();
    if (!id) return;
    document.querySelector(`[data-instance-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  });

  const markFocus = (instanceId: string) => {
    setFocusInstanceId(instanceId);
    queueMicrotask(() => {
      document.querySelector(`[data-instance-id="${instanceId}"]`)?.scrollIntoView({ block: 'nearest' });
    });
  };

  return <section class="ui-scrollbar min-h-0 flex-1 overflow-auto bg-surface" aria-label="Machines">
    <ResourceSectionTitle compact>
      <span>Machines</span>
      <span class="ml-auto max-w-(--runtime-label-max) overflow-hidden text-ellipsis whitespace-nowrap font-mono text-9 font-normal normal-case tracking-normal text-text-muted" title={connState().text}>{connState().text}</span>
    </ResourceSectionTitle>
    <div class="px-10 py-8">
      <Button type="button" variant="secondary" size="sm" disabled={readOnly()} onClick={() => setAddOpen(true)}>
        <Plus size={14} strokeWidth={1.7} class="mr-4" />
        Add computer
      </Button>
    </div>
    <ul class="m-0 list-none px-10 pb-10 text-11" aria-label="Computer list">
      <For each={list()}>{(machine) => <MachineRow
        machine={machine}
        instances={instances()}
        readOnly={readOnly()}
        highlighted={focusInstanceId() === machine.instanceId}
        showOnlineHint={showOnlineHint(machine)}
        onPrimaryAction={(action) => {
          if (action === 'cancel') {
            runConfirmedMutation(() => undefined, () => undefined, (committed, failed) => cancelMachine(machine.instanceId, committed, failed), () => undefined);
            return;
          }
          if (action === 'connect') {
            runConfirmedMutation(() => undefined, () => undefined, (committed, failed) => connectMachine(machine.instanceId, committed, failed), () => undefined);
            return;
          }
          if (action === 'disconnect') {
            setDisconnectTarget(machine);
            return;
          }
          if (action === 'retry') {
            runConfirmedMutation(() => undefined, () => undefined, (committed, failed) => retryMachine(machine.instanceId, committed, failed), () => undefined);
          }
        }}
        onOpenTrust={() => setTrustTarget(machine)}
        onRename={() => { setRenameDraft(machine.displayName); setRenameTarget(machine); }}
        onDisconnect={() => setDisconnectTarget(machine)}
        onConnect={() => runConfirmedMutation(() => undefined, () => undefined, (committed, failed) => connectMachine(machine.instanceId, committed, failed), () => undefined)}
        onStop={() => setStopTarget(machine)}
        onRemove={() => setRemoveTarget(machine)}
        onRestore={() => runConfirmedMutation(() => undefined, () => undefined, (committed, failed) => restoreMachine(machine.instanceId, committed, failed), () => undefined)}
        onToggleAutoReconnect={(enabled) => runConfirmedMutation(() => undefined, () => undefined, (committed, failed) => setMachineAutoReconnect(machine.instanceId, enabled, committed, failed), () => undefined)}
      />}</For>
    </ul>
    <Show when={sshMachines().length === 0}>
      <p class="m-0 px-10 pb-8 text-10 text-text-muted">
        Add a remote computer over SSH to run agents on another computer.
      </p>
      <footer class="border-t border-border-faint px-10 py-8 text-10 text-text-muted">
        <p class="m-0 mb-4">You can only add computers from the Mac running Peri Studio.</p>
        <p class="m-0 mb-4">Use ssh-agent or an identity file on this computer. Passwords cannot be entered here.</p>
        <p class="m-0">Quitting Peri or disconnecting a tunnel does not stop agents on remote computers.</p>
      </footer>
    </Show>
    <AddComputerDialog
      open={addOpen()}
      onOpenChange={setAddOpen}
      onFocusExisting={markFocus}
    />
    <TrustHostDialog
      open={!!trustTarget()}
      displayName={trustTarget()?.displayName ?? ''}
      fingerprint={trustTarget()?.hostKeySha256 ?? ''}
      busy={trustBusy()}
      onOpenChange={(open) => { if (!open && !trustBusy()) setTrustTarget(null); }}
      onCancel={() => {
        const target = trustTarget();
        if (!target) return;
        runConfirmedMutation(() => setTrustBusy(true), () => setTrustBusy(false), (committed, failed) => cancelMachine(target.instanceId, committed, failed), () => setTrustTarget(null));
      }}
      onTrust={() => {
        const target = trustTarget();
        if (!target?.hostKeySha256) return;
        runConfirmedMutation(() => setTrustBusy(true), () => setTrustBusy(false), (committed, failed) => trustMachineHost(target.instanceId, target.hostKeySha256!, committed, failed), () => setTrustTarget(null));
      }}
    />
    <MachineDisconnectConfirmDialog
      open={!!disconnectTarget()}
      busy={disconnectBusy()}
      onCancel={() => setDisconnectTarget(null)}
      onConfirm={() => {
        const target = disconnectTarget();
        if (!target) return;
        runConfirmedMutation(() => setDisconnectBusy(true), () => setDisconnectBusy(false), (committed, failed) => disconnectMachine(target.instanceId, committed, failed), () => setDisconnectTarget(null));
      }}
    />
    <MachineStopConfirmDialog
      open={!!stopTarget()}
      busy={stopBusy()}
      onCancel={() => setStopTarget(null)}
      onConfirm={() => {
        const target = stopTarget();
        if (!target) return;
        runConfirmedMutation(() => setStopBusy(true), () => setStopBusy(false), (committed, failed) => stopMachine(target.instanceId, committed, failed), () => setStopTarget(null));
      }}
    />
    <MachineRemoveConfirmDialog
      open={!!removeTarget()}
      busy={removeBusy()}
      onCancel={() => setRemoveTarget(null)}
      onConfirm={() => {
        const target = removeTarget();
        if (!target) return;
        runConfirmedMutation(() => setRemoveBusy(true), () => setRemoveBusy(false), (committed, failed) => removeMachine(target.instanceId, committed, failed), () => setRemoveTarget(null));
      }}
    />
    <Dialog open={!!renameTarget()} onOpenChange={(open) => { if (!open && !renameBusy()) setRenameTarget(null); }}>
      <DialogContent dismissible={!renameBusy()}>
        <FormDialogShell
          title="Rename computer"
          description="Updates the sidebar label only. SSH destination and port stay the same."
        >
          <form class="m-0 flex flex-col gap-12" onSubmit={(event) => {
            event.preventDefault();
            const target = renameTarget();
            const name = renameDraft().trim();
            if (!target || !name) return;
            runConfirmedMutation(() => setRenameBusy(true), () => setRenameBusy(false), (committed, failed) => renameMachine(target.instanceId, name, committed, failed), () => setRenameTarget(null));
          }}>
            <TextField label="Display name" value={renameDraft()} onInput={(event) => setRenameDraft(event.currentTarget.value)} disabled={renameBusy()} autofocus />
            <div class="mt-20 flex justify-end gap-6">
              <Button type="button" variant="secondary" disabled={renameBusy()} onClick={() => setRenameTarget(null)}>Cancel</Button>
              <Button type="submit" variant="primary" busy={renameBusy()} disabled={!renameDraft().trim()}>Save</Button>
            </div>
          </form>
        </FormDialogShell>
      </DialogContent>
    </Dialog>
  </section>;
}

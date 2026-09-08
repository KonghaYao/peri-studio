import * as H from '@/shared/protocol/client';

export type MachineFrame = ReturnType<typeof H.action>;

export interface MachineAck {
  commandId?: string;
  status?: string;
  instanceId?: string;
  [key: string]: unknown;
}

export interface MachineError {
  commandId?: string;
  code?: string;
  message?: string;
  retryable?: boolean;
}

export interface MachineSendOptions {
  cb?: (ack: MachineAck) => void;
  onTimeout?: () => void;
  onError?: (error: MachineError) => void;
  retryOnUncertain?: boolean;
}

export interface MachineActionsDependencies {
  isReady: () => boolean;
  isReadOnly: () => boolean;
  hasUncertainMetadata: () => boolean;
  send: (frame: MachineFrame, label: string, options: MachineSendOptions) => boolean;
  toast: (message: string) => void;
  persistProblem: (title: string, detail: string, commandId: string) => void;
}

export interface MutationCallbacks {
  onCommitted?: () => void;
  onFailed?: () => void;
}

const committed = (ack: MachineAck) => ack.status === 'committed' || ack.status === 'duplicate';

/**
 * Owns the browser lifecycle for SSH machine management commands.
 *
 * Machine rows persist in server SQLite and broadcast via Registry projection;
 * the browser only sends metadata and pipeline control mutations.
 */
export class MachineActions {
  constructor(private readonly deps: MachineActionsDependencies) {}

  add(
    destination: string,
    displayName?: string,
    port?: number,
    identityFile?: string,
    callbacks: MutationCallbacks = {},
  ): boolean {
    if (!this.canMutate('Read-only mode cannot add computers')) return false;
    const frame = H.machineAdd(destination, displayName, port, identityFile);
    return this.sendPipelineMutation(frame, 'machine/add', {
      title: 'Add computer result not yet confirmed',
      detail: 'The computer may already have been added. Wait for the machines list to sync before resubmitting.',
    }, callbacks);
  }

  connect(instanceId: string, callbacks: MutationCallbacks = {}): boolean {
    if (!this.canMutate('Read-only mode cannot connect computers')) return false;
    const frame = H.machineConnect(instanceId);
    return this.sendPipelineMutation(frame, 'machine/connect', {
      title: 'Connect result not yet confirmed',
      detail: 'The connection may already be in progress. Wait for the machines list to sync before retrying.',
    }, callbacks);
  }

  disconnect(instanceId: string, callbacks: MutationCallbacks = {}): boolean {
    if (!this.canMutate('Read-only mode cannot disconnect computers')) return false;
    const frame = H.machineDisconnect(instanceId);
    return this.sendPipelineMutation(frame, 'machine/disconnect', {
      title: 'Disconnect result not yet confirmed',
      detail: 'The tunnel may already be disconnected. Wait for the machines list to sync before retrying.',
    }, callbacks);
  }

  stop(instanceId: string, callbacks: MutationCallbacks = {}): boolean {
    if (!this.canMutate('Read-only mode cannot stop agents')) return false;
    const frame = H.machineStop(instanceId);
    return this.sendPipelineMutation(frame, 'machine/stop', {
      title: 'Stop agents result not yet confirmed',
      detail: 'Agents on that computer may already be stopped. Wait for the machines list to sync before retrying.',
    }, callbacks);
  }

  cancel(instanceId: string, callbacks: MutationCallbacks = {}): boolean {
    if (!this.canMutate('Read-only mode cannot cancel machine operations')) return false;
    const frame = H.machineCancel(instanceId);
    return this.sendPipelineMutation(frame, 'machine/cancel', {
      title: 'Cancel result not yet confirmed',
      detail: 'The operation may already be canceled. Wait for the machines list to sync before retrying.',
    }, callbacks);
  }

  retry(instanceId: string, callbacks: MutationCallbacks = {}): boolean {
    if (!this.canMutate('Read-only mode cannot retry machine operations')) return false;
    const frame = H.machineRetry(instanceId);
    return this.sendPipelineMutation(frame, 'machine/retry', {
      title: 'Retry result not yet confirmed',
      detail: 'The retry may already be in progress. Wait for the machines list to sync before resubmitting.',
    }, callbacks);
  }

  trustHost(instanceId: string, fingerprint: string, callbacks: MutationCallbacks = {}): boolean {
    if (!fingerprint.trim()) return false;
    if (!this.canMutate('Read-only mode cannot trust hosts')) return false;
    const frame = H.machineTrustHost(instanceId, fingerprint.trim());
    return this.sendPipelineMutation(frame, 'machine/trust-host', {
      title: 'Trust host result not yet confirmed',
      detail: 'The host may already be trusted. Wait for the machines list to sync before retrying.',
    }, callbacks);
  }

  confirmReplace(instanceId: string, callbacks: MutationCallbacks = {}): boolean {
    if (!this.canMutate('Read-only mode cannot confirm binary replace')) return false;
    const frame = H.machineConfirmReplace(instanceId);
    return this.sendPipelineMutation(frame, 'machine/confirm-replace', {
      title: 'Confirm replace result not yet confirmed',
      detail: 'The binary may already be replaced. Wait for the machines list to sync before retrying.',
    }, callbacks);
  }

  rename(instanceId: string, name: string, callbacks: MutationCallbacks = {}): boolean {
    if (!name.trim()) return false;
    if (!this.canMutate('Read-only mode cannot rename computers')) return false;
    const frame = H.machineRename(instanceId, name.trim());
    return this.sendMutation(frame, 'machine/rename', 'Computer renamed', {
      title: 'Computer rename result not yet confirmed',
      detail: 'The name may already be saved. Your input is preserved; wait for the machines list to sync.',
    }, callbacks);
  }

  setAutoReconnect(instanceId: string, enabled: boolean, callbacks: MutationCallbacks = {}): boolean {
    if (!this.canMutate('Read-only mode cannot change auto-reconnect')) return false;
    const frame = H.machineSetAutoReconnect(instanceId, enabled);
    return this.sendMutation(
      frame,
      'machine/set-auto-reconnect',
      enabled ? 'Auto-reconnect enabled' : 'Auto-reconnect disabled',
      {
        title: 'Auto-reconnect result not yet confirmed',
        detail: 'The setting may already be saved. Wait for the machines list to sync before retrying.',
      },
      callbacks,
    );
  }

  remove(instanceId: string, callbacks: MutationCallbacks = {}): boolean {
    if (!this.canMutate('Read-only mode cannot remove computers')) return false;
    const frame = H.machineRemove(instanceId);
    return this.sendMutation(frame, 'machine/remove', 'Computer removed', {
      title: 'Remove computer result not yet confirmed',
      detail: 'The computer may already be removed. Wait for the machines list to sync before retrying.',
    }, callbacks);
  }

  restore(instanceId: string, callbacks: MutationCallbacks = {}): boolean {
    if (!this.canMutate('Read-only mode cannot restore computers')) return false;
    const frame = H.machineRestore(instanceId);
    return this.sendMutation(frame, 'machine/restore', 'Computer restored', {
      title: 'Restore computer result not yet confirmed',
      detail: 'The computer may already be restored. Wait for the machines list to sync before retrying.',
    }, callbacks);
  }

  private canMutate(readOnlyMessage: string): boolean {
    if (this.deps.isReadOnly()) {
      this.deps.toast(readOnlyMessage);
      return false;
    }
    if (!this.deps.isReady()) {
      this.deps.toast('Connection not ready');
      return false;
    }
    if (this.deps.hasUncertainMetadata()) {
      this.deps.toast('Resolve pending "result not yet confirmed" project or session operations first');
      return false;
    }
    return true;
  }

  private sendMutation(
    frame: MachineFrame,
    label: string,
    successMessage: string,
    uncertain: { title: string; detail: string },
    callbacks: MutationCallbacks,
  ): boolean {
    return this.deps.send(frame, label, {
      retryOnUncertain: true,
      cb: (ack) => {
        if (!committed(ack)) return;
        this.deps.toast(successMessage);
        callbacks.onCommitted?.();
      },
      onError: () => callbacks.onFailed?.(),
      onTimeout: () => {
        this.deps.persistProblem(uncertain.title, uncertain.detail, frame.commandId);
        callbacks.onFailed?.();
      },
    });
  }

  private sendPipelineMutation(
    frame: MachineFrame,
    label: string,
    uncertain: { title: string; detail: string },
    callbacks: MutationCallbacks,
  ): boolean {
    return this.deps.send(frame, label, {
      retryOnUncertain: true,
      cb: (ack) => {
        if (!committed(ack)) return;
        callbacks.onCommitted?.();
      },
      onError: () => callbacks.onFailed?.(),
      onTimeout: () => {
        this.deps.persistProblem(uncertain.title, uncertain.detail, frame.commandId);
        callbacks.onFailed?.();
      },
    });
  }
}

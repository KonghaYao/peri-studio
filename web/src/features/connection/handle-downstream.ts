// action_ack / action_error / auth_error 下行帧（store 组合根委托）。
import type * as H from '@/shared/protocol/client';
import type { Ack, ActionError, ActionFrame } from '@/shared/protocol/action-contract';
import type { CommandTracker } from '@/features/connection/command-tracker';
import { ERROR_REASONS, persistActionProblem } from '../message/panel-errors';
import {
  completeMessageDelivery,
  ownsMessageDeliveryError,
  settleProjectedMessageDelivery,
} from '@/features/message/message-delivery';
import { settleLateQuickStart } from '@/features/message/quick-start-delivery';
import { confirmRuntimeControl } from '@/features/runtime/runtime-control';
import { promptRecoveryOwnsError } from '@/features/runtime/prompt-recovery-assembly';
import { rewindOwnsError } from '@/features/runtime/rewind-assembly';
import { ownsMcpAppsError } from '@/features/mcp/mcp-apps';
import type { PersistentError } from '../message/panel-errors';
import type { Setter } from 'solid-js';

export type ConnectionDownstreamDeps = {
  forwardWorkspaceUploadActionAck: (ack: Ack) => void;
  forwardWorkspaceUploadActionError: (err: Record<string, unknown>) => boolean;
  commands: CommandTracker<ActionFrame, Ack, ActionError>;
  reconcileCurrentRuntimeControl: () => void;
  setPersistentErrors: Setter<PersistentError[]>;
  invalidateAuthentication: (reason: string) => void;
};

export function createConnectionDownstream(deps: ConnectionDownstreamDeps) {
  function onAck(ack: Ack): void {
    deps.forwardWorkspaceUploadActionAck(ack);
    const disposition = deps.commands.acknowledge(ack);
    // A terminal acknowledgement that arrives after timeout/disconnect can
    // reconcile local uncertainty, but must not replay an expired continuation.
    if (disposition === 'late_terminal') {
      if (ack.commandId) completeMessageDelivery(ack.commandId, ack.status);
      if (ack.commandId) settleLateQuickStart(ack.commandId, ack.status, ack.sessionId, ack.chatId);
      if (ack.commandId && confirmRuntimeControl(ack.commandId, ack.status)) deps.reconcileCurrentRuntimeControl();
    }
    if (ack.status !== 'accepted' && ack.commandId) {
      deps.setPersistentErrors((items) => items.filter((item) => item.commandId !== ack.commandId));
    }
  }

  function onActionError(err: ActionError): void {
    const uploadOwned = deps.forwardWorkspaceUploadActionError(err as Record<string, unknown>);
    if (promptRecoveryOwnsError(err)) return;
    if (rewindOwnsError(err)) return;
    if (ownsMcpAppsError(err)) return;
    console.error(`[panel] action error code=${err.code || 'UNKNOWN'} command=${err.commandId ? 'present' : 'absent'}`);
    const messageDeliveryOwnsError = ownsMessageDeliveryError(err.commandId, err.code);
    deps.commands.fail(err);
    settleProjectedMessageDelivery(err.commandId);
    if (uploadOwned || messageDeliveryOwnsError) return;
    const reason = err.code ? ERROR_REASONS[err.code] : undefined;
    persistActionProblem(reason || err.code || 'Operation failed', err.message || 'The server provided no further information.', err.commandId);
  }

  function handleDownstream(frame: H.DownstreamFrame): void {
    switch (frame.t) {
      case 'action_ack':
        onAck(frame as Ack);
        break;
      case 'action_error':
        onActionError(frame as ActionError);
        break;
      case 'auth_error':
        deps.invalidateAuthentication('Access token is invalid, revoked, or the server restarted. Please sign in again.');
        break;
      default:
        break;
    }
  }

  return { handleDownstream, onAck, onActionError };
}

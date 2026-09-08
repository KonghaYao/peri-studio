import { createEffect, createSignal, Show } from 'solid-js';
import { History, Power, RotateCcw } from 'lucide-solid';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { chatHead, chatStatusSignal, closeChat, navigateProjectSession, openingSessionId, projectSessions, selectedCid, selectedSessionId, turnActive } from '../../panel/store';
import { isTerminal } from '../../panel/lib/action-state';
import { readOnly } from '../../panel/lib/auth-state';
import { canRewindCurrentChat, openRewindFlow } from '../../panel/lib/rewind-assembly';
import { runtimeControlFor } from '@/features/runtime/runtime-control';
import { ConfirmDialog } from './shared/ConfirmDialog';
import { ResourceRailButton } from '@/widgets/resource/ResourceRailButton';
import { RewindDialog } from '@/widgets/chat/RewindDialog';

/** Session lifecycle actions live beside global resources, outside the message stream. */
export function SessionRailActions() {
  const [confirmClose, setConfirmClose] = createSignal(false);
  const [rewindOpen, setRewindOpen] = createSignal(false);
  const logical = () => projectSessions().find((session) => session.id === selectedSessionId());
  const terminal = () => isTerminal(chatStatusSignal()[selectedCid() ?? '']);
  const runtimeControl = () => runtimeControlFor(selectedCid());
  const closing = () => runtimeControl()?.kind === 'close' ? runtimeControl() : null;
  const runtimeControlLocked = () => !!runtimeControl() && runtimeControl()?.phase !== 'failed';
  const closeLocked = () => !!closing() && closing()?.phase !== 'failed';
  const canRewind = () => !!selectedCid() && !terminal() && !!chatHead()?.agent?.extensions?.includes('peri.rewind');

  createEffect(() => {
    if (terminal()) setConfirmClose(false);
  });

  return <>
    <Show when={canRewind()}><ResourceRailButton label="Rewind session" disabled={!canRewindCurrentChat()} onClick={() => {
      if (openRewindFlow()) setRewindOpen(true);
    }}><History size={17} strokeWidth={1.7} /></ResourceRailButton></Show>
    <Show when={logical() && selectedCid()}>
      <Show when={terminal()} fallback={<ResourceRailButton label="Close running instance" tone="danger" disabled={readOnly() || runtimeControlLocked()} onClick={() => setConfirmClose(true)}><Power size={17} strokeWidth={1.7} /></ResourceRailButton>}>
        <ResourceRailButton label="Reopen session" disabled={readOnly() || !!openingSessionId()} onClick={() => {
          const id = logical()?.id;
          if (id) navigateProjectSession(id);
        }}><RotateCcw size={17} strokeWidth={1.7} /></ResourceRailButton>
      </Show>
    </Show>
    <Dialog open={confirmClose()} onOpenChange={(open) => { if (!open && !closeLocked()) setConfirmClose(false); }}><DialogContent dismissible={!closeLocked()}><DialogTitle class="sr-only">Close current running instance</DialogTitle>
      <ConfirmDialog
        title="Close the current running instance?"
        description="Sessions and history on the left are kept. Next time you open it, Peri Studio starts a new runtime instance and loads the same ACP session."
        warning={turnActive() ? 'Agent is still working. Closing the instance will stop the current generation and running tools.' : undefined}
        cancelDisabled={closeLocked()}
        confirmLabel="Close instance"
        confirmDisabled={runtimeControlLocked()}
        confirmBusy={closing()?.phase === 'sending' || closing()?.phase === 'accepted'}
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => closeChat(() => setConfirmClose(false))}
      />
    </DialogContent></Dialog>
    <RewindDialog open={rewindOpen()} onClose={() => setRewindOpen(false)} />
  </>;
}

import { Show } from 'solid-js';
import { Button } from '@/shared/ui';

export interface QuitConfirmDialogProps {
  open: boolean;
  machineNames: string[];
  stopping: boolean;
  onDismiss: () => void;
  onKeepRunning: () => void;
  onStopThenQuit: () => void;
}

export function QuitConfirmDialog(props: QuitConfirmDialogProps) {
  const machineList = () => props.machineNames.join(', ');
  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 grid place-items-center bg-overlay/40 p-16">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="quit-confirm-title"
          class="w-(--container-dialog-default) rounded-12 border border-border-faint bg-surface p-20 shadow-overlay"
        >
          <span class="block mb-5 text-text-muted text-10 font-bold tracking-8 uppercase">Quit Peri Studio</span>
          <h2 id="quit-confirm-title" class="m-0 text-19 tracking-(--tracking-dialog)">Agents may keep running</h2>
          <p class="mt-9 mb-0 text-13 leading-155 text-text-secondary">
            {props.machineNames.length === 1
              ? `${machineList()} still has active agents. Quitting closes SSH tunnels but does not stop them automatically.`
              : `These computers still have active agents: ${machineList()}. Quitting closes SSH tunnels but does not stop them automatically.`}
          </p>
          <p class="mt-9 mb-0 text-13 leading-155 text-text-secondary">
            Choose Keep running to quit now, or Stop then quit to shut down agents on those computers first.
          </p>
          <div class="mt-20 flex justify-end gap-6">
            <Button disabled={props.stopping} onClick={props.onDismiss}>Cancel</Button>
            <Button variant="primary" disabled={props.stopping} onClick={props.onKeepRunning}>Keep running</Button>
            <Button variant="danger" busy={props.stopping} onClick={props.onStopThenQuit}>Stop then quit</Button>
          </div>
        </div>
      </div>
    </Show>
  );
}

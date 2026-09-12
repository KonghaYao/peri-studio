import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@peri/ui';

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
  const preventDismissWhenBusy = (event: Event) => {
    if (props.stopping) event.preventDefault();
  };

  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !props.stopping) props.onDismiss();
      }}
    >
      <AlertDialogContent
        onEscapeKeyDown={preventDismissWhenBusy}
        onPointerDownOutside={preventDismissWhenBusy}
      >
        <AlertDialogHeader>
          <span class="text-text-muted text-10 font-bold tracking-8 uppercase">Quit Peri Studio</span>
          <AlertDialogTitle id="quit-confirm-title" class="text-19 font-normal leading-normal tracking-(--tracking-dialog)">
            Agents may keep running
          </AlertDialogTitle>
          <AlertDialogDescription class="text-text-secondary leading-155">
            {props.machineNames.length === 1
              ? `${machineList()} still has active agents. Quitting closes SSH tunnels but does not stop them automatically.`
              : `These computers still have active agents: ${machineList()}. Quitting closes SSH tunnels but does not stop them automatically.`}
          </AlertDialogDescription>
          <AlertDialogDescription class="text-text-secondary leading-155">
            Choose Keep running to quit now, or Stop then quit to shut down agents on those computers first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="flex-row justify-end gap-6">
          <AlertDialogCancel disabled={props.stopping} onClick={props.onDismiss}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction variant="primary" disabled={props.stopping} onClick={props.onKeepRunning}>
            Keep running
          </AlertDialogAction>
          <AlertDialogAction
            variant="danger"
            busy={props.stopping}
            onClick={(event) => {
              event.preventDefault();
              props.onStopThenQuit();
            }}
          >
            Stop then quit
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

import { createSignal, Show } from 'solid-js';
import { Button } from '../Button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '../Dialog';
import { Input } from '../Field';

/** Move to… 目标路径对话框（v1 无树内 DnD）。 */
export function ExplorerMoveDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceName: string;
  initialDestination?: string;
  busy?: boolean;
  conflictMessage?: string;
  onConfirm: (destinationPath: string) => void;
}) {
  const [destination, setDestination] = createSignal(props.initialDestination ?? '');

  const handleOpen = (open: boolean) => {
    if (open) setDestination(props.initialDestination ?? '');
    props.onOpenChange(open);
  };

  const invalid = () => Boolean(props.conflictMessage);

  return (
    <Dialog open={props.open} onOpenChange={handleOpen}>
      <DialogContent size="default" class="gap-12">
        <DialogTitle>{`Move "${props.sourceName}"`}</DialogTitle>
        <div class="flex flex-col gap-8 px-20">
          <label class="text-12 font-medium text-content-primary" for="explorer-move-destination">
            Destination path
          </label>
          <Input
            id="explorer-move-destination"
            placeholder="Destination path"
            value={destination()}
            onInput={(e) => setDestination(e.currentTarget.value)}
            invalid={invalid()}
            aria-describedby={invalid() ? 'explorer-move-error' : undefined}
          />
          <Show when={props.conflictMessage}>
            <p id="explorer-move-error" class="text-12 text-danger-solid" role="alert">
              {props.conflictMessage}
            </p>
          </Show>
          <Show when={props.busy}>
            <p class="text-12 text-content-muted" role="status">
              Moving…
            </p>
          </Show>
        </div>
        <DialogFooter>
          <Button variant="default" disabled={props.busy} onClick={() => handleOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={props.busy}
            disabled={!destination().trim()}
            onClick={() => props.onConfirm(destination().trim())}
          >
            {props.busy ? 'Moving…' : 'Move'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

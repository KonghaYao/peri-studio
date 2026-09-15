import { Show } from 'solid-js';
import { busy, connectionProblem, reconnect } from '@/features/connection/connection';
import { Alert, AlertDescription, AlertTitle, Button } from '@peri/ui';

export function ConnectionProblem() {
  return <Show when={connectionProblem()}>{(problem) => (
    <Alert
      type="error"
      class="mt-12 mx-20 desk:max-wide:mx-16 max-desk:mx-12 max-narrow:m-10 flex-wrap items-start gap-12"
    >
      <div class="min-w-0 flex-1">
        <AlertTitle>{problem().title}</AlertTitle>
        <AlertDescription class="break-words">
          <p>{problem().detail}</p>
          <Show when={problem().action === 'reconnect'}>
            <Button
              variant="primary"
              busy={busy()}
              disabled={busy()}
              class="mt-8 max-narrow:w-full"
              onClick={reconnect}
            >
              {busy() ? 'Connecting' : 'Reconnect'}
            </Button>
          </Show>
        </AlertDescription>
      </div>
    </Alert>
  )}</Show>;
}

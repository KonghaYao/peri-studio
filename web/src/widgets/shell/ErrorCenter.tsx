import { For, Show } from 'solid-js';
import { dismissPersistentError, persistentErrors, retryPersistentAction } from '@/store';
import { Button, CopyButton, InlineNotice } from '@peri/ui';

export function ErrorCenter() {
  return <Show when={persistentErrors().length}>
    <section class="flex max-h-180 flex-col gap-6 mt-10 mx-20 overflow-auto desk:max-wide:mx-16 max-desk:mx-12" aria-label="Operation errors">
      <For each={persistentErrors()}>{(error) => <InlineNotice tone="danger" title={error.title} data-testid="error-card" role="alert">
        <div class="flex items-start justify-between gap-12">
          <div><p class="my-3">{error.detail}</p><Show when={error.commandId}><code class="p-0 bg-transparent text-10">{error.commandId}</code></Show></div>
          <div class="flex shrink-0 gap-4"><CopyButton size="compact" class="pointer-coarse:min-h-44" text={[error.title, error.detail, error.commandId].filter(Boolean).join('\n')} label="Copy details" /><Show when={(error.retryable || error.retrying) && error.commandId}><Button variant="primary" size="compact" busy={error.retrying} disabled={error.retrying} class="pointer-coarse:min-h-44" onClick={() => retryPersistentAction(error.commandId!)}>Re-confirm with the original request</Button></Show><Show when={!error.retryable && !error.retrying}><Button size="compact" class="pointer-coarse:min-h-44" onClick={() => dismissPersistentError(error.id)}>Close</Button></Show></div>
        </div>
      </InlineNotice>}</For>
    </section>
  </Show>;
}

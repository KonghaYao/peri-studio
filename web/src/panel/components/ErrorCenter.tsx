import { For, Show } from 'solid-js';
import { dismissPersistentError, persistentErrors, retryPersistentAction } from '../store';
import { Button, CopyButton } from '../../ui';

export function ErrorCenter() {
  return <Show when={persistentErrors().length}>
    <section class="error-center flex max-h-180 flex-col gap-6 mt-10 mx-20 overflow-auto desk:max-wide:mx-16 max-desk:mx-12" aria-label="Operation errors">
      <For each={persistentErrors()}>{(error) => <article class="error-card flex items-start justify-between gap-12 py-11 px-12 border border-danger-border rounded-12 bg-danger-soft text-12" role="alert">
        <div><strong class="text-13">{error.title}</strong><p class="my-3 text-text-secondary">{error.detail}</p><Show when={error.commandId}><code class="p-0 bg-transparent text-10">{error.commandId}</code></Show></div>
        <div class="error-card__actions flex shrink-0 gap-4"><CopyButton class="min-h-32 border-0 rounded-8 bg-transparent text-text-secondary cursor-pointer hover:bg-surface-hover-translucent" text={[error.title, error.detail, error.commandId].filter(Boolean).join('\n')} label="Copy details" /><Show when={(error.retryable || error.retrying) && error.commandId}><Button variant="primary" busy={error.retrying} disabled={error.retrying} class="min-h-32 border-0 rounded-8 bg-transparent text-text-secondary cursor-pointer hover:bg-surface-hover-translucent" onClick={() => retryPersistentAction(error.commandId!)}>Re-confirm with the original request</Button></Show><Show when={!error.retryable && !error.retrying}><Button class="min-h-32 border-0 rounded-8 bg-transparent text-text-secondary cursor-pointer hover:bg-surface-hover-translucent" onClick={() => dismissPersistentError(error.id)}>Close</Button></Show></div>
      </article>}</For>
    </section>
  </Show>;
}

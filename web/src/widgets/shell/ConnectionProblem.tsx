import { Show } from 'solid-js';
import { busy, connectionProblem, reconnect } from '@/features/connection/connection';
import { Button, InlineNotice } from '@peri/ui';

export function ConnectionProblem() {
  return <Show when={connectionProblem()}>{(problem) =>
    <InlineNotice tone="danger" title={problem().title} class="connection-problem mt-12 mx-20 desk:max-wide:mx-16 max-desk:mx-12 max-narrow:m-10" role="alert">
      <p>{problem().detail}</p>
      <Show when={problem().action === 'reconnect'}><Button variant="primary" busy={busy()} disabled={busy()} class="mt-4 max-narrow:w-full" onClick={reconnect}>{busy() ? 'Connecting' : 'Reconnect'}</Button></Show>
    </InlineNotice>
  }</Show>;
}

import { Show } from 'solid-js';
import { busy, connectionProblem, reconnect } from '../lib/connection';
import { Button } from '../../ui';

export function ConnectionProblem() {
  return <Show when={connectionProblem()}>{(problem) =>
    <section class="connection-problem flex items-center gap-12 mt-12 mx-20 p-13 px-14 border border-danger-border rounded-14 bg-danger-soft desk:max-wide:mx-16 max-desk:mx-12 max-narrow:items-start max-narrow:m-10 max-narrow:flex-wrap" role="alert">
      <div class="connection-problem__mark grid w-26 h-26 shrink-0 place-items-center rounded-full bg-danger text-surface font-bold" aria-hidden="true">!</div>
      <div class="connection-problem__body min-w-0 flex-1"><strong class="text-13">{problem().title}</strong><p class="mt-3 text-text-secondary text-12 leading-145">{problem().detail}</p></div>
      <Show when={problem().action === 'reconnect'}><Button variant="primary" busy={busy()} disabled={busy()} class="max-narrow:w-full" onClick={reconnect}>{busy() ? 'Connecting' : 'Reconnect'}</Button></Show>
    </section>
  }</Show>;
}

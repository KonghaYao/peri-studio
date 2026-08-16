import { For, Match, Show, Switch } from 'solid-js';
import { Button, Dialog, Spinner } from '../../ui';
import { closeRewindFlow, executeRewind, openRewindFlow, previewRewind, rewindFlow } from '../lib/rewind-assembly';

export function RewindDialog(props: { open: boolean; onClose: () => void }) {
  const state = rewindFlow;
  const executing = () => state().kind === 'executing';
  const close = () => {
    if (executing()) return;
    closeRewindFlow();
    props.onClose();
  };
  const restart = () => {
    closeRewindFlow();
    openRewindFlow();
  };

  return <Dialog open={props.open} title="Rewind session" dismissible={!executing()} showHeader onClose={close}>
    <section class="rewind-dialog box-border w-(--container-rewind) max-h-(--container-rewind-tall) overflow-auto px-22 pb-22 pt-4">
      <Switch>
        <Match when={state().kind === 'loading_candidates'}>
          <div class="rewind-dialog__loading grid min-h-180 place-content-center justify-items-center p-24 text-center"><Spinner label="Reading rewindable messages" /><p>Reading user messages from the Peri session history.</p></div>
        </Match>
        <Match when={state().kind === 'select_target' && state()} keyed>{(current) => {
          if (current.kind !== 'select_target') return null;
          return <>
            <div class="rewind-dialog__intro pt-8 pb-16"><strong>Choose the message to rewind to</strong><p>Messages after it will be removed. You will see the file impact first; nothing executes immediately.</p></div>
            <Show when={current.candidates.length} fallback={<div class="rewind-dialog__empty grid min-h-180 place-content-center justify-items-center p-24 text-center">The current session has no user messages to rewind to.</div>}>
              <ol class="rewind-candidates grid gap-7 m-0 p-0 list-none">
                <For each={current.candidates}>{(candidate, index) => <li>
                  <button type="button" class="hover:border-border-strong hover:bg-selected focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" onClick={() => previewRewind(candidate)}>
                    <span>{candidate.preview || 'Empty message'}</span><small>Message {index() + 1}</small>
                  </button>
                </li>}</For>
              </ol>
            </Show>
          </>;
        }}</Match>
        <Match when={state().kind === 'loading_preview'}>
          <div class="rewind-dialog__loading grid min-h-180 place-content-center justify-items-center p-24 text-center"><Spinner label="Generating rewind preview" /><p>Checking the session history and workspace file impact.</p></div>
        </Match>
        <Match when={state().kind === 'confirm' && state()} keyed>{(current) => {
          if (current.kind !== 'confirm') return null;
          return <>
            <div class="rewind-dialog__intro pt-8 pb-16"><strong>Confirm the rewind impact</strong><p>The session will rewind to before this message and reload the server projection.</p></div>
            <blockquote class="rewind-target m-0 px-15 py-13 border-l-3 border-solid-l border-l-text-primary rounded-r-10 bg-surface-muted text-text-primary text-13 leading-15">{current.candidate.preview || 'Empty message'}</blockquote>
            <section class="rewind-impact mt-18" aria-labelledby="rewind-files-title">
              <h3 id="rewind-files-title">File impact · {current.fileChanges.length}</h3>
              <Show when={current.fileChanges.length} fallback={<p>No workspace files need to be restored.</p>}>
                <ul><For each={current.fileChanges}>{(change) => <li><code>{change.path}</code><span>{change.kind === 'write' ? 'Restore write' : 'Restore edit'}</span></li>}</For></ul>
              </Show>
            </section>
            <p class="rewind-dialog__warning mt-18 px-12 py-10 rounded-10 bg-danger-soft !text-danger text-12 leading-15">This is a destructive action. Do not repeat it after confirming; if the result is unknown, reopen the session to check.</p>
            <div class="form-actions flex justify-end gap-8 mt-20"><Button onClick={close}>Cancel</Button><Button variant="danger" onClick={executeRewind}>Rewind session and files</Button></div>
          </>;
        }}</Match>
        <Match when={state().kind === 'executing'}>
          <div class="rewind-dialog__loading grid min-h-180 place-content-center justify-items-center p-24 text-center"><Spinner label="Executing rewind" /><strong>Rewinding and reloading the session</strong><p>Keep the page open. This operation will not retry automatically.</p></div>
        </Match>
        <Match when={state().kind === 'completed'}>
          <div class="rewind-dialog__result rewind-dialog__result--ok grid min-h-180 place-content-center justify-items-center p-24 text-center text-success"><strong>Rewind complete</strong><p>The session history and file projection have been reloaded.</p><Button variant="primary" onClick={close}>Done</Button></div>
        </Match>
        <Match when={state().kind === 'delivery_unknown' && state()} keyed>{(current) => {
          if (current.kind !== 'delivery_unknown') return null;
          return <div class="rewind-dialog__result rewind-dialog__result--unknown grid min-h-180 place-content-center justify-items-center p-24 text-center justify-items-start rounded-12 bg-warning-soft text-left" role="alert"><strong>Rewind result not confirmed</strong><p>{current.detail}</p><p>To avoid duplicate changes, re-execution is not offered. Close this window and reopen the session to check the history and files.</p><Button onClick={close}>Got it</Button></div>;
        }}</Match>
        <Match when={state().kind === 'error' && state()} keyed>{(current) => {
          if (current.kind !== 'error') return null;
          return <div class="rewind-dialog__result grid min-h-180 place-content-center justify-items-center p-24 text-center" role="alert"><strong>{current.stage === 'execute' ? 'Rewind incomplete' : 'Could not generate rewind preview'}</strong><p>{current.detail}</p><div class="form-actions flex justify-end gap-8 mt-20"><Button onClick={close}>Close</Button><Show when={current.stage !== 'execute'}><Button variant="primary" onClick={restart}>Query again</Button></Show></div></div>;
        }}</Match>
      </Switch>
    </section>
  </Dialog>;
}

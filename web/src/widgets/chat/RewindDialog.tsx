import { For, Match, Show, Switch } from 'solid-js';
import { Button, Dialog, DialogContent, DialogTitle, EmptyState, IconButton, Listbox, ListboxItem, LoadingState } from '@peri/ui';
import { closeRewindFlow, executeRewind, openRewindFlow, previewRewind, rewindFlow } from '@/features/runtime/rewind-assembly';
import { X } from 'lucide-solid';
import { RESOURCE_PANEL_HEADER_CLASS, RESOURCE_PANEL_SURFACE_CLASS, RESOURCE_PANEL_TITLE_CLASS } from '@/widgets/resource/resource-panel-layout';

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

  return <Dialog open={props.open} onOpenChange={(open) => { if (!open && !executing()) close(); }}><DialogContent
    data-resource-panel="rewind"
    dismissible={!executing()}
    overlayClass="bg-transparent max-desk:bg-scrim"
    class={`fixed left-auto z-61 flex h-auto max-h-none translate-x-0 translate-y-0 flex-col p-0 ${RESOURCE_PANEL_SURFACE_CLASS} max-desk:inset-y-0 max-desk:right-0 max-desk:h-auto max-desk:w-(--container-rewind-compact) max-desk:rounded-none max-desk:border-y-0 max-desk:border-r-0`}
  ><header class={RESOURCE_PANEL_HEADER_CLASS}><DialogTitle class={RESOURCE_PANEL_TITLE_CLASS}>Rewind session</DialogTitle><IconButton label="Close rewind panel" size="compact" disabled={executing()} onClick={close} class="border-0 bg-transparent text-text-muted"><X size={14} strokeWidth={1.7} /></IconButton></header>
    <section class="box-border min-h-0 flex-1 overflow-auto px-10 py-10">
      <Switch>
        <Match when={state().kind === 'loading_candidates'}>
          <LoadingState class="rewind-panel__state" label="Reading rewindable messages" description="Reading user messages from the Peri session history." />
        </Match>
        <Match when={state().kind === 'select_target' && state()} keyed>{(current) => {
          if (current.kind !== 'select_target') return null;
          return <>
            <div class="pt-8 pb-16"><strong class="text-15 text-text-primary">Choose the message to rewind to</strong><p class="mt-5 mb-0 text-13 leading-155 text-text-secondary">Messages after it will be removed. You will see the file impact first; nothing executes immediately.</p></div>
            <Show when={current.candidates.length} fallback={<EmptyState variant="inline" class="rewind-panel__state" title="No user messages" description="The current session has no user messages to rewind to." />}>
              <Listbox class="grid gap-7 m-0 p-0 list-none" aria-label="Rewind target message" options={current.candidates} optionValue="messageId" optionTextValue={(candidate) => candidate.preview || 'Empty message'} selectionMode="single" onChange={(selected) => {
                const id = [...selected][0];
                const candidate = current.candidates.find((item) => item.messageId === id);
                if (candidate) previewRewind(candidate);
              }} renderItem={(item) => <ListboxItem item={item} class="grid w-full min-h-58 grid-cols-split-auto items-center gap-18 rounded-12 border border-divider bg-surface-muted px-13 py-11 text-left text-text-primary hover:border-border-strong hover:bg-selected">
                <span class="ui-line-clamp-2 overflow-hidden text-13 leading-145">{item.rawValue.preview || 'Empty message'}</span><small class="whitespace-nowrap text-11 text-text-muted">Message {current.candidates.findIndex((candidate) => candidate.messageId === item.rawValue.messageId) + 1}</small>
              </ListboxItem>} />
            </Show>
          </>;
        }}</Match>
        <Match when={state().kind === 'loading_preview'}>
          <LoadingState class="rewind-panel__state" label="Generating rewind preview" description="Checking the session history and workspace file impact." />
        </Match>
        <Match when={state().kind === 'confirm' && state()} keyed>{(current) => {
          if (current.kind !== 'confirm') return null;
          return <>
            <div class="pt-8 pb-16"><strong class="text-15 text-text-primary">Confirm the rewind impact</strong><p class="mt-5 mb-0 text-13 leading-155 text-text-secondary">The session will rewind to before this message and reload the server projection.</p></div>
            <blockquote class="m-0 rounded-r-10 border-l-3 border-solid-l border-l-text-primary bg-surface-muted px-15 py-13 text-13 leading-15 text-text-primary">{current.candidate.preview || 'Empty message'}</blockquote>
            <section class="mt-18" aria-labelledby="rewind-files-title">
              <h3 id="rewind-files-title" class="mb-8 mt-0 text-12 text-text-primary">File impact · {current.fileChanges.length}</h3>
              <Show when={current.fileChanges.length} fallback={<p class="m-0 text-12 text-text-secondary">No workspace files need to be restored.</p>}>
                <ul class="grid gap-5 m-0 p-0 list-none"><For each={current.fileChanges}>{(change) => <li class="flex min-w-0 items-center justify-between gap-12 rounded-9 bg-surface-muted px-10 py-8"><code class="overflow-hidden text-ellipsis whitespace-nowrap text-11 text-text-primary">{change.path}</code><span class="shrink-0 text-11 text-text-muted">{change.kind === 'write' ? 'Restore write' : 'Restore edit'}</span></li>}</For></ul>
              </Show>
            </section>
            <p class="mt-18 mb-0 rounded-10 border border-danger-border bg-surface px-12 py-10 text-12 leading-15 !text-danger">This is a destructive action. Do not repeat it after confirming; if the result is unknown, reopen the session to check.</p>
            <div class="rewind-panel__actions"><Button onClick={close}>Cancel</Button><Button variant="danger" onClick={executeRewind}>Rewind session and files</Button></div>
          </>;
        }}</Match>
        <Match when={state().kind === 'executing'}>
          <LoadingState class="rewind-panel__state" label="Executing rewind" description="Keep the page open. This operation will not retry automatically.">Rewinding and reloading the session</LoadingState>
        </Match>
        <Match when={state().kind === 'completed'}>
          <div class="rewind-panel__state text-success"><strong class="text-15 text-text-primary">Rewind complete</strong><p class="mt-5 mb-0 text-13 leading-155 text-text-secondary">The session history and file projection have been reloaded.</p><Button class="mt-18" variant="primary" onClick={close}>Done</Button></div>
        </Match>
        <Match when={state().kind === 'delivery_unknown' && state()} keyed>{(current) => {
          if (current.kind !== 'delivery_unknown') return null;
          return <div class="rewind-panel__state justify-items-start rounded-12 border border-warning-border bg-surface text-left" role="alert"><strong class="text-15 text-text-primary">Rewind result not confirmed</strong><p class="mt-5 mb-0 text-13 leading-155 text-text-secondary">{current.detail}</p><p class="mt-5 mb-0 text-13 leading-155 text-text-secondary">To avoid duplicate changes, re-execution is not offered. Close this window and reopen the session to check the history and files.</p><Button class="mt-18" onClick={close}>Got it</Button></div>;
        }}</Match>
        <Match when={state().kind === 'error' && state()} keyed>{(current) => {
          if (current.kind !== 'error') return null;
          return <div class="rewind-panel__state" role="alert"><strong class="text-15 text-text-primary">{current.stage === 'execute' ? 'Rewind incomplete' : 'Could not generate rewind preview'}</strong><p class="mt-5 mb-0 text-13 leading-155 text-text-secondary">{current.detail}</p><div class="rewind-panel__actions"><Button onClick={close}>Close</Button><Show when={current.stage !== 'execute'}><Button variant="primary" onClick={restart}>Query again</Button></Show></div></div>;
        }}</Match>
      </Switch>
    </section>
  </DialogContent></Dialog>;
}

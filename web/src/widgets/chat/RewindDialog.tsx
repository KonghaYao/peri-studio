import { For, Match, Show, Switch } from 'solid-js';
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InlineNotice,
  Listbox,
  ListboxItem,
  LoadingState,
  RewindDialogIntro,
  RewindDialogSection,
  RewindDialogShell,
  RewindPanelActions,
  RewindPanelState,
  rewindDialogOverlayClass,
  rewindPanelActionButtonClass,
  rewindPanelLoadingSpinnerClass,
  rewindPanelLoadingStateClass,
} from '@peri/ui';
import { closeRewindFlow, executeRewind, openRewindFlow, previewRewind, rewindFlow } from '@/features/runtime/rewind-assembly';
import { X } from 'lucide-solid';

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

  return (
    <Dialog open={props.open} onOpenChange={(open) => { if (!open && !executing()) close(); }}>
      <DialogContent
        data-resource-panel="rewind"
        size="rewind"
        dismissible={!executing()}
        overlayClass={rewindDialogOverlayClass}
      >
        <DialogTitle class="sr-only">Rewind session</DialogTitle>
        <RewindDialogShell
          title="Rewind session"
          actions={
            <IconButton
              label="Close rewind panel"
              size="compact"
              disabled={executing()}
              onClick={close}
              class="border-0 bg-transparent text-text-muted"
            >
              <X size={14} strokeWidth={1.7} />
            </IconButton>
          }
          footer={
            <Show when={state().kind === 'confirm'}>
              <RewindPanelActions>
                <Button class={rewindPanelActionButtonClass} onClick={close}>Cancel</Button>
                <Button class={rewindPanelActionButtonClass} variant="danger" onClick={executeRewind}>
                  Rewind session and files
                </Button>
              </RewindPanelActions>
            </Show>
          }
        >
          <Switch>
            <Match when={state().kind === 'loading_candidates'}>
              <LoadingState
                class={rewindPanelLoadingStateClass}
                spinnerClass={rewindPanelLoadingSpinnerClass}
                label="Reading rewindable messages"
                description="Reading user messages from the Peri session history."
              />
            </Match>
            <Match when={state().kind === 'select_target' && state()} keyed>
              {(current) => {
                if (current.kind !== 'select_target') return null;
                return (
                  <>
                    <RewindDialogIntro
                      title="Choose a message to rewind to"
                      description="Messages after it will be removed. You will see the file impact first; nothing executes immediately."
                    />
                    <Show
                      when={current.candidates.length}
                      fallback={
                        <RewindPanelState
                          title="No user messages"
                          description="The current session has no user messages to rewind to."
                        />
                      }
                    >
                      <Listbox
                        class="grid gap-7 m-0 p-0 list-none"
                        aria-label="Rewind target message"
                        options={current.candidates}
                        optionValue="messageId"
                        optionTextValue={(candidate) => candidate.preview || 'Empty message'}
                        selectionMode="single"
                        onChange={(selected) => {
                          const id = [...selected][0];
                          const candidate = current.candidates.find((item) => item.messageId === id);
                          if (candidate) previewRewind(candidate);
                        }}
                        renderItem={(item) => (
                          <ListboxItem
                            item={item}
                            class="grid w-full min-h-58 grid-cols-split-auto items-center gap-18 rounded-12 border border-divider bg-surface-muted px-13 py-11 text-left text-text-primary hover:border-border-strong hover:bg-selected"
                          >
                            <span class="line-clamp-2 overflow-hidden text-13 leading-145">
                              {item.rawValue.preview || 'Empty message'}
                            </span>
                            <small class="whitespace-nowrap text-11 text-text-muted">
                              Message {current.candidates.findIndex((candidate) => candidate.messageId === item.rawValue.messageId) + 1}
                            </small>
                          </ListboxItem>
                        )}
                      />
                    </Show>
                  </>
                );
              }}
            </Match>
            <Match when={state().kind === 'loading_preview'}>
              <LoadingState
                class={rewindPanelLoadingStateClass}
                spinnerClass={rewindPanelLoadingSpinnerClass}
                label="Generating rewind preview"
                description="Checking the session history and workspace file impact."
              />
            </Match>
            <Match when={state().kind === 'confirm' && state()} keyed>
              {(current) => {
                if (current.kind !== 'confirm') return null;
                return (
                  <>
                    <RewindDialogIntro
                      title="Confirm the rewind impact"
                      description="The session will rewind to before this message and reload the server projection."
                    />
                    <blockquote class="m-0 rounded-r-10 border-l-3 border-solid-l border-l-text-primary bg-surface-muted px-15 py-13 text-13 leading-15 text-text-primary">
                      {current.candidate.preview || 'Empty message'}
                    </blockquote>
                    <RewindDialogSection
                      title={`File impact · ${current.fileChanges.length}`}
                      headingId="rewind-files-title"
                    >
                      <Show
                        when={current.fileChanges.length}
                        fallback={<p class="m-0 text-12 text-text-secondary">No workspace files need to be restored.</p>}
                      >
                        <ul class="grid gap-5 m-0 p-0 list-none">
                          <For each={current.fileChanges}>
                            {(change) => (
                              <li class="flex min-w-0 items-center justify-between gap-12 rounded-9 bg-surface-muted px-10 py-8">
                                <code class="overflow-hidden text-ellipsis whitespace-nowrap text-11 text-text-primary">
                                  {change.path}
                                </code>
                                <span class="shrink-0 text-11 text-text-muted">
                                  {change.kind === 'write' ? 'Restore write' : 'Restore edit'}
                                </span>
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                    </RewindDialogSection>
                    <InlineNotice
                      class="mt-16"
                      tone="danger"
                      role="alert"
                      title="Destructive action"
                    >
                      This is a destructive action. Do not repeat it after confirming; if the result is unknown, reopen the session to check.
                    </InlineNotice>
                  </>
                );
              }}
            </Match>
            <Match when={state().kind === 'executing'}>
              <LoadingState
                class={rewindPanelLoadingStateClass}
                spinnerClass={rewindPanelLoadingSpinnerClass}
                label="Executing rewind"
                description="Keep the page open. This operation will not retry automatically."
              >
                Rewinding and reloading the session
              </LoadingState>
            </Match>
            <Match when={state().kind === 'completed'}>
              <RewindPanelState
                title="Rewind complete"
                description="The session history and file projection have been reloaded."
              >
                <Button class="mt-12" variant="primary" onClick={close}>Done</Button>
              </RewindPanelState>
            </Match>
            <Match when={state().kind === 'delivery_unknown' && state()} keyed>
              {(current) => {
                if (current.kind !== 'delivery_unknown') return null;
                return (
                  <RewindPanelState class="items-start text-left">
                    <InlineNotice tone="warning" role="alert" title="Rewind result not confirmed">
                      <p class="mt-5 mb-0">{current.detail}</p>
                      <p class="mt-5 mb-0">
                        To avoid duplicate changes, re-execution is not offered. Close this window and reopen the session to check the history and files.
                      </p>
                      <Button class="mt-18" onClick={close}>Got it</Button>
                    </InlineNotice>
                  </RewindPanelState>
                );
              }}
            </Match>
            <Match when={state().kind === 'error' && state()} keyed>
              {(current) => {
                if (current.kind !== 'error') return null;
                return (
                  <RewindPanelState>
                    <InlineNotice
                      tone="danger"
                      role="alert"
                      title={current.stage === 'execute' ? 'Rewind incomplete' : 'Could not generate rewind preview'}
                    >
                      <p class="mt-5 mb-0">{current.detail}</p>
                      <RewindPanelActions>
                        <Button class={rewindPanelActionButtonClass} onClick={close}>Close</Button>
                        <Show when={current.stage !== 'execute'}>
                          <Button class={rewindPanelActionButtonClass} variant="primary" onClick={restart}>
                            Query again
                          </Button>
                        </Show>
                      </RewindPanelActions>
                    </InlineNotice>
                  </RewindPanelState>
                );
              }}
            </Match>
          </Switch>
        </RewindDialogShell>
      </DialogContent>
    </Dialog>
  );
}

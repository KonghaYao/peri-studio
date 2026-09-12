import { createEffect, createSignal, createUniqueId, Show } from 'solid-js';
import { Button, IconButton, InlineNotice, Textarea } from '@peri/ui';
import { createSessionWithFirstMessage, creatingSessionProjectId, retryQuickStart, clearSubmittedWorkspaceUploads } from '@/store';
import { readOnly } from '@/features/auth/auth-state';
import { dismissFailedQuickStart, quickStartSubmission } from '@/features/message/quick-start-delivery';
import { promptMaxBytes } from '@/features/connection/connection';
import { promptByteLength, promptFitsBudget } from '@/shared/lib/prompt-budget';
import { Plus, SendHorizontal } from 'lucide-solid';
import { ComposerUploadSurface, openComposerUploadFilePicker } from './ComposerUploadSurface';

const sendActionClass =
  'composer-action flex w-36 min-h-36 shrink-0 items-center justify-center rounded-8 max-narrow:w-48 max-narrow:min-h-44';

export function QuickStartComposer(props: { projects: Array<{ id: string; name: string }>; initialProjectId?: string }) {
  const [draft, setDraft] = createSignal('');
  const statusId = `quick-start-status-${createUniqueId()}`;
  const budgetId = `quick-start-budget-${createUniqueId()}`;
  const uploadDropDescId = `quick-start-upload-drop-${createUniqueId()}`;
  const [projectId, setProjectId] = createSignal(props.initialProjectId || props.projects[0]?.id || '');
  let quickStartSurfaceRef: HTMLDivElement | undefined;
  let uploadFileInputRef: HTMLInputElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;
  const pending = () => quickStartSubmission();
  const pendingIsInFlight = () => pending()?.phase === 'creating' || pending()?.phase === 'accepted';
  const pendingNeedsAttention = () => pending()?.phase === 'uncertain' || pending()?.phase === 'failed';
  const draftBytes = () => promptByteLength(draft().trim());
  const promptOverBudget = () => !!draft().trim() && !promptFitsBudget(draft().trim(), promptMaxBytes());
  const locked = () => (!!pending() && pending()!.phase !== 'failed') || !!creatingSessionProjectId();
  const inputDisabled = () => readOnly() || locked();
  const project = () => props.projects.find((item) => item.id === projectId());
  createEffect(() => {
    if (!pending() && !project()) setProjectId(props.projects[0]?.id || '');
  });
  const focusAt = (caret: number) => {
    queueMicrotask(() => {
      textareaRef?.focus();
      textareaRef?.setSelectionRange(caret, caret);
    });
  };
  const submit = () => {
    const text = draft().trim();
    const targetProjectId = projectId();
    if (!text || pending() || !targetProjectId || !promptFitsBudget(text, promptMaxBytes())) return;
    if (createSessionWithFirstMessage(targetProjectId, text)) {
      clearSubmittedWorkspaceUploads(targetProjectId, 'quickstart');
    }
  };

  return <section data-testid="quick-start-docked" class="quick-start quick-start--docked w-full text-left" aria-label="Start new session">
    <div
      ref={quickStartSurfaceRef}
      data-testid="quick-start-surface"
      class="quick-start__surface relative overflow-hidden border border-composer-border rounded-(--composer-radius) bg-surface-overlay p-2.5 max-narrow:rounded-16"
      aria-busy={pendingIsInFlight() || undefined}
    >
      <ComposerUploadSurface
        origin="quickstart"
        projectId={projectId() || null}
        disabled={inputDisabled()}
        dropDescId={uploadDropDescId}
        surfaceRef={quickStartSurfaceRef}
        registerFileInput={(element) => { uploadFileInputRef = element; }}
        getDraft={draft}
        setDraft={setDraft}
        focusAt={focusAt}
        readCaret={() => ({
          start: textareaRef?.selectionStart ?? draft().length,
          end: textareaRef?.selectionEnd ?? draft().length,
        })}
      />
      <Textarea
        ref={textareaRef}
        autoResize
        maxHeight={180}
        value={draft()}
        disabled={inputDisabled()}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
        }}
        placeholder="Message the agent, or type / for commands"
        aria-label="First message"
        aria-describedby={[pendingNeedsAttention() ? statusId : '', promptOverBudget() ? budgetId : ''].filter(Boolean).join(' ') || undefined}
        variant="bare"
        class="quick-start__textarea w-full min-h-36 border-0 outline-0 resize-none bg-transparent px-1 text-14 leading-22 text-text-primary shadow-none"
      />
      <Show when={promptOverBudget()}>
        <InlineNotice id={budgetId} class="mb-8" tone="danger" role="alert" title="First message is too large">
          <span>{promptMaxBytes() > 0
            ? `${draftBytes()} / ${promptMaxBytes()} bytes. Shorten the message before starting a session.`
            : 'Secure message delivery is not enabled on the server. Refresh or upgrade the server before starting a session.'}</span>
        </InlineNotice>
      </Show>
      <div class="quick-start__footer ui-composer-toolbar flex min-h-36 min-w-0 items-center gap-4">
        <IconButton
          label="Add attachment"
          title="Upload files to this project"
          disabled={inputDisabled() || !projectId()}
          class="composer-attachment max-narrow:hidden shrink-0 border-0 bg-transparent text-content-primary disabled:opacity-55"
          onClick={() => {
            openComposerUploadFilePicker(uploadFileInputRef);
            queueMicrotask(() => textareaRef?.focus());
          }}
        >
          <Plus size={18} strokeWidth={1.7} />
        </IconButton>
        <span class="flex-1" />
        <IconButton
          data-testid="composer-action"
          tooltipPlacement="end"
          variant="primary"
          label="Start session"
          busy={pending()?.phase === 'creating' || pending()?.phase === 'accepted'}
          disabled={readOnly() || locked() || !!pending() || !draft().trim() || promptOverBudget()}
          onClick={submit}
          class={sendActionClass}
        >
          <SendHorizontal size={18} strokeWidth={1.7} />
        </IconButton>
      </div>
    </div>
    <Show when={pendingNeedsAttention() ? pending() : null}>{(submission) => <InlineNotice id={statusId} class="quick-start__state mt-8" tone={submission().phase === 'failed' ? 'danger' : 'warning'} role="alert" title={submission().phase === 'uncertain' ? 'Creation result not confirmed yet' : 'Failed to create session'}>
      <span>{submission().phase === 'uncertain' ? 'Re-confirming uses the original request and will not create a duplicate project session.' : 'The draft remains local until you choose to start again.'}</span>
      <Show when={submission().detail}><small>{submission().detail}</small></Show>
      <div class="quick-start__actions flex flex-wrap gap-6">
        <Show when={(submission().phase === 'failed' || submission().phase === 'uncertain') && submission().retryable}><Button size="compact" variant="secondary" onClick={retryQuickStart}>Re-confirm with the same request</Button></Show>
        <Show when={submission().phase === 'failed'}><Button size="compact" onClick={dismissFailedQuickStart}>Back to edit</Button></Show>
      </div>
    </InlineNotice>}</Show>
  </section>;
}

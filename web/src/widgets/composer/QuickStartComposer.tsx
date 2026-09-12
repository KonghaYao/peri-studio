import { createEffect, createSignal, createUniqueId, Show } from 'solid-js';
import {
  Button,
  ComposerAttachmentButton,
  ComposerInputField,
  ComposerSendStopAction,
  ComposerToolbarShell,
  InlineNotice,
} from '@peri/ui';
import { createSessionWithFirstMessage, creatingSessionProjectId, retryQuickStart, clearSubmittedWorkspaceUploads } from '@/store';
import { readOnly } from '@/features/auth/auth-state';
import { dismissFailedQuickStart, quickStartSubmission } from '@/features/message/quick-start-delivery';
import { promptMaxBytes } from '@/features/connection/connection';
import { promptByteLength, promptFitsBudget } from '@/shared/lib/prompt-budget';
import { ComposerUploadSurface, openComposerUploadFilePicker } from './ComposerUploadSurface';

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
  const inputDescribedBy = () => {
    const ids = [
      pendingNeedsAttention() ? statusId : '',
      promptOverBudget() ? budgetId : '',
    ].filter(Boolean);
    return ids.length > 0 ? ids.join(' ') : undefined;
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
      data-slot="composer-surface"
      data-testid="quick-start-surface"
      class="composer-rect-surface"
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
      <ComposerInputField
        ref={(el) => { textareaRef = el; }}
        value={draft()}
        disabled={inputDisabled()}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
        }}
        placeholder="Message the agent, or type / for commands"
        aria-label="First message"
        aria-describedby={inputDescribedBy()}
        fieldClass="text-14 leading-22 text-text-primary"
      />
      <Show when={promptOverBudget()}>
        <InlineNotice id={budgetId} class="mb-8" tone="danger" role="alert" title="First message is too large">
          <span>{promptMaxBytes() > 0
            ? `${draftBytes()} / ${promptMaxBytes()} bytes. Shorten the message before starting a session.`
            : 'Secure message delivery is not enabled on the server. Refresh or upgrade the server before starting a session.'}</span>
        </InlineNotice>
      </Show>
      <ComposerToolbarShell
        left={(
          <ComposerAttachmentButton
            disabled={inputDisabled() || !projectId()}
            onClick={() => {
              openComposerUploadFilePicker(uploadFileInputRef);
              queueMicrotask(() => textareaRef?.focus());
            }}
          />
        )}
        right={(
          <ComposerSendStopAction
            mode="send"
            label="Start session"
            busy={pending()?.phase === 'creating' || pending()?.phase === 'accepted'}
            disabled={readOnly() || locked() || !!pending() || !draft().trim() || promptOverBudget()}
            onClick={submit}
          />
        )}
      />
    </div>
    <Show when={pendingNeedsAttention() ? pending() : null}>{(submission) => <InlineNotice id={statusId} class="mt-8" tone={submission().phase === 'failed' ? 'danger' : 'warning'} role="alert" title={submission().phase === 'uncertain' ? 'Creation result not confirmed yet' : 'Failed to create session'}>
      <span>{submission().phase === 'uncertain' ? 'Re-confirming uses the original request and will not create a duplicate project session.' : 'The draft remains local until you choose to start again.'}</span>
      <Show when={submission().detail}><small class="min-w-0">{submission().detail}</small></Show>
      <div class="flex flex-wrap gap-6">
        <Show when={(submission().phase === 'failed' || submission().phase === 'uncertain') && submission().retryable}><Button size="compact" variant="secondary" onClick={retryQuickStart}>Re-confirm with the same request</Button></Show>
        <Show when={submission().phase === 'failed'}><Button size="compact" onClick={dismissFailedQuickStart}>Back to edit</Button></Show>
      </div>
    </InlineNotice>}</Show>
  </section>;
}

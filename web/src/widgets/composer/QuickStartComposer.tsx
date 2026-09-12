import { createEffect, createSignal, createUniqueId, Show, type Component } from 'solid-js';
import {
  Button,
  ComposerInputField,
  ComposerPlusMenu,
  ComposerSendStopAction,
  ComposerShell,
  type ComposerShellFieldContext,
  InlineNotice,
} from '@peri/ui';
import { createSessionWithFirstMessage, creatingSessionProjectId, retryQuickStart, clearSubmittedWorkspaceUploads } from '@/store';
import { readOnly } from '@/features/auth/auth-state';
import { dismissFailedQuickStart, quickStartSubmission } from '@/features/message/quick-start-delivery';
import { promptMaxBytes } from '@/features/connection/connection';
import { promptByteLength, promptFitsBudget } from '@/shared/lib/prompt-budget';
import { ComposerUploadSurface, openComposerUploadFilePicker } from './ComposerUploadSurface';

type QuickStartMessageFieldProps = {
  ctx: ComposerShellFieldContext;
  draft: () => string;
  setDraft: (value: string) => void;
  inputDisabled: () => boolean;
  inputDescribedBy: () => string | undefined;
  onBindTaRef: (element: HTMLTextAreaElement | undefined) => void;
  onSubmit: () => void;
};

const QuickStartMessageField: Component<QuickStartMessageFieldProps> = (props) => (
  <ComposerInputField
    shell
    ref={(el) => {
      props.ctx.bindRef(el);
      props.onBindTaRef(el);
    }}
    fieldClass={props.ctx.fieldClass}
    maxHeight={props.ctx.maxHeight}
    value={props.draft()}
    disabled={props.inputDisabled()}
    onInput={(event) => props.setDraft(event.currentTarget.value)}
    onKeyDown={(event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        props.onSubmit();
      }
    }}
    placeholder="Message the agent, or type / for commands"
    aria-label="First message"
    aria-describedby={props.inputDescribedBy()}
  />
);

export function QuickStartComposer(props: { projects: Array<{ id: string; name: string }>; initialProjectId?: string }) {
  const [draft, setDraft] = createSignal('');
  const statusId = `quick-start-status-${createUniqueId()}`;
  const budgetId = `quick-start-budget-${createUniqueId()}`;
  const uploadDropDescId = `quick-start-upload-drop-${createUniqueId()}`;
  const [projectId, setProjectId] = createSignal(props.initialProjectId || props.projects[0]?.id || '');
  const [plusOpen, setPlusOpen] = createSignal(false);
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

  return <section data-testid="quick-start-docked" class="w-full text-left" aria-label="Start new session">
    <ComposerShell
      data-testid="quick-start-surface"
      aria-busy={pendingIsInFlight() || undefined}
      disabled={inputDisabled()}
      draft={draft()}
      surfaceRef={(element) => {
        quickStartSurfaceRef = element;
      }}
      innerLeading={(
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
      )}
      renderField={QuickStartMessageField}
      renderFieldProps={{
        draft,
        setDraft,
        inputDisabled,
        inputDescribedBy,
        onBindTaRef: (element: HTMLTextAreaElement | undefined) => {
          textareaRef = element;
        },
        onSubmit: submit,
      }}
      compactLeading={(
        <ComposerPlusMenu
          open={plusOpen()}
          onOpenChange={setPlusOpen}
          disabled={inputDisabled() || !projectId()}
          upload={{
            onClick: () => {
              openComposerUploadFilePicker(uploadFileInputRef);
              queueMicrotask(() => textareaRef?.focus());
            },
          }}
          slashMenu={<></>}
        />
      )}
      compactTrailing={(
        <ComposerSendStopAction
          mode="send"
          shape="pill"
          label="Start session"
          busy={pending()?.phase === 'creating' || pending()?.phase === 'accepted'}
          disabled={readOnly() || locked() || !!pending() || !draft().trim() || promptOverBudget()}
          onClick={submit}
        />
      )}
      notices={(
        <Show when={promptOverBudget()}>
          <InlineNotice id={budgetId} class="mb-8" tone="danger" role="alert" title="First message is too large">
            <span>{promptMaxBytes() > 0
              ? `${draftBytes()} / ${promptMaxBytes()} bytes. Shorten the message before starting a session.`
              : 'Secure message delivery is not enabled on the server. Refresh or upgrade the server before starting a session.'}</span>
          </InlineNotice>
        </Show>
      )}
    />
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

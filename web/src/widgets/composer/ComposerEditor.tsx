import { Show } from 'solid-js';
import { Button, ComposerInputField, InlineNotice } from '@peri/ui';
import { slashMenuOptionId } from '@/features/composer/slash-menu';
import type { ComposerState } from './useComposerState';

export function ComposerEditor(props: {
  centered: boolean;
  state: ComposerState;
  taRef: (el: HTMLTextAreaElement | undefined) => void;
  focusInput: () => void;
}) {
  const s = () => props.state;
  const draftText = () => s().composerDraft(s().draftOwner());
  const enabledHint = () => {
    if (s().inputDisabled() || draftText().length > 0) return null;
    const prediction = s().prediction.activePrediction();
    if (prediction) return { kind: 'prediction' as const, text: prediction.text };
    const placeholder = s().inputPlaceholder();
    if (!placeholder) return null;
    return { kind: 'placeholder' as const, text: placeholder };
  };

  return (
    <>
      <ComposerInputField
        centered={props.centered}
        hint={enabledHint()}
        ref={props.taRef}
        value={draftText()}
        onInput={(e) => {
          if (e.isComposing) return;
          s().commitInputValue(e.currentTarget);
        }}
        onCompositionEnd={(e) => s().commitInputValue(e.currentTarget)}
        onSelect={(e) => s().slash.onCaret(e.currentTarget)}
        onBlur={s().slash.onBlur}
        onKeyDown={(e) => {
          if (e.isComposing || e.keyCode === 229) return;
          if (s().slash.handleKeyDown(e)) return;
          if (s().prediction.activePrediction() && e.key === 'Tab') {
            e.preventDefault();
            s().prediction.accept();
            return;
          }
          if (s().prediction.activePrediction() && e.key === 'Escape') {
            e.preventDefault();
            s().prediction.dismiss();
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            s().submit();
          }
        }}
        placeholder={s().inputDisabled() ? s().inputPlaceholder() : ''}
        disabled={s().inputDisabled()}
        aria-label="Message the agent"
        aria-autocomplete="list"
        aria-expanded={s().slash.slashMenuOpen()}
        aria-controls={s().slash.slashMenuOpen() ? s().slashMenuId : undefined}
        aria-activedescendant={
          s().slash.slashMenuOpen()
            ? (() => {
                const active = s().slash.slashItems()[s().slash.boundedActiveIndex()];
                return active ? slashMenuOptionId(s().slashMenuId, active.name) : undefined;
              })()
            : undefined
        }
        aria-describedby={s().inputDescribedBy()}
        spellcheck={false}
      />
      <Show when={s().promptOverBudget()}>
        <InlineNotice id={s().promptBudgetStatusId} class="mb-8" tone="danger" role="alert" title="Message is too large">
          <span>
            {s().draftBytes()} / {s().promptMaxBytes()} bytes. Shorten the message before sending.
          </span>
        </InlineNotice>
      </Show>
      <Show when={s().submissionNeedsAttention() ? s().submissionForSession() : null}>
        {(submission) => (
          <InlineNotice
            id={s().submissionStatusId}
            class={`composer-submission composer-submission--${submission().phase} mt-2 mb-8 border-dashed`}
            title={s().submissionTitle()}
            tone={s().submissionTone()}
            role="note"
          >
            <p>{s().submissionDetail()}</p>
            <div class="composer-submission__actions flex flex-wrap gap-6 mt-8">
              <Show when={submission().phase === 'uncertain' && submission().retryable}>
                <Button size="compact" variant="secondary" class="pointer-coarse:min-h-44" onClick={s().retryMessageSubmission}>
                  Confirm with the same request
                </Button>
              </Show>
              <Show when={submission().phase === 'failed'}>
                <Button size="compact" class="pointer-coarse:min-h-44" onClick={s().restoreFailedDraft}>
                  Back to edit
                </Button>
              </Show>
              <Show when={submission().phase === 'delivery_unknown'}>
                <Button
                  size="compact"
                  variant="secondary"
                  class="pointer-coarse:min-h-44"
                  disabled={!s().canAcknowledgeUnknownMessageDelivery(submission().commandId)}
                  onClick={() => {
                    if (!s().acknowledgeUnknownMessageDelivery(submission().commandId)) return;
                    queueMicrotask(() => props.focusInput());
                  }}
                >
                  Acknowledge and continue
                </Button>
              </Show>
            </div>
          </InlineNotice>
        )}
      </Show>
    </>
  );
}

import { Show } from 'solid-js';
import { Button, InlineNotice, Textarea } from '@peri/ui';
import { cn } from '@peri/ui';
import { slashMenuOptionId } from '@/features/composer/slash-menu';
import type { ComposerState } from './useComposerState';

function composerFieldClasses(centered: boolean) {
  return cn(
    'composer-editor__field block w-full resize-none overflow-y-auto border-0 bg-transparent px-1 py-8 outline-0',
    centered ? 'min-h-72 max-h-180 text-14 leading-22' : 'min-h-36 max-h-180 text-13 leading-normal',
  );
}

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
  const fieldClass = () => composerFieldClasses(props.centered);

  return (
    <>
      <div class="composer-editor relative">
        <Show when={enabledHint()}>
          {(hint) => (
            <>
              <div
                data-testid={hint().kind === 'prediction' ? 'composer-prediction' : 'composer-placeholder-hint'}
                class={cn(
                  'composer-editor__hint',
                  fieldClass(),
                  hint().kind === 'prediction' ? 'text-content-faint composer-editor__hint--prediction' : 'text-content-muted',
                )}
                aria-hidden="true"
              >
                {hint().text}
              </div>
              <Show when={hint().kind === 'prediction'}>
                <span id="composer-prediction-description" class="sr-only">
                  Peri suggests: {hint().text}. Press Tab to use it, or Escape to ignore.
                </span>
              </Show>
            </>
          )}
        </Show>
        <Textarea
          ref={props.taRef}
          autoResize
          maxHeight={180}
          variant="bare"
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
          data-testid="composer-input"
          class={cn(
            'composer-input ui-scrollbar relative z-1 placeholder:text-content-muted disabled:bg-transparent disabled:text-content-secondary focus-visible:outline-0',
            fieldClass(),
          )}
        />
      </div>
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

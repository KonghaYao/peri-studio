// 发送窗口（Composer）：输入区 + 底部工具行（ui.md §3.8 / §四.7）。
// 编排与 store 接线留在此；视觉组件来自 @peri/ui，业务映射在 features。

import { Show, type JSX } from 'solid-js';
import {
  Button,
  ComposerAttachmentButton,
  ComposerInputField,
  ComposerPredictionButton,
  ComposerQueue,
  ComposerSendStopAction,
  ComposerSkillsButton,
  ComposerToolbarShell,
  InlineNotice,
  SlashMenuListbox,
  TokenUsageMeter,
  cn,
} from '@peri/ui';
import { agentCommandToSlashMenuItem } from '@/features/composer/slash-menu-catalog';
import { slashMenuOptionId } from '@/features/composer/slash-menu';
import { ComposerUploadSurface, openComposerUploadFilePicker } from './ComposerUploadSurface';
import { ComposerStagedAssets } from './ComposerStagedAssets';
import { useComposerState } from './useComposerState';

export function Composer(props: {
  layout?: 'docked' | 'centered';
  renderRuntimeMenu?: (ctx: { id: string; disabled: boolean }) => JSX.Element;
}) {
  const centered = () => props.layout === 'centered';
  let taRef: HTMLTextAreaElement | undefined;
  let composerSurfaceRef: HTMLElement | undefined;
  const state = useComposerState(() => taRef);

  const focusInput = () => {
    taRef?.focus();
  };

  const runtimeMenu = () =>
    props.renderRuntimeMenu?.({
      id: state.modelMenuId,
      disabled: state.runtimeMenuDisabled(),
    }) ?? null;

  const draftText = () => state.composerDraft(state.draftOwner());
  const enabledHint = () => {
    if (state.inputDisabled() || draftText().length > 0) return null;
    const prediction = state.prediction.activePrediction();
    if (prediction) return { kind: 'prediction' as const, text: prediction.text };
    const placeholder = state.inputPlaceholder();
    if (!placeholder) return null;
    return { kind: 'placeholder' as const, text: placeholder };
  };

  return (
    <div
      data-testid="composer-wrap"
      class={cn(
        'composer-wrap relative w-full',
        centered() ? 'composer-wrap--centered' : 'composer-wrap--overlay chat-column',
      )}
    >
      <Show when={state.queueItems().length > 0}>
        <ComposerQueue
          class="mb-8"
          items={state.queueItems()}
          onSendNow={state.sendQueueItemNow}
          onEdit={state.editQueueItem}
          onRemove={state.removeQueueItem}
          onMore={state.moreQueueItem}
        />
      </Show>
      <Show when={state.slash.slashMenuOpen()}>
        <SlashMenuListbox
          id={state.slashMenuId}
          items={state.slash.slashItems()}
          activeIndex={state.slash.boundedActiveIndex()}
          toMenuItem={agentCommandToSlashMenuItem}
          optionValue={(item) => item.name}
          optionTextValue={(item) => `${item.name} ${item.description}`}
          getOptionId={(menuId, item) => slashMenuOptionId(menuId, item.name)}
          namePrefix="/"
          onActiveIndex={state.slash.onMenuActiveIndex}
          onSelect={(item) => state.slash.selectCommand(item.name)}
          onKeyDown={(event) => state.slash.handleKeyDown(event)}
          shellClass="slash-menu absolute z-35 right-20 bottom-full left-20 mb-8 max-tight:right-10 max-tight:left-10"
        />
      </Show>
      <section
        ref={composerSurfaceRef}
        data-testid="composer-surface"
        aria-busy={state.submissionIsInFlight() || undefined}
        aria-disabled={state.inputDisabled()}
        class="composer-surface relative overflow-hidden border border-composer-border rounded-(--composer-radius) bg-surface-overlay p-2.5 max-narrow:rounded-16"
      >
        <ComposerUploadSurface
          origin="composer"
          projectId={state.draftOwner()?.projectId ?? null}
          disabled={state.inputDisabled()}
          dropDescId={state.uploadDropDescId}
          surfaceRef={composerSurfaceRef}
          registerFileInput={(element) => {
            state.setUploadFileInputRef(element);
          }}
          getDraft={() => state.composerDraft(state.draftOwner())}
          setDraft={(text) => state.setComposerDraft(state.draftOwner(), text)}
          focusAt={state.focusAt}
          readCaret={() => ({
            start: taRef?.selectionStart ?? state.composerDraft(state.draftOwner()).length,
            end: taRef?.selectionEnd ?? state.composerDraft(state.draftOwner()).length,
          })}
        />
        <ComposerStagedAssets />
        <ComposerInputField
          centered={centered()}
          hint={enabledHint()}
          ref={(el) => {
            taRef = el;
          }}
          value={draftText()}
          onInput={(e) => {
            if (e.isComposing) return;
            state.commitInputValue(e.currentTarget);
          }}
          onCompositionEnd={(e) => state.commitInputValue(e.currentTarget)}
          onSelect={(e) => state.slash.onCaret(e.currentTarget)}
          onBlur={state.slash.onBlur}
          onKeyDown={(e) => {
            if (e.isComposing || e.keyCode === 229) return;
            if (state.slash.handleKeyDown(e)) return;
            if (state.prediction.activePrediction() && e.key === 'Tab') {
              e.preventDefault();
              state.prediction.accept();
              return;
            }
            if (state.prediction.activePrediction() && e.key === 'Escape') {
              e.preventDefault();
              state.prediction.dismiss();
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              state.submit();
            }
          }}
          placeholder={state.inputDisabled() ? state.inputPlaceholder() : ''}
          disabled={state.inputDisabled()}
          aria-label="Message the agent"
          aria-autocomplete="list"
          aria-expanded={state.slash.slashMenuOpen()}
          aria-controls={state.slash.slashMenuOpen() ? state.slashMenuId : undefined}
          aria-activedescendant={
            state.slash.slashMenuOpen()
              ? (() => {
                  const active = state.slash.slashItems()[state.slash.boundedActiveIndex()];
                  return active ? slashMenuOptionId(state.slashMenuId, active.name) : undefined;
                })()
              : undefined
          }
          aria-describedby={state.inputDescribedBy()}
          spellcheck={false}
        />
        <Show when={state.promptOverBudget()}>
          <InlineNotice id={state.promptBudgetStatusId} class="mb-8" tone="danger" role="alert" title="Message is too large">
            <span>
              {state.draftBytes()} / {state.promptMaxBytes()} bytes. Shorten the message before sending.
            </span>
          </InlineNotice>
        </Show>
        <Show when={state.submissionNeedsAttention() ? state.submissionForSession() : null}>
          {(submission) => (
            <InlineNotice
              id={state.submissionStatusId}
              class={`composer-submission composer-submission--${submission().phase} mt-2 mb-8 border-dashed`}
              title={state.submissionTitle()}
              tone={state.submissionTone()}
              role="note"
            >
              <p>{state.submissionDetail()}</p>
              <div class="composer-submission__actions flex flex-wrap gap-6 mt-8">
                <Show when={submission().phase === 'uncertain' && submission().retryable}>
                  <Button size="compact" variant="secondary" class="pointer-coarse:min-h-44" onClick={state.retryMessageSubmission}>
                    Confirm with the same request
                  </Button>
                </Show>
                <Show when={submission().phase === 'failed'}>
                  <Button size="compact" class="pointer-coarse:min-h-44" onClick={state.restoreFailedDraft}>
                    Back to edit
                  </Button>
                </Show>
                <Show when={submission().phase === 'delivery_unknown'}>
                  <Button
                    size="compact"
                    variant="secondary"
                    class="pointer-coarse:min-h-44"
                    disabled={!state.canAcknowledgeUnknownMessageDelivery(submission().commandId)}
                    onClick={() => {
                      if (!state.canAcknowledgeUnknownMessageDelivery(submission().commandId)) return;
                      state.acknowledgeUnknownMessageDelivery(submission().commandId);
                      queueMicrotask(() => focusInput());
                    }}
                  >
                    Acknowledge and continue
                  </Button>
                </Show>
              </div>
            </InlineNotice>
          )}
        </Show>
        <ComposerToolbarShell
          left={(
            <>
              <ComposerAttachmentButton
                disabled={state.inputDisabled()}
                onClick={() => {
                  openComposerUploadFilePicker(state.uploadFileInputRef);
                  queueMicrotask(() => focusInput());
                }}
              />
              <Show when={state.prediction.activePrediction()}>
                <ComposerPredictionButton onClick={state.prediction.accept} />
              </Show>
              <Show when={state.canBrowseSkills()}>
                <ComposerSkillsButton
                  skillCount={state.skillCount()}
                  menuId={state.slashMenuId}
                  expanded={state.slash.browseSkills() && state.slash.slashMenuOpen()}
                  disabled={state.inputDisabled()}
                  onClick={() => {
                    state.slash.toggleBrowse(taRef);
                    queueMicrotask(() => focusInput());
                  }}
                />
              </Show>
            </>
          )}
          right={(
            <>
              <Show when={state.latestUsage()}>{(usage) =>
                <TokenUsageMeter usage={usage()} contextWindow={state.chatHead()?.agent?.contextWindow ?? null} />
              }</Show>
              <div class="ui-composer-runtime-slot min-w-0 flex-1" title={state.runtimeSummary()}>
                {runtimeMenu()}
              </div>
              <Show
                when={state.turnActive()}
                fallback={(
                  <ComposerSendStopAction
                    mode="send"
                    label="Send"
                    disabled={
                      state.inputDisabled()
                      || state.sendLocked()
                      || !draftText().trim()
                      || state.promptOverBudget()
                    }
                    onClick={state.submit}
                  />
                )}
              >
                <ComposerSendStopAction
                  mode="stop"
                  label={state.cancelLabel()}
                  disabled={state.cancelLocked() || state.readOnly()}
                  busy={state.cancelControl()?.phase === 'sending' || state.cancelControl()?.phase === 'accepted'}
                  uncertain={state.cancelControl()?.phase === 'uncertain'}
                  showStopGlyph={
                    !state.cancelControl()
                    || state.cancelControl()?.phase === 'uncertain'
                    || state.cancelControl()?.phase === 'confirmed'
                  }
                  onClick={state.requestCancel}
                />
              </Show>
            </>
          )}
        />
      </section>
    </div>
  );
}

// 发送窗口（Composer）：T4 装配层，视觉壳来自 @peri/ui ComposerShell（T3）。

import { Show, createSignal, type JSX } from 'solid-js';
import {
  Button,
  ComposerInputField,
  ComposerPlusMenu,
  ComposerPredictionButton,
  ComposerQueue,
  ComposerSendStopAction,
  ComposerShell,
  ComposerSkillsButton,
  InlineNotice,
  SlashMenuListbox,
  TokenUsageMeter,
  cn,
} from '@peri/ui';
import type { ComposerAttachmentItem } from '@peri/ui';
import { composerAssets, removeComposerAsset } from '@/features/composer/composer-assets';
import { agentCommandToSlashMenuItem } from '@/features/composer/slash-menu-catalog';
import { slashMenuOptionId } from '@/features/composer/slash-menu';
import { ComposerUploadSurface, openComposerUploadFilePicker } from './ComposerUploadSurface';
import { useComposerState } from './useComposerState';

export function Composer(props: {
  layout?: 'docked' | 'centered';
  renderRuntimeMenu?: (ctx: { id: string; disabled: boolean }) => JSX.Element;
}) {
  const centered = () => props.layout === 'centered';
  let taRef: HTMLTextAreaElement | undefined;
  let composerSurfaceRef: HTMLDivElement | undefined;
  const state = useComposerState(() => taRef);
  const [plusOpen, setPlusOpen] = createSignal(false);

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

  const stagedAssetItems = (): ComposerAttachmentItem[] => composerAssets().map((asset) => ({
    id: asset.id,
    name: asset.name,
    kind: asset.kind === 'image' ? 'image' : 'file',
    status: 'ready',
    previewUrl: asset.previewUrl,
    onRemove: () => removeComposerAsset(asset.id),
  }));

  const slashListbox = (shellClass?: string) => (
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
      onSelect={(item) => {
        state.slash.selectCommand(item.name);
        setPlusOpen(false);
      }}
      onKeyDown={(event) => state.slash.handleKeyDown(event)}
      shellClass={shellClass}
    />
  );

  const trailingControls = (shape: 'default' | 'pill') => (
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
            shape={shape}
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
          shape={shape}
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
  );

  const leadingControls = () => (
    <>
      <ComposerPlusMenu
        open={plusOpen()}
        onOpenChange={setPlusOpen}
        disabled={state.inputDisabled()}
        upload={{
          disabled: state.inputDisabled(),
          onClick: () => {
            openComposerUploadFilePicker(state.uploadFileInputRef);
            queueMicrotask(() => focusInput());
          },
        }}
        slashMenu={slashListbox()}
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
  );

  return (
    <div
      data-testid="composer-wrap"
      class={cn(
        'composer-wrap relative w-full',
        centered() ? 'composer-wrap--centered' : 'composer-wrap--overlay chat-column',
      )}
    >
      <ComposerShell
        class={centered() ? 'mx-auto' : undefined}
        surfaceRef={(element) => { composerSurfaceRef = element; }}
        aria-busy={state.submissionIsInFlight() || undefined}
        aria-disabled={state.inputDisabled()}
        attachments={stagedAssetItems()}
        attachmentLayout="tile"
        queue={(
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
        )}
        overlay={(
          <Show when={state.slash.slashMenuOpen() && !plusOpen()}>
            {slashListbox('slash-menu absolute z-35 right-20 bottom-full left-20 mb-8 max-tight:right-10 max-tight:left-10')}
          </Show>
        )}
        innerLeading={(
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
        )}
        renderField={(ctx) => (
          <ComposerInputField
            shell
            centered={centered()}
            hint={enabledHint()}
            ref={(el) => {
              taRef = el;
              ctx.bindRef(el);
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
            fieldClass={ctx.fieldClass}
          />
        )}
        notices={(
          <>
            <Show when={state.promptOverBudget()}>
              <InlineNotice id={state.promptBudgetStatusId} class="mb-8 px-14" tone="danger" role="alert" title="Message is too large">
                <span>
                  {state.draftBytes()} / {state.promptMaxBytes()} bytes. Shorten the message before sending.
                </span>
              </InlineNotice>
            </Show>
            <Show when={state.submissionNeedsAttention() ? state.submissionForSession() : null}>
              {(submission) => (
                <InlineNotice
                  id={state.submissionStatusId}
                  class={`composer-submission composer-submission--${submission().phase} mx-14 mt-2 mb-8 border-dashed`}
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
          </>
        )}
        compactLeading={leadingControls()}
        compactTrailing={trailingControls('pill')}
        expandedToolbar={trailingControls('default')}
      />
    </div>
  );
}

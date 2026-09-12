// 发送窗口（Composer）：输入区 + 底部工具行（ui.md §3.8 / §四.7）。
// 编排与 store 接线留在此；视觉组件来自 @peri/ui，业务映射在 features。

import { createSignal, Show, type Component, type JSX } from 'solid-js';
import {
  Button,
  type ComposerAttachmentItem,
  ComposerInputField,
  ComposerPlusMenu,
  ComposerQueue,
  ComposerSendStopAction,
  ComposerShell,
  type ComposerShellFieldContext,
  InlineNotice,
  SlashMenuListbox,
  cn,
  chatColumnClass,
} from '@peri/ui';
import { composerAssets, removeComposerAsset } from '@/features/composer/composer-assets';
import { agentCommandToSlashMenuItem } from '@/features/composer/slash-menu-catalog';
import { filterCommandCatalog, slashMenuOptionId } from '@/features/composer/slash-menu';
import { ComposerUploadSurface, openComposerUploadFilePicker } from './ComposerUploadSurface';
import { useComposerState, type ComposerState } from './useComposerState';

type ComposerMessageFieldProps = {
  ctx: ComposerShellFieldContext;
  centered: boolean;
  state: ComposerState;
  onBindTaRef: (element: HTMLTextAreaElement | undefined) => void;
};

function ComposerSlashCatalog(props: {
  id: string;
  items: ReturnType<ComposerState['slash']['slashItems']>;
  activeIndex: number;
  onActiveIndex: (index: number) => void;
  onSelect: (name: string) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  shellClass?: string;
}) {
  return (
    <SlashMenuListbox
      id={props.id}
      items={props.items}
      activeIndex={props.activeIndex}
      toMenuItem={agentCommandToSlashMenuItem}
      optionValue={(item) => item.name}
      optionTextValue={(item) => `${item.name} ${item.description}`}
      getOptionId={(menuId, item) => slashMenuOptionId(menuId, item.name)}
      namePrefix="/"
      onActiveIndex={props.onActiveIndex}
      onSelect={(item) => props.onSelect(item.name)}
      onKeyDown={props.onKeyDown}
      shellClass={props.shellClass}
    />
  );
}

const ComposerMessageField: Component<ComposerMessageFieldProps> = (props) => {
  const draftText = () => props.state.composerDraft(props.state.draftOwner());
  const enabledHint = () => {
    if (props.state.inputDisabled() || draftText().length > 0) return null;
    const prediction = props.state.prediction.activePrediction();
    if (prediction) return { kind: 'prediction' as const, text: prediction.text };
    const placeholder = props.state.inputPlaceholder();
    if (!placeholder) return null;
    return { kind: 'placeholder' as const, text: placeholder };
  };

  return (
    <ComposerInputField
      shell
      centered={props.centered}
      hint={enabledHint()}
      ref={(el) => {
        props.ctx.bindRef(el);
        props.onBindTaRef(el);
      }}
      fieldClass={props.ctx.fieldClass}
      maxHeight={props.ctx.maxHeight}
      value={draftText()}
      onInput={(e) => {
        if (e.isComposing) return;
        props.state.commitInputValue(e.currentTarget);
      }}
      onCompositionEnd={(e) => props.state.commitInputValue(e.currentTarget)}
      onSelect={(e) => props.state.slash.onCaret(e.currentTarget)}
      onBlur={props.state.slash.onBlur}
      onKeyDown={(e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (props.state.slash.handleKeyDown(e)) return;
        if (props.state.prediction.activePrediction() && e.key === 'Tab') {
          e.preventDefault();
          props.state.prediction.accept();
          return;
        }
        if (props.state.prediction.activePrediction() && e.key === 'Escape') {
          e.preventDefault();
          props.state.prediction.dismiss();
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          props.state.submit();
        }
      }}
      placeholder={props.state.inputDisabled() ? props.state.inputPlaceholder() : ''}
      disabled={props.state.inputDisabled()}
      aria-label="Message the agent"
      aria-autocomplete="list"
      aria-expanded={props.state.slash.slashMenuOpen()}
      aria-controls={props.state.slash.slashMenuOpen() ? props.state.slashMenuId : undefined}
      aria-activedescendant={
        props.state.slash.slashMenuOpen()
          ? (() => {
              const active = props.state.slash.slashItems()[props.state.slash.boundedActiveIndex()];
              return active ? slashMenuOptionId(props.state.slashMenuId, active.name) : undefined;
            })()
          : undefined
      }
      aria-describedby={props.state.inputDescribedBy()}
      spellcheck={false}
    />
  );
};

export function Composer(props: {
  layout?: 'docked' | 'centered';
  renderRuntimeMenu?: (ctx: { id: string; disabled: boolean }) => JSX.Element;
}) {
  const centered = () => props.layout === 'centered';
  const [plusOpen, setPlusOpen] = createSignal(false);
  let taRef: HTMLTextAreaElement | undefined;
  let composerSurfaceRef: HTMLDivElement | undefined;
  const state = useComposerState(() => taRef);
  const plusCatalogItems = () => filterCommandCatalog(state.commandCatalog(), '', 'all');

  const focusInput = () => {
    taRef?.focus();
  };

  const runtimeMenu = () =>
    props.renderRuntimeMenu?.({
      id: state.modelMenuId,
      disabled: state.runtimeMenuDisabled(),
    }) ?? null;

  const draftText = () => state.composerDraft(state.draftOwner());

  const stagedAssetItems = (): ComposerAttachmentItem[] => composerAssets().map((asset) => ({
    id: asset.id,
    name: asset.name,
    kind: asset.kind === 'image' ? 'image' : 'file',
    status: 'ready',
    previewUrl: asset.previewUrl,
    onRemove: () => removeComposerAsset(asset.id),
  }));

  return (
    <div
      data-testid="composer-wrap"
      class={cn(
        'relative w-full pb-(--composer-safe-bottom)',
        !centered() && chatColumnClass,
      )}
    >
      <Show when={state.slash.slashMenuOpen()}>
        <ComposerSlashCatalog
          id={state.slashMenuId}
          items={state.slash.slashItems()}
          activeIndex={state.slash.boundedActiveIndex()}
          onActiveIndex={state.slash.onMenuActiveIndex}
          onSelect={(name) => state.slash.selectCommand(name)}
          onKeyDown={(event) => state.slash.handleKeyDown(event)}
          shellClass="slash-menu ui-composer-slash-overlay"
        />
      </Show>
      <ComposerShell
        data-testid="composer-surface"
        aria-busy={state.submissionIsInFlight() || undefined}
        aria-disabled={state.inputDisabled()}
        disabled={state.inputDisabled()}
        draft={draftText()}
        attachments={stagedAssetItems()}
        surfaceRef={(element) => {
          composerSurfaceRef = element;
        }}
        queue={state.queueItems().length > 0 ? (
          <ComposerQueue
            class="mb-8"
            items={state.queueItems()}
            onSendNow={state.sendQueueItemNow}
            onEdit={state.editQueueItem}
            onRemove={state.removeQueueItem}
            onMore={state.moreQueueItem}
          />
        ) : undefined}
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
        renderField={ComposerMessageField}
        renderFieldProps={{
          centered: centered(),
          state,
          onBindTaRef: (element: HTMLTextAreaElement | undefined) => {
            taRef = element;
          },
        }}
        compactLeading={(
          <ComposerPlusMenu
            open={plusOpen()}
            onOpenChange={setPlusOpen}
            disabled={state.inputDisabled()}
            upload={{
              onClick: () => {
                openComposerUploadFilePicker(state.uploadFileInputRef);
                queueMicrotask(() => focusInput());
              },
            }}
            slashMenu={(
              <Show when={plusCatalogItems().length > 0}>
                <ComposerSlashCatalog
                  id={`${state.slashMenuId}-plus`}
                  items={plusCatalogItems()}
                  activeIndex={0}
                  onActiveIndex={() => {}}
                  onSelect={(name) => {
                    setPlusOpen(false);
                    state.slash.selectCommand(name);
                  }}
                />
              </Show>
            )}
          />
        )}
        compactTrailing={(
          <>
            <div class="ui-composer-model-select" title={state.runtimeSummary()}>
              {runtimeMenu()}
            </div>
            <Show
              when={state.turnActive()}
              fallback={(
                <ComposerSendStopAction
                  mode="send"
                  shape="pill"
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
                shape="pill"
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
        notices={(
          <>
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
                  class="mt-2 mb-8 border-dashed"
                  title={state.submissionTitle()}
                  tone={state.submissionTone()}
                  role="note"
                >
                  <p>{state.submissionDetail()}</p>
                  <div class="flex flex-wrap gap-6 mt-8">
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
      />
    </div>
  );
}

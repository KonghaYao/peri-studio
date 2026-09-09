import { Show, type JSX } from 'solid-js';
import { Check, Plus, ScanLine, SendHorizontal } from 'lucide-solid';
import { Button, IconButton } from '@/shared/ui';
import { TokenUsageMeter } from '@/widgets/chat/TokenUsageMeter';
import { openComposerUploadFilePicker } from './ComposerUploadSurface';
import type { ComposerState } from './useComposerState';

function AttachmentIcon() {
  return <Plus size={18} strokeWidth={1.7} />;
}

const sendActionClass =
  'composer-action flex w-36 min-h-32 shrink-0 items-center justify-center rounded-8 max-narrow:w-48 max-narrow:min-h-44';

const stopActionClass =
  'composer-action composer-action--stop flex w-36 min-h-32 shrink-0 items-center justify-center rounded-8 max-narrow:w-48 max-narrow:min-h-44';

export function ComposerToolbar(props: {
  state: ComposerState;
  runtimeMenu: JSX.Element;
  focusInput: () => void;
  textareaRef: () => HTMLTextAreaElement | undefined;
}) {
  const s = () => props.state;

  return (
    <div data-testid="composer-toolbar" class="composer-toolbar flex min-h-36 min-w-0 items-center gap-4">
      <div class="composer-toolbar__left flex min-w-0 shrink items-center gap-4 max-narrow:gap-2">
        <IconButton
          label="Add attachment"
          title="Upload files to this project"
          disabled={s().inputDisabled()}
          class="composer-attachment max-narrow:hidden shrink-0 border-0 bg-transparent text-content-primary disabled:opacity-55"
          onClick={() => {
            openComposerUploadFilePicker(s().uploadFileInputRef);
            queueMicrotask(() => props.focusInput());
          }}
        >
          <AttachmentIcon />
        </IconButton>
        <Show when={s().prediction.activePrediction()}>
          <Button
            size="compact"
            variant="secondary"
            class="composer-prediction-action inline-flex min-h-30 items-center justify-center px-9 border-border-subtle bg-surface-muted text-text-secondary text-11 pointer-coarse:min-h-44 max-narrow:min-h-44"
            onClick={s().prediction.accept}
            aria-label="Use suggestion"
            title="Use suggestion (Tab)"
          >
            <Check size={16} strokeWidth={1.7} />
            <kbd class="ml-3 px-4 py-2 border border-border-subtle rounded-4 bg-surface text-9 max-narrow:hidden">Tab</kbd>
          </Button>
        </Show>
        <Show when={s().canBrowseSkills()}>
          <Button
            size="compact"
            class="composer-skills relative inline-flex w-34 min-h-30 items-center justify-center gap-0 rounded-7 border-0 bg-transparent p-0 text-text-primary text-11 font-normal pointer-coarse:w-48 pointer-coarse:min-h-44"
            aria-expanded={s().slash.browseSkills() && s().slash.slashMenuOpen()}
            aria-controls={s().slashMenuId}
            aria-label={`Browse skills (${s().skillCount()})`}
            title={`Browse skills (${s().skillCount()})`}
            onClick={() => {
              s().slash.toggleBrowse(props.textareaRef());
              queueMicrotask(() => props.focusInput());
            }}
            disabled={s().inputDisabled()}
          >
            <ScanLine size={17} strokeWidth={1.7} class="composer-skills__icon" aria-hidden="true" />
            <span class="composer-skills__count sr-only">{s().skillCount()}</span>
          </Button>
        </Show>
      </div>
      <span class="composer-shortcut sr-only" aria-hidden="true">
        Enter to send · Shift + Enter for newline
      </span>
      <div class="composer-toolbar__right ml-auto flex min-w-0 items-center justify-end gap-4">
        <Show when={s().latestUsage()}>{(usage) =>
          <TokenUsageMeter usage={usage()} contextWindow={s().chatHead()?.agent?.contextWindow ?? null} />
        }</Show>
        <div class="composer-runtime-slot min-w-0 flex-1" title={s().runtimeSummary()}>
          {props.runtimeMenu}
        </div>
        <Show
          when={s().turnActive()}
          fallback={
            <span class="shrink-0">
              <IconButton
                data-testid="composer-action"
                tooltipPlacement="end"
                variant="primary"
                type="button"
                onClick={s().submit}
                disabled={
                  s().inputDisabled()
                  || s().sendLocked()
                  || !s().composerDraft(s().draftOwner()).trim()
                  || s().promptOverBudget()
                }
                label="Send"
                class={sendActionClass}
              >
                <SendHorizontal size={18} strokeWidth={1.7} />
              </IconButton>
            </span>
          }
        >
          <span class="shrink-0">
            <IconButton
              data-testid="composer-action"
              tooltipPlacement="end"
              variant="stop"
              type="button"
              onClick={s().requestCancel}
              disabled={s().cancelLocked() || s().readOnly()}
              busy={s().cancelControl()?.phase === 'sending' || s().cancelControl()?.phase === 'accepted'}
              label={s().cancelLabel()}
              class={`${stopActionClass}${s().cancelControl()?.phase === 'uncertain' ? ' bg-warning hover:bg-warning-strong' : ''}`}
            >
              <Show
                when={
                  !s().cancelControl()
                  || s().cancelControl()?.phase === 'uncertain'
                  || s().cancelControl()?.phase === 'confirmed'
                }
              >
                <span aria-hidden="true" class="size-10 rounded-2 bg-current" />
              </Show>
            </IconButton>
          </span>
        </Show>
      </div>
    </div>
  );
}

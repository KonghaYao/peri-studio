import { Popover, PopoverContent, PopoverTrigger } from '@peri/ui';
import { createEffect, createSignal, For, Show, type JSX } from 'solid-js';
import {
  ComposerAttachmentList,
  ComposerDropOverlay,
  ComposerQueue,
  SlashMenu,
  TokenUsageMeter,
} from '@/components/blocks/composer';
import type { ComposerQueueItem } from '@/components/blocks/composer';
import { IconButton, Select, Textarea, cn } from '@/lib/catalog-ui';
import {
  ArrowUp,
  ChevronDown,
  GitBranch,
  Laptop,
  Mic,
  Paperclip,
  Plus,
} from 'lucide-solid';
import { ComposerAttachmentChip } from './ComposerAttachmentChip';
import type { ComposerAttachment } from './composer-shell-data';
import {
  COMPOSER_BRANCH_OPTIONS,
  COMPOSER_LOCATION_OPTIONS,
  COMPOSER_MODEL_OPTIONS,
  COMPOSER_QUEUE_DEMO,
  COMPOSER_SLASH_ITEMS,
} from './composer-shell-data';

/** 与 extra.css --composer-field-line-height / --composer-expanded-field-max-height 对齐 */
const COMPOSER_FIELD_LINE_HEIGHT_PX = Math.ceil(14 * 1.45);
const COMPOSER_EXPANDED_FIELD_MAX_HEIGHT_PX = COMPOSER_FIELD_LINE_HEIGHT_PX * 3;

export type ComposerAttachmentLayout = 'chip' | 'tile';

export function ComposerShell(props: {
  draft?: string;
  onDraftChange?: (value: string) => void;
  attachments?: ComposerAttachment[];
  attachmentLayout?: ComposerAttachmentLayout;
  showQueue?: boolean;
  queueItems?: ComposerQueueItem[];
  streaming?: boolean;
  disabled?: boolean;
  dropActive?: boolean;
  dropDescribedById?: string;
  onUploadRequest?: () => void;
  textareaRef?: (element: HTMLTextAreaElement) => void;
  fileInputRef?: (element: HTMLInputElement) => void;
  onFilesPicked?: (files: FileList | null) => void;
  class?: string;
}) {
  const [model, setModel] = createSignal('composer-2.5');
  const [branch, setBranch] = createSignal('main');
  const [location, setLocation] = createSignal('this-mac');
  const [slashOpen, setSlashOpen] = createSignal(false);
  const [draft, setDraft] = createSignal(props.draft ?? '');
  const [wrapped, setWrapped] = createSignal(false);
  let fieldRef: HTMLTextAreaElement | undefined;

  const attachments = () => props.attachments ?? [];
  const attachmentLayout = () => props.attachmentLayout ?? 'chip';
  const disabled = () => props.disabled ?? false;
  const draftValue = () => props.draft ?? draft();

  const expanded = () =>
    attachments().length > 0
    || draftValue().includes('\n')
    || wrapped();

  const setDraftValue = (value: string) => {
    setDraft(value);
    props.onDraftChange?.(value);
    queueMicrotask(measureField);
  };

  const measureField = () => {
    const element = fieldRef;
    const value = draftValue();
    if (!element || !value.trim()) {
      setWrapped(false);
      return;
    }
    if (value.includes('\n')) {
      setWrapped(false);
      return;
    }
    setWrapped(element.scrollHeight > element.clientHeight + 1);
  };

  createEffect(() => {
    if (props.draft !== undefined) setDraft(props.draft);
    queueMicrotask(measureField);
  });

  const resizeField = () => {
    const element = fieldRef;
    if (!element) return;
    element.style.height = 'auto';
    const maxHeight = expanded()
      ? COMPOSER_EXPANDED_FIELD_MAX_HEIGHT_PX
      : COMPOSER_FIELD_LINE_HEIGHT_PX;
    element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
    measureField();
  };

  createEffect(() => {
    expanded();
    queueMicrotask(resizeField);
  });

  const bindFieldRef = (element: HTMLTextAreaElement | undefined) => {
    fieldRef = element;
    if (element) props.textareaRef?.(element);
    queueMicrotask(measureField);
  };

  return (
    <div class={cn('composer-shell', props.class, disabled() && 'opacity-60')}>
      <Show when={props.showQueue}>
        <ComposerQueue items={props.queueItems ?? COMPOSER_QUEUE_DEMO} />
      </Show>

      <div
        data-testid="composer-surface"
        class={cn(
          'composer-surface-v2',
          expanded() ? 'composer-surface-v2--expanded' : 'composer-surface-v2--compact',
          props.dropActive && 'composer-surface--drop-target',
        )}
        aria-dropeffect={props.dropActive ? 'copy' : undefined}
        aria-describedby={props.dropActive ? props.dropDescribedById : undefined}
        data-composer-expanded={expanded() ? 'true' : 'false'}
      >
        <ComposerDropOverlay
          active={!!props.dropActive}
          describedById={props.dropDescribedById ?? 'composer-drop-desc'}
        />

        <Show when={expanded() && attachments().length > 0}>
          <div class="composer-surface-v2__attachments">
            <Show
              when={attachmentLayout() === 'tile'}
              fallback={
                <div class="composer-attachment-float" aria-label="Attached files">
                  <For each={attachments()}>
                    {(attachment) => <ComposerAttachmentChip {...attachment} />}
                  </For>
                </div>
              }
            >
              <ComposerAttachmentList items={attachments()} />
            </Show>
          </div>
        </Show>

        <div class="composer-surface-v2__body">
          <Show when={!expanded()}>
            <ComposerPlusMenu
              open={slashOpen()}
              disabled={disabled()}
              onOpenChange={setSlashOpen}
              onUpload={props.onUploadRequest}
            />
          </Show>

          <Textarea
            ref={bindFieldRef}
            variant="bare"
            autoResize
            maxHeight={expanded()
              ? COMPOSER_EXPANDED_FIELD_MAX_HEIGHT_PX
              : COMPOSER_FIELD_LINE_HEIGHT_PX}
            rows={1}
            value={draftValue()}
            onInput={(event) => setDraftValue(event.currentTarget.value)}
            placeholder="Send follow-up"
            aria-label="Message the agent"
            disabled={disabled()}
            class={cn(
              'composer-surface-v2__field',
              expanded() ? 'composer-surface-v2__field--expanded' : 'composer-surface-v2__field--compact',
            )}
          />

          <Show when={!expanded()}>
            <ComposerControls
              model={model()}
              onModelChange={setModel}
              streaming={props.streaming}
              disabled={disabled()}
              showModelOnIdle
            />
          </Show>
        </div>

        <Show when={expanded()}>
          <div class="composer-surface-v2__toolbar">
            <ComposerPlusMenu
              open={slashOpen()}
              disabled={disabled()}
              onOpenChange={setSlashOpen}
              onUpload={props.onUploadRequest}
            />
            <span class="flex-1" />
            <ComposerControls
              model={model()}
              onModelChange={setModel}
              streaming={props.streaming}
              disabled={disabled()}
            />
          </div>
        </Show>

        <Show when={props.onFilesPicked}>
          <input
            ref={(element) => {
              if (element) props.fileInputRef?.(element);
            }}
            type="file"
            multiple
            class="ui-sr-only"
            aria-hidden="true"
            tabindex={-1}
            disabled={disabled()}
            onChange={(event) => props.onFilesPicked?.(event.currentTarget.files)}
          />
        </Show>
      </div>

      <div class="composer-meta-row">
        <MetaSelect
          ariaLabel="Branch"
          icon={<GitBranch size={12} strokeWidth={1.7} />}
          value={branch()}
          onChange={setBranch}
          options={COMPOSER_BRANCH_OPTIONS}
        />
        <MetaSelect
          ariaLabel="Runtime location"
          icon={<Laptop size={12} strokeWidth={1.7} />}
          value={location()}
          onChange={setLocation}
          options={COMPOSER_LOCATION_OPTIONS}
        />
        <span class="flex-1" />
        <TokenUsageMeter input={12400} output={3180} cached={8200} limit={200000} />
      </div>
    </div>
  );
}

function ComposerPlusMenu(props: {
  open: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload?: () => void;
}) {
  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange}>
      <PopoverTrigger
        class="composer-plus-btn inline-flex shrink-0 items-center justify-center focus-visible:shadow-(--shadow-focus-ring) focus-visible:outline-none"
        aria-label="Slash commands"
        aria-expanded={props.open}
        disabled={props.disabled}
      >
        <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent class="composer-slash-popover p-0 shadow-overlay">
        <button
          type="button"
          class="composer-slash-upload"
          disabled={props.disabled}
          onClick={() => {
            props.onOpenChange(false);
            props.onUpload?.();
          }}
        >
          <div class="grid min-w-0 grid-cols-slash-menu items-center gap-x-10">
            <span class="grid size-16 shrink-0 place-items-center">
              <Paperclip size={14} strokeWidth={1.7} class="text-content-muted" aria-hidden="true" />
            </span>
            <span class="min-w-0 truncate text-13 font-medium text-content-primary">Upload files</span>
            <span class="min-w-0 truncate text-12 text-content-muted">
              Attach images, docs, or code
            </span>
          </div>
        </button>
        <SlashMenu items={COMPOSER_SLASH_ITEMS} activeIndex={3} />
      </PopoverContent>
    </Popover>
  );
}

function ComposerControls(props: {
  model: string;
  onModelChange: (value: string) => void;
  streaming?: boolean;
  disabled?: boolean;
  showModelOnIdle?: boolean;
}) {
  return (
    <div class="composer-controls flex min-w-0 shrink-0 items-center gap-4">
      <Select
        variant="plain"
        aria-label="Model"
        value={props.model}
        onChange={props.onModelChange}
        options={COMPOSER_MODEL_OPTIONS}
        disabled={props.disabled}
        class={cn('composer-model-select', props.showModelOnIdle ? '' : 'max-w-40')}
      />
      <IconButton label="Voice input" showTooltip={false} size="sm" variant="ghost" disabled class="composer-mic-btn">
        <Mic size={16} strokeWidth={1.7} />
      </IconButton>
      <IconButton
        label={props.streaming ? 'Stop' : 'Send'}
        showTooltip={false}
        size="sm"
        variant={props.streaming ? 'stop' : 'primary'}
        disabled={props.disabled}
        class="composer-send-btn"
      >
        <Show when={props.streaming} fallback={<ArrowUp size={16} strokeWidth={2.2} />}>
          <span class="size-10 rounded-2 bg-current" aria-hidden="true" />
        </Show>
      </IconButton>
    </div>
  );
}

function MetaSelect(props: {
  ariaLabel: string;
  icon: JSX.Element;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const label = () => props.options.find((option) => option.value === props.value)?.label ?? props.value;
  return (
    <button type="button" class="composer-meta-chip" aria-label={props.ariaLabel}>
      {props.icon}
      <span class="truncate">{label()}</span>
      <ChevronDown size={12} strokeWidth={1.7} class="shrink-0 text-content-faint" aria-hidden="true" />
    </button>
  );
}

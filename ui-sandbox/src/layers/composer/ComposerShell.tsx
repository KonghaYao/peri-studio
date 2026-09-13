import {
  ComposerPlusMenu,
  ComposerQueue,
  ComposerSendStopAction,
  ComposerShell as ComposerShellBase,
  SlashMenu,
  TokenUsageMeter,
  composerMetaChipClass,
} from '@peri/ui';
import { createEffect, createSignal } from 'solid-js';
import { GitBranch, Laptop } from 'lucide-solid';
import { Select, cn } from '@/lib/catalog-ui';
import type { ComposerAttachment } from './composer-shell-data';
import {
  COMPOSER_BRANCH_OPTIONS,
  COMPOSER_LOCATION_OPTIONS,
  COMPOSER_MODEL_OPTIONS,
  COMPOSER_QUEUE_DEMO,
  COMPOSER_SLASH_ITEMS,
} from './composer-shell-data';

export type ComposerAttachmentLayout = 'chip' | 'tile';

/** T4 · Catalog demo：消费 @peri/ui ComposerShell（T3），mock 数据与 meta 行。 */
export function ComposerShell(props: {
  draft?: string;
  onDraftChange?: (value: string) => void;
  attachments?: ComposerAttachment[];
  attachmentLayout?: ComposerAttachmentLayout;
  showQueue?: boolean;
  streaming?: boolean;
  disabled?: boolean;
  dropActive?: boolean;
  dropDescribedById?: string;
  onUploadRequest?: () => void;
  fileInputRef?: (element: HTMLInputElement | undefined) => void;
  onFilesPicked?: (files: FileList | null) => void;
  class?: string;
}) {
  const [model, setModel] = createSignal('composer-2.5');
  const [branch, setBranch] = createSignal('main');
  const [location, setLocation] = createSignal('this-mac');
  const [plusOpen, setPlusOpen] = createSignal(false);
  const [draft, setDraft] = createSignal(props.draft ?? '');

  createEffect(() => {
    if (props.draft !== undefined) setDraft(props.draft);
  });

  const attachments = () => props.attachments ?? [];
  const setDraftValue = (value: string) => {
    setDraft(value);
    props.onDraftChange?.(value);
  };

  const branchLabel = () => COMPOSER_BRANCH_OPTIONS.find((option) => option.value === branch())?.label ?? branch();
  const locationLabel = () => COMPOSER_LOCATION_OPTIONS.find((option) => option.value === location())?.label ?? location();

  return (
    <ComposerShellBase
      class={cn(props.class, props.disabled && 'opacity-60')}
      disabled={props.disabled}
      dropActive={props.dropActive}
      dropDescribedById={props.dropDescribedById}
      draft={draft()}
      onDraftChange={setDraftValue}
      attachments={attachments()}
      attachmentLayout={props.attachmentLayout ?? 'chip'}
      fieldPlaceholder="Send follow-up"
      queue={props.showQueue ? <ComposerQueue items={COMPOSER_QUEUE_DEMO} /> : undefined}
      compactLeading={(
        <ComposerPlusMenu
          open={plusOpen()}
          onOpenChange={setPlusOpen}
          disabled={props.disabled}
          upload={props.onUploadRequest ? { onClick: props.onUploadRequest } : undefined}
          slashMenu={<SlashMenu items={COMPOSER_SLASH_ITEMS} activeIndex={3} />}
        />
      )}
      compactTrailing={(
        <>
          <div class="ui-composer-model-select">
            <Select
              variant="plain"
              aria-label="Model"
              value={model()}
              onChange={setModel}
              options={COMPOSER_MODEL_OPTIONS}
              disabled={props.disabled}
            />
          </div>
          <ComposerSendStopAction
            mode={props.streaming ? 'stop' : 'send'}
            label={props.streaming ? 'Stop' : 'Send'}
            shape="pill"
            disabled={props.disabled}
            onClick={() => {}}
          />
        </>
      )}
      registerFileInput={props.fileInputRef}
      onFilesPicked={props.onFilesPicked}
      metaRow={(
        <>
          <button type="button" class={composerMetaChipClass} aria-label="Branch">
            <GitBranch size={12} strokeWidth={1.7} />
            <span class="truncate">{branchLabel()}</span>
          </button>
          <button type="button" class={composerMetaChipClass} aria-label="Runtime location">
            <Laptop size={12} strokeWidth={1.7} />
            <span class="truncate">{locationLabel()}</span>
          </button>
          <span class="flex-1" />
          <TokenUsageMeter input={12400} output={3180} cached={8200} limit={200000} />
        </>
      )}
    />
  );
}

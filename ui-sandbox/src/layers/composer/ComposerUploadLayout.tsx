import { createSignal, For, Show } from 'solid-js';
import { chatColumnClass } from '@peri/ui';
import { Button } from '@/lib/catalog-ui';
import { ComposerShell } from './ComposerShell';
import type { ComposerAttachment } from './composer-shell-data';
import {
  COMPOSER_UPLOAD_BATCH_DEMO,
  COMPOSER_UPLOAD_DRAFT,
  COMPOSER_UPLOAD_TILE_MATRIX,
} from './composer-shell-data';

type ComposerDemoMode = 'idle' | 'drop-active' | 'batch' | 'disabled' | 'keyboard-picked';

const MODE_OPTIONS: { value: ComposerDemoMode; label: string }[] = [
  { value: 'idle', label: 'Idle' },
  { value: 'drop-active', label: 'Drop active' },
  { value: 'batch', label: 'Mixed batch' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'keyboard-picked', label: 'Keyboard pick' },
];

const DROP_DESC_ID = 'composer-upload-drop-desc';

function attachmentsForMode(
  mode: ComposerDemoMode,
  onRetry: (name: string) => void,
): ComposerAttachment[] | undefined {
  if (mode === 'idle' || mode === 'drop-active' || mode === 'disabled') return undefined;

  const source = mode === 'batch' || mode === 'keyboard-picked'
    ? COMPOSER_UPLOAD_BATCH_DEMO
    : COMPOSER_UPLOAD_TILE_MATRIX;

  return source.map((item) => ({
    ...item,
    onRetry: item.onRetry ? () => onRetry(item.name) : undefined,
  }));
}

/** Tier 4 · Composer 拖拽/键盘上传视觉矩阵（基于 ComposerShell）。 */
export function ComposerUploadLayout() {
  const [mode, setMode] = createSignal<ComposerDemoMode>('batch');
  const [draft, setDraft] = createSignal(COMPOSER_UPLOAD_DRAFT);
  const [liveMessage, setLiveMessage] = createSignal('');
  let fileInputRef: HTMLInputElement | undefined;

  const disabled = () => mode() === 'disabled';
  const dropActive = () => mode() === 'drop-active';

  const openFilePicker = () => {
    if (disabled()) return;
    fileInputRef?.click();
  };

  const onFilesPicked = (files: FileList | null) => {
    if (!files?.length) return;
    const names = Array.from(files).map((file) => file.name).join(', ');
    setLiveMessage(`Selected ${files.length} file(s) for upload: ${names}. Same flow as drag and drop.`);
    setMode('keyboard-picked');
  };

  const attachments = () => attachmentsForMode(mode(), (name) => {
    setLiveMessage(`Retrying upload for ${name}`);
  });

  return (
    <div class="flex max-w-3xl flex-col gap-24">
      <div class="flex flex-wrap gap-8">
        <For each={MODE_OPTIONS}>
          {(option) => (
            <Button
              size="sm"
              variant={mode() === option.value ? 'primary' : 'default'}
              onClick={() => setMode(option.value)}
            >
              {option.label}
            </Button>
          )}
        </For>
      </div>

      <div class={chatColumnClass}>
        <ComposerShell
          draft={mode() === 'idle' ? '' : draft()}
          onDraftChange={setDraft}
          attachments={attachments()}
          attachmentLayout="tile"
          showQueue={mode() === 'batch'}
          disabled={disabled()}
          dropActive={dropActive()}
          dropDescribedById={DROP_DESC_ID}
          onUploadRequest={openFilePicker}
          fileInputRef={(element) => {
            fileInputRef = element;
          }}
          onFilesPicked={onFilesPicked}
        />
        <p class="ui-sr-only" id={DROP_DESC_ID}>
          Release to upload files to this project.
        </p>
      </div>

      <div aria-live="polite" class="min-h-20 text-11 text-content-secondary">
        {liveMessage() || (mode() === 'keyboard-picked'
          ? 'Use Upload files in + menu — focus stays in the message field after pick.'
          : '')}
      </div>

      <Show when={disabled()}>
        <p role="alert" class="text-11 text-danger-strong">
          Upload requires full access. Drop and Upload files are disabled.
        </p>
      </Show>
    </div>
  );
}

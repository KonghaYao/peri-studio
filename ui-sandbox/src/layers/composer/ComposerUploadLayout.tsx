import { createSignal, For } from 'solid-js';
import {
  ComposerDropOverlay,
  TokenUsageMeter,
  UploadAssetTile,
} from '@/components/blocks/composer';
import { Button } from '@/components/ui';
import { IconButton, Select, Textarea } from '@/components/ui';
import { Mic, Plus, Send, ShieldCheck } from 'lucide-solid';
import type { UploadAssetTileStatus } from '@/components/blocks/composer/upload-asset-tile-types';

type ComposerDemoMode = 'idle' | 'drop-active' | 'batch' | 'disabled' | 'keyboard-picked';

const MODE_OPTIONS: { value: ComposerDemoMode; label: string }[] = [
  { value: 'idle', label: 'Idle' },
  { value: 'drop-active', label: 'Drop active' },
  { value: 'batch', label: 'Mixed batch' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'keyboard-picked', label: 'Keyboard pick' },
];

const TILE_MATRIX: { status: UploadAssetTileStatus; name: string; progress?: number; errorMessage?: string }[] = [
  { status: 'pending', name: 'notes.txt' },
  { status: 'uploading', name: 'diagram.png', progress: 62 },
  { status: 'committing', name: 'spec.md' },
  { status: 'ready', name: 'layout.png' },
  { status: 'failed', name: 'large.bin', errorMessage: 'File exceeds 8 MB limit.' },
];

const BATCH_DEMO = [
  { status: 'ready' as const, name: 'api.ts', showSuccessBadge: true },
  { status: 'uploading' as const, name: 'schema.json', progress: 38 },
  {
    status: 'failed' as const,
    name: 'README.md',
    errorMessage: 'A file already exists at this path.',
  },
];

function tileShowsSuccessBadge(tile: (typeof TILE_MATRIX)[number] | (typeof BATCH_DEMO)[number]) {
  if ('showSuccessBadge' in tile) return Boolean(tile.showSuccessBadge);
  return tile.status === 'ready';
}

/** Tier 4 · Composer 拖拽/键盘上传视觉矩阵（WP-4）。 */
export function ComposerUploadLayout() {
  const [mode, setMode] = createSignal<ComposerDemoMode>('batch');
  const [model, setModel] = createSignal('nova');
  const [draft, setDraft] = createSignal('Compare @src/api.ts with the uploaded copy.');
  const [liveMessage, setLiveMessage] = createSignal('');
  let fileInputRef: HTMLInputElement | undefined;

  const dropActive = () => mode() === 'drop-active';
  const disabled = () => mode() === 'disabled';
  const dropDescId = 'composer-upload-drop-desc';

  const openFilePicker = () => {
    if (disabled()) return;
    fileInputRef?.click();
  };

  const onFilesPicked = (files: FileList | null) => {
    if (!files?.length) return;
    const names = Array.from(files).map((f) => f.name).join(', ');
    setLiveMessage(`Selected ${files.length} file(s) for upload: ${names}. Same flow as drag and drop.`);
    setMode('keyboard-picked');
  };

  return (
    <div class="flex max-w-3xl flex-col gap-6">
      <div class="flex flex-wrap gap-2">
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

      <div class="chat-column">
        <div
          data-testid="composer-surface"
          class="composer-surface relative border border-composer-border bg-surface-overlay p-2.5"
          classList={{
            'composer-surface--drop-target': dropActive(),
            'opacity-60': disabled(),
          }}
          style={{ 'border-radius': 'var(--composer-radius)' }}
          aria-dropeffect={dropActive() ? 'copy' : undefined}
          aria-busy={mode() === 'batch' ? 'true' : undefined}
          aria-describedby={dropActive() ? dropDescId : undefined}
        >
          <ComposerDropOverlay active={dropActive()} describedById={dropDescId} />
          <p class="ui-sr-only" id={dropDescId}>
            Release to upload files to this project.
          </p>

          <div class="mb-1 flex flex-wrap gap-2">
            <For
              each={
                mode() === 'batch' || mode() === 'keyboard-picked'
                  ? BATCH_DEMO
                  : TILE_MATRIX
              }
            >
              {(tile) => (
                <UploadAssetTile
                  name={tile.name}
                  status={tile.status}
                  progress={'progress' in tile ? tile.progress : undefined}
                  errorMessage={'errorMessage' in tile ? tile.errorMessage : undefined}
                  showSuccessBadge={tileShowsSuccessBadge(tile)}
                  onRetry={
                    tile.status === 'failed'
                      ? () => setLiveMessage(`Retrying upload for ${tile.name}`)
                      : undefined
                  }
                  onRemove={tile.status === 'ready' ? () => {} : undefined}
                />
              )}
            </For>
          </div>

          <Textarea
            rows={2}
            value={draft()}
            onInput={(event) => setDraft(event.currentTarget.value)}
            placeholder="Message the agent"
            disabled={disabled()}
            class="border-0 bg-transparent px-1 shadow-none hover:border-transparent focus:border-transparent focus:shadow-none"
          />

          <div class="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              class="ui-sr-only"
              aria-hidden="true"
              tabindex={-1}
              disabled={disabled()}
              onChange={(event) => onFilesPicked(event.currentTarget.files)}
            />
            <IconButton
              label="Add attachment"
              tooltip="Add attachment"
              disabled={disabled()}
              onClick={openFilePicker}
            >
              <Plus size={16} />
            </IconButton>
            <IconButton label="Approval mode" tooltip="Approval mode" disabled={disabled()}><ShieldCheck size={16} /></IconButton>
            <span class="flex-1" />
            <Select
              variant="plain"
              value={model()}
              onChange={setModel}
              disabled={disabled()}
              options={[
                { value: 'nova', label: 'Nova 4.1' },
                { value: 'gpt', label: 'gpt-5.6' },
              ]}
            />
            <TokenUsageMeter input={12400} output={3180} cached={8200} />
            <IconButton label="Voice input" tooltip="Voice input" disabled><Mic size={16} /></IconButton>
            <IconButton
              label="Send"
              tooltip="Send"
              disabled={disabled()}
              class="bg-accent-solid text-content-on-accent hover:bg-accent-hover hover:text-content-on-accent"
            >
              <Send size={16} />
            </IconButton>
          </div>
        </div>
      </div>

      <div aria-live="polite" class="min-h-5 text-11 text-content-secondary">
        {liveMessage() || (mode() === 'keyboard-picked' ? 'Use Add attachment — focus stays in the message field after pick.' : '')}
      </div>

      {disabled() && (
        <p role="alert" class="text-11 text-danger-strong">
          Upload requires full access. Drop and Add attachment are disabled.
        </p>
      )}
    </div>
  );
}

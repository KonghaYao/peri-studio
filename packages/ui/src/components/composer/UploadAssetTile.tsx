import { Show, splitProps, type Component } from 'solid-js';
import { AlertCircle, Check, FileText, Image as ImageIcon, X } from 'lucide-solid';
import { cn } from '../../lib/cn';
import { IconButton } from '../Button';
import { Spinner } from '../Spinner';
import type { UploadAssetTileProps } from './upload-asset-tile-types';

function isImageName(name: string) {
  const lower = name.toLowerCase();
  return lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp');
}

/** Composer 上传资产方块：图标居中，文件名叠在底边。 */
export const UploadAssetTile: Component<UploadAssetTileProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'name',
    'status',
    'progress',
    'errorMessage',
    'showSuccessBadge',
    'previewUrl',
    'onRemove',
    'onRetry',
    'data-testid',
  ]);
  const busy = () => local.status === 'pending' || local.status === 'uploading' || local.status === 'committing';
  const failed = () => local.status === 'failed';
  const showPreview = () => Boolean(local.previewUrl) && !busy() && !failed();
  const progress = () => Math.min(100, Math.max(0, local.progress ?? 0));
  const caption = () => (failed() && local.onRetry ? 'Retry' : local.name);
  const title = () => (failed() && local.errorMessage ? `${local.name}: ${local.errorMessage}` : local.name);

  return (
    <div
      class={cn(
        'upload-asset-tile relative size-(--composer-upload-tile-width) shrink-0 overflow-hidden border bg-surface-canvas p-8',
        failed() ? 'border-danger-border upload-asset-tile--failed' : 'border-border-subtle',
      )}
      style={{
        width: 'var(--composer-upload-tile-width)',
        height: 'var(--composer-upload-tile-height)',
        '--upload-progress': `${progress()}%`,
      } as Record<string, string>}
      title={title()}
      aria-busy={busy() || undefined}
      role={failed() ? 'alert' : undefined}
      data-testid={local['data-testid'] ?? 'upload-asset-tile'}
      data-upload-status={local.status}
      {...rest}
    >
      <Show when={showPreview()}>
        <img src={local.previewUrl} alt="" class="upload-asset-tile__preview" aria-hidden="true" />
        <span class="upload-asset-tile__preview-scrim" aria-hidden="true" />
      </Show>
      <span class="pointer-events-none absolute inset-0 grid place-items-center text-content-muted">
        <Show
          when={local.status === 'uploading'}
          fallback={
            <Show when={local.status === 'pending' || local.status === 'committing'} fallback={
              <Show when={failed()} fallback={
                <Show when={!showPreview()}>
                  {isImageName(local.name)
                    ? <ImageIcon size={24} strokeWidth={1.6} />
                    : <FileText size={24} strokeWidth={1.6} />}
                </Show>
              }>
                <AlertCircle size={24} class="text-danger-solid" strokeWidth={1.6} />
              </Show>
            }>
              <Spinner class="size-24 text-content-muted" label={local.status === 'committing' ? 'Saving file' : 'Preparing upload'} />
            </Show>
          }
        >
          <span
            class="upload-asset-tile__ring size-44 rounded-full"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress()}
            aria-label={`Uploading ${local.name}`}
          />
        </Show>
      </span>

      <div class="relative z-1 flex h-full flex-col justify-end">
        <Show
          when={failed() && local.onRetry}
          fallback={
            <span class="min-w-0 truncate text-center text-10 text-content-secondary">{caption()}</span>
          }
        >
          <button
            type="button"
            class="min-w-0 truncate bg-transparent text-center text-10 text-danger-strong"
            onClick={local.onRetry}
          >
            Retry
          </button>
        </Show>
      </div>

      <Show when={local.showSuccessBadge && local.status === 'ready'}>
        <span class="upload-asset-tile__success-badge absolute top-4 left-4 z-10 grid size-18 place-items-center rounded-full bg-success-solid text-content-on-accent">
          <Check size={11} strokeWidth={3} />
        </span>
      </Show>

      <Show when={local.onRemove && local.status === 'ready'}>
        <div class="absolute top-4 right-4 z-10">
          <IconButton
            label={`Remove ${local.name}`}
            size="sm"
            showTooltip={false}
            class="size-24 bg-surface-overlay/90"
            onClick={local.onRemove}
          >
            <X size={12} />
          </IconButton>
        </div>
      </Show>
    </div>
  );
};

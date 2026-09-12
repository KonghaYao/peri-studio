import { Show } from 'solid-js';
import { AlertCircle, Check, FileText, Image as ImageIcon, X } from 'lucide-solid';
import { IconButton, Spinner } from '@peri/ui';
import { cn } from '@peri/ui';
import type { UploadAssetTileProps } from './upload-asset-tile-types';

function isImageName(name: string) {
  const lower = name.toLowerCase();
  return lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp');
}

/** Composer 上传资产方块（镜像 ui-sandbox UploadAssetTile）。 */
export function UploadAssetTile(props: UploadAssetTileProps) {
  const busy = () => props.status === 'pending' || props.status === 'uploading' || props.status === 'committing';
  const failed = () => props.status === 'failed';
  const progress = () => Math.min(100, Math.max(0, props.progress ?? 0));
  const caption = () => (failed() && props.onRetry ? 'Retry' : props.name);
  const title = () => (failed() && props.errorMessage ? `${props.name}: ${props.errorMessage}` : props.name);

  return (
    <div
      class={cn(
        'upload-asset-tile relative size-(--composer-upload-tile-width) shrink-0 overflow-hidden rounded-md border bg-surface-canvas p-6',
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
      data-testid="upload-asset-tile"
      data-upload-status={props.status}
    >
      <span class="pointer-events-none absolute inset-0 grid place-items-center text-content-muted">
        <Show
          when={props.status === 'uploading'}
          fallback={
            <Show when={props.status === 'pending' || props.status === 'committing'} fallback={
              <Show when={failed()} fallback={
                isImageName(props.name)
                  ? <ImageIcon size={20} strokeWidth={1.6} />
                  : <FileText size={20} strokeWidth={1.6} />
              }>
                <AlertCircle size={20} class="text-danger-solid" strokeWidth={1.6} />
              </Show>
            }>
              <Spinner class="size-20 text-content-muted" label={props.status === 'committing' ? 'Saving file' : 'Preparing upload'} />
            </Show>
          }
        >
          <span
            class="upload-asset-tile__ring size-36 rounded-full"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress()}
            aria-label={`Uploading ${props.name}`}
          />
        </Show>
      </span>

      <div class="relative z-1 flex h-full flex-col justify-end">
        <Show
          when={failed() && props.onRetry}
          fallback={
            <span class="min-w-0 truncate text-center text-9 text-content-secondary">{caption()}</span>
          }
        >
          <button
            type="button"
            class="min-w-0 truncate bg-transparent text-center text-9 text-danger-strong"
            onClick={props.onRetry}
          >
            Retry
          </button>
        </Show>
      </div>

      <Show when={props.showSuccessBadge && props.status === 'ready'}>
        <span class="upload-asset-tile__success-badge absolute top-2 left-2 z-10 grid size-16 place-items-center rounded-full bg-success-solid text-content-on-accent">
          <Check size={10} strokeWidth={3} />
        </span>
      </Show>

      <Show when={props.onRemove && props.status === 'ready'}>
        <div class="absolute top-2 right-2 z-10">
          <IconButton
            label={`Remove ${props.name}`}
            size="sm"
            showTooltip={false}
            class="size-20 bg-surface-overlay/90"
            onClick={props.onRemove}
          >
            <X size={11} />
          </IconButton>
        </div>
      </Show>
    </div>
  );
}

import { Show } from 'solid-js';
import { AlertCircle, Check, FileText, Image as ImageIcon, X } from 'lucide-solid';
import { Button, IconButton, Spinner } from '@/lib/catalog-ui';
import { cn } from '@/lib/catalog-ui';
import type { UploadAssetTileProps } from './upload-asset-tile-types';

function isImageName(name: string) {
  const lower = name.toLowerCase();
  return lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp');
}

/** Tier 3 · 上传资产磁贴：pending / uploading / committing / ready / failed。 */
export function UploadAssetTile(props: UploadAssetTileProps) {
  const busy = () => props.status === 'pending' || props.status === 'uploading' || props.status === 'committing';
  const failed = () => props.status === 'failed';
  const progress = () => Math.min(100, Math.max(0, props.progress ?? 0));

  return (
    <div
      class={cn(
        'upload-asset-tile relative flex w-(--composer-upload-tile-width) min-h-(--composer-upload-tile-height) min-w-(--composer-upload-tile-width) max-w-(--composer-upload-tile-width) shrink-0 items-center gap-8 overflow-hidden rounded-md border bg-surface-canvas px-8 py-6',
        failed()
          ? 'h-auto items-start border-danger-border upload-asset-tile--failed'
          : 'h-(--composer-upload-tile-height) min-h-0',
      )}
      style={{
        width: 'var(--composer-upload-tile-width)',
        height: failed() ? undefined : 'var(--composer-upload-tile-height)',
        '--upload-progress': `${progress()}%`,
      } as Record<string, string>}
      aria-busy={busy() || undefined}
      role={failed() ? 'alert' : undefined}
    >
      <Show when={props.onRemove && props.status === 'ready'}>
        <IconButton
          label={`Remove ${props.name}`}
          size="sm"
          class="absolute top-4 right-4 z-10 size-20 bg-surface-overlay/90"
          onClick={props.onRemove}
        >
          <X size={11} />
        </IconButton>
      </Show>

      <Show when={props.showSuccessBadge && props.status === 'ready'}>
        <span class="upload-asset-tile__success-badge absolute top-4 left-4 grid size-16 place-items-center rounded-full bg-success-solid text-content-on-accent">
          <Check size={10} strokeWidth={3} />
        </span>
      </Show>

      <span class="grid w-44 shrink-0 place-items-center text-content-muted">
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

      <div class="flex min-w-0 flex-1 flex-col items-start gap-2 pr-20">
        <span class="w-full truncate text-left text-9 text-content-secondary" title={props.name}>{props.name}</span>
        <Show when={props.status === 'committing'}>
          <span class="text-9 text-content-muted">Saving…</span>
        </Show>
        <Show when={failed() && props.errorMessage}>
          <span class="upload-asset-tile__error line-clamp-2 w-full text-left text-9 leading-tight text-danger-strong">
            {props.errorMessage}
          </span>
        </Show>
        <Show when={failed() && props.onRetry}>
          <Button variant="danger" size="sm" class="mt-2 h-20 px-6 text-9" onClick={props.onRetry}>
            Retry
          </Button>
        </Show>
      </div>
    </div>
  );
}

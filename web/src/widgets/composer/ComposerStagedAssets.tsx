import { For, Show } from 'solid-js';
import { FileText, Image as ImageIcon, Link2, X } from 'lucide-solid';
import { IconButton } from '@/shared/ui';
import { composerAssets, removeComposerAsset, type ComposerAssetKind } from '@/features/composer/composer-assets';

function AssetIcon(props: { kind: ComposerAssetKind }) {
  if (props.kind === 'image') return <ImageIcon size={21} strokeWidth={1.7} />;
  if (props.kind === 'reference') return <Link2 size={21} strokeWidth={1.7} />;
  return <FileText size={21} strokeWidth={1.7} />;
}

/** Composer 顶部 staged assets 横条（composerAssets 夹具）。 */
export function ComposerStagedAssets() {
  return (
    <Show when={composerAssets().length > 0}>
      <div class="composer-assets ui-scrollbar flex gap-7 overflow-x-auto pb-7" aria-label="Staged assets">
        <For each={composerAssets()}>
          {(asset) => (
            <article
              class="group relative grid shrink-0 grid-rows-asset-tile overflow-hidden rounded-md border border-border-subtle bg-surface-canvas p-1.5"
              style={{ width: 'var(--asset-tile-size)', height: 'var(--asset-tile-size)' }}
              title={asset.detail || asset.name}
            >
              <Show
                when={asset.kind === 'image' && asset.previewUrl}
                fallback={
                  <span class="grid place-items-center text-content-muted">
                    <AssetIcon kind={asset.kind} />
                  </span>
                }
              >
                <img src={asset.previewUrl} alt="" class="h-full w-full rounded-sm object-cover" />
              </Show>
              <IconButton
                label={`Remove ${asset.name}`}
                title={`Remove ${asset.name}`}
                size="sm"
                class="absolute top-0.5 right-0.5 size-5 bg-surface-overlay/90 p-0"
                onClick={() => removeComposerAsset(asset.id)}
              >
                <X size={11} strokeWidth={2} />
              </IconButton>
              <strong class="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-9 font-medium text-content-secondary">
                {asset.name}
              </strong>
            </article>
          )}
        </For>
      </div>
    </Show>
  );
}

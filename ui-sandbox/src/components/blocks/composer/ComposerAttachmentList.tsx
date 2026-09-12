import { For, Show } from 'solid-js';
import { cn } from '@/lib/catalog-ui';
import { UploadAssetTile } from './UploadAssetTile';
import { composerAttachmentKind, type ComposerAttachmentItem } from './composer-attachment-types';

export type ComposerAttachmentListProps = {
  items: ComposerAttachmentItem[];
  class?: string;
  'aria-label'?: string;
};

/** Composer 附件方块列表：图片缩略图 + 文件图标，横向排列可换行。 */
export function ComposerAttachmentList(props: ComposerAttachmentListProps) {
  return (
    <Show when={props.items.length > 0}>
      <div
        class={cn('composer-attachment-list', props.class)}
        role="list"
        aria-label={props['aria-label'] ?? 'Attached files'}
      >
        <For each={props.items}>
          {(item) => {
            const kind = () => composerAttachmentKind(item.name, item.kind);
            const status = () => item.status ?? 'ready';
            const showBadge = () => item.showSuccessBadge ?? (status() === 'ready' && kind() === 'image');

            return (
              <div role="listitem" class="composer-attachment-list__item">
                <UploadAssetTile
                  name={item.name}
                  status={status()}
                  progress={item.progress}
                  errorMessage={item.errorMessage}
                  previewUrl={item.previewUrl}
                  showSuccessBadge={showBadge()}
                  onRemove={item.onRemove}
                  onRetry={item.onRetry}
                  data-testid={`composer-attachment-${item.id}`}
                />
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
}

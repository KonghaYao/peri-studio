import { For, Show, splitProps, type Component } from 'solid-js';
import { cn } from '../../lib/cn';
import { composerAttachmentListClass, composerAttachmentListItemClass } from './composer-layout';
import { UploadAssetTile } from './UploadAssetTile';
import { composerAttachmentKind, type ComposerAttachmentItem } from './composer-attachment-types';

export type ComposerAttachmentListProps = {
  items: ComposerAttachmentItem[];
  class?: string;
  'aria-label'?: string;
};

/** Composer 附件方块列表：图片缩略图 + 文件图标，横向排列可换行。 */
export const ComposerAttachmentList: Component<ComposerAttachmentListProps> = (props) => {
  const [local] = splitProps(props, ['items', 'class', 'aria-label']);

  return (
    <Show when={local.items.length > 0}>
      <div
        class={cn(composerAttachmentListClass, local.class)}
        role="list"
        aria-label={local['aria-label'] ?? 'Attached files'}
      >
        <For each={local.items}>
          {(item) => {
            const kind = () => composerAttachmentKind(item.name, item.kind);
            const status = () => item.status ?? 'ready';
            const showBadge = () => item.showSuccessBadge ?? (status() === 'ready' && kind() === 'image');

            return (
              <div role="listitem" class={composerAttachmentListItemClass}>
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
};

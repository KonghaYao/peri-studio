import {
  ArrowUp,
  EllipsisVertical,
  FileText,
  Paperclip,
  Pencil,
  Trash2,
} from 'lucide-solid';
import { For, splitProps, type Component } from 'solid-js';
import { cn } from '../../lib/cn';
import { IconButton } from '../Button';
import type { ComposerQueueItem } from './composer-queue-types';

export type ComposerQueueProps = {
  items: ComposerQueueItem[];
  onSendNow?: (id: string) => void;
  onEdit?: (id: string) => void;
  onRemove?: (id: string) => void;
  onMore?: (id: string) => void;
  class?: string;
};

/** Composer 待发队列：顶栏计数 + hover 灰底条目（预览 + 发送 / 编辑 / 删除 / 更多）。 */
export const ComposerQueue: Component<ComposerQueueProps> = (props) => {
  const [local] = splitProps(props, [
    'items',
    'onSendNow',
    'onEdit',
    'onRemove',
    'onMore',
    'class',
  ]);
  const count = () => local.items.length;

  return (
    <div
      data-slot="composer-queue"
      class={cn('ui-queue', local.class)}
      data-testid="composer-queue"
    >
      <div class="ui-queue__header">
        <span class="ui-queue__count">{count()} Queued</span>
      </div>

      <For each={local.items}>
        {(item) => (
          <div class="ui-queue__item" data-testid={`composer-queue-item-${item.id}`}>
            <div class="ui-queue__item-preview">
              {item.hasAttachment
                ? <Paperclip size={14} strokeWidth={1.7} class="ui-queue__item-icon" aria-hidden="true" />
                : <FileText size={14} strokeWidth={1.7} class="ui-queue__item-icon" aria-hidden="true" />}
              <span class="ui-queue__item-text" title={item.preview}>{item.preview}</span>
            </div>

            <div class="ui-queue__item-actions">
              <IconButton
                label="Send now"
                showTooltip={false}
                size="sm"
                variant="ghost"
                class="ui-queue__icon-action"
                onClick={() => local.onSendNow?.(item.id)}
              >
                <ArrowUp size={14} strokeWidth={1.7} />
              </IconButton>
              <IconButton
                label="Edit queued message"
                showTooltip={false}
                size="sm"
                variant="ghost"
                class="ui-queue__icon-action"
                onClick={() => local.onEdit?.(item.id)}
              >
                <Pencil size={14} strokeWidth={1.7} />
              </IconButton>
              <IconButton
                label="Remove from queue"
                showTooltip={false}
                size="sm"
                variant="ghost"
                class="ui-queue__icon-action"
                onClick={() => local.onRemove?.(item.id)}
              >
                <Trash2 size={14} strokeWidth={1.7} />
              </IconButton>
              <IconButton
                label="More queue actions"
                showTooltip={false}
                size="sm"
                variant="ghost"
                class="ui-queue__icon-action"
                onClick={() => local.onMore?.(item.id)}
              >
                <EllipsisVertical size={14} strokeWidth={1.7} />
              </IconButton>
            </div>
          </div>
        )}
      </For>
    </div>
  );
};

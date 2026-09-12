import { AlertCircle, FileText, X } from 'lucide-solid';
import { Show, type Component } from 'solid-js';
import { cn } from '../../lib/cn';
import { Spinner } from '../Spinner';
import {
  composerAttachmentChipBusyClass,
  composerAttachmentChipClass,
  composerAttachmentChipFailedClass,
  composerAttachmentChipRemoveClass,
} from './composer-layout';
import type { ComposerAttachmentItem } from './composer-attachment-types';

export type ComposerAttachmentChipProps = Pick<
  ComposerAttachmentItem,
  'name' | 'status' | 'errorMessage' | 'progress' | 'onRemove' | 'onRetry'
>;

/** Composer 浮动附件 chip（ready / uploading / failed 等态）。 */
export const ComposerAttachmentChip: Component<ComposerAttachmentChipProps> = (props) => {
  const busy = () =>
    props.status === 'pending' || props.status === 'uploading' || props.status === 'committing';
  const failed = () => props.status === 'failed';
  const title = () => {
    if (failed() && props.errorMessage) return `${props.name}: ${props.errorMessage}`;
    if (props.status === 'uploading' && props.progress != null) {
      return `${props.name} (${props.progress}%)`;
    }
    return props.name;
  };

  return (
    <span
      class={cn(
        composerAttachmentChipClass,
        failed() && composerAttachmentChipFailedClass,
        busy() && composerAttachmentChipBusyClass,
      )}
      title={title()}
      role={failed() ? 'alert' : undefined}
      aria-busy={busy() || undefined}
    >
      <Show
        when={busy()}
        fallback={
          <Show
            when={failed()}
            fallback={<FileText size={12} strokeWidth={1.7} class="shrink-0 text-content-muted" aria-hidden="true" />}
          >
            <AlertCircle size={12} strokeWidth={1.7} class="shrink-0 text-danger-solid" aria-hidden="true" />
          </Show>
        }
      >
        <Spinner class="size-12 shrink-0" decorative />
      </Show>
      <Show
        when={failed() && props.onRetry}
        fallback={<span class="min-w-0 truncate">{props.name}</span>}
      >
        <button
          type="button"
          class="min-w-0 truncate border-0 bg-transparent p-0 text-left text-inherit underline"
          onClick={props.onRetry}
        >
          {props.name}
        </button>
      </Show>
      <Show when={props.status === 'ready' && props.onRemove}>
        <button
          type="button"
          class={composerAttachmentChipRemoveClass}
          aria-label={`Remove ${props.name}`}
          onClick={props.onRemove}
        >
          <X size={12} strokeWidth={1.7} />
        </button>
      </Show>
    </span>
  );
};

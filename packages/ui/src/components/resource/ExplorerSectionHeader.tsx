import { FilePlus, FolderPlus, RefreshCw } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { cn } from '../../lib/cn';
import { IconButton } from '../Button';

/** Files 区头：New File / New Folder / Refresh Explorer。 */
export function ExplorerSectionHeader(props: {
  title?: string;
  mutationsDisabled?: boolean;
  disabledReason?: string;
  pendingLabel?: string;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRefresh: () => void;
  notice?: JSX.Element;
  class?: string;
}) {
  const disabled = () => props.mutationsDisabled ?? false;
  const titleAttr = () => (disabled() ? props.disabledReason : undefined);

  return (
    <div class={cn('flex flex-col gap-8', props.class)}>
      <div class="flex h-36 items-center gap-4 px-8">
        <span class="min-w-0 flex-1 truncate text-11 font-semibold uppercase tracking-wide text-content-muted">
          {props.title ?? 'Files'}
        </span>
        <Show when={props.pendingLabel}>
          <span class="text-11 text-content-muted" role="status">
            {props.pendingLabel}
          </span>
        </Show>
        <div class="flex shrink-0 items-center gap-2">
          <IconButton
            size="sm"
            label="New File"
            title={titleAttr()}
            disabled={disabled()}
            onClick={props.onNewFile}
          >
            <FilePlus size={14} />
          </IconButton>
          <IconButton
            size="sm"
            label="New Folder"
            title={titleAttr()}
            disabled={disabled()}
            onClick={props.onNewFolder}
          >
            <FolderPlus size={14} />
          </IconButton>
          <IconButton
            size="sm"
            label="Refresh Explorer"
            title={titleAttr()}
            disabled={disabled()}
            onClick={props.onRefresh}
          >
            <RefreshCw size={14} />
          </IconButton>
        </div>
      </div>
      <Show when={props.notice}>{props.notice}</Show>
    </div>
  );
}

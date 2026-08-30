import { Show } from 'solid-js';
import { Minus, Plus, Trash2 } from 'lucide-solid';
import { IconButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { GitFileIcon } from './GitFileIcon';
import type { GitChange, GitChangeGroupId, GitChangeStatus } from './types';

function basename(path: string) {
  return path.split('/').at(-1) || path;
}

function dirname(path: string) {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

const STATUS_TAIL: Record<GitChangeStatus, { letter: string; className: string }> = {
  added: { letter: 'A', className: 'text-content-muted' },
  modified: { letter: 'M', className: 'text-content-muted' },
  deleted: { letter: 'D', className: 'text-danger-solid' },
  renamed: { letter: 'R', className: 'text-content-muted' },
  copied: { letter: 'C', className: 'text-content-muted' },
  untracked: { letter: 'U', className: 'text-content-muted' },
  conflict: { letter: '!', className: 'text-danger-solid' },
};

/** SCM 变更行：文件 icon + 双行路径；状态靠右。 */
export function GitChangeRow(props: {
  change: GitChange;
  groupId: GitChangeGroupId;
  selected?: boolean;
  onOpen?: () => void;
}) {
  const staged = () => props.groupId === 'index';
  const discardable = () => props.groupId === 'working_tree' || props.groupId === 'untracked';
  const stageLabel = () => staged() ? 'Unstage' : 'Stage';
  const tail = () => STATUS_TAIL[props.change.status];
  const folder = () => dirname(props.change.path);

  return (
    <button
      type="button"
      class={cn(
        'group/row flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors duration-(--duration-fast)',
        props.selected ? 'bg-sidebar-selected' : 'hover:bg-interaction-hover',
      )}
      style={{ 'min-height': folder() ? '40px' : '32px' }}
      onClick={() => props.onOpen?.()}
    >
      <GitFileIcon path={props.change.path} class="mt-0.5 self-start" />
      <span class="min-w-0 flex-1 py-0.5">
        <span class="block truncate text-13 leading-tight text-content-primary">{basename(props.change.path)}</span>
        <Show when={folder()}>
          <span class="mt-0.5 block truncate text-10 leading-tight text-content-muted">{folder()}</span>
        </Show>
      </span>
      <span class="relative flex h-6 w-10 shrink-0 items-center justify-end self-center">
        <span
          class={cn(
            'font-mono text-11 tabular-nums transition-opacity duration-(--duration-fast)',
            tail().className,
            'group-hover/row:opacity-0',
          )}
          aria-label={props.change.status}
        >
          {tail().letter}
        </span>
        <IconButton
          size="sm"
          label={`${stageLabel()} ${props.change.path}`}
          class="absolute right-0 size-6 border-0 bg-surface-overlay/90 text-content-muted opacity-0 shadow-sm pointer-events-none transition-opacity duration-(--duration-fast) group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
          onClick={(event) => event.stopPropagation()}
        >
          {staged() ? <Minus size={13} strokeWidth={1.8} /> : <Plus size={13} strokeWidth={1.8} />}
        </IconButton>
        <Show when={discardable()}>
          <IconButton
            size="sm"
            label={`Discard ${props.change.path}`}
            class={cn(
              'absolute right-6 size-6 border-0 bg-surface-overlay/90 text-content-muted opacity-0 shadow-sm pointer-events-none transition-opacity duration-(--duration-fast)',
              'hover:text-danger-solid group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100',
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <Trash2 size={13} strokeWidth={1.8} />
          </IconButton>
        </Show>
      </span>
    </button>
  );
}

import { Show } from 'solid-js';
import { cn } from '@/lib/catalog-ui';
import { GitChangeActions, VSCodeFileIcon as GitFileIcon } from '@peri/ui';
import type { GitChange, GitChangeGroupId } from './types';

function basename(path: string) {
  return path.split('/').at(-1) || path;
}

function dirname(path: string) {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

/** SCM 变更行：文件 icon + 双行路径；状态靠右。 */
export function GitChangeRow(props: {
  change: GitChange;
  groupId: GitChangeGroupId;
  selected?: boolean;
  onOpen?: () => void;
}) {
  const folder = () => dirname(props.change.path);

  return (
    <button
      type="button"
      class={cn(
        'group/row flex w-full min-w-0 items-center gap-8 rounded-md px-8 py-4 text-left transition-colors duration-(--duration-fast)',
        props.selected ? 'bg-sidebar-selected' : 'hover:bg-interaction-hover',
      )}
      style={{ 'min-height': folder() ? '44px' : '36px' }}
      onClick={() => props.onOpen?.()}
    >
      <GitFileIcon path={props.change.path} class="mt-2 self-start" />
      <span class="min-w-0 flex-1 py-2">
        <span class="block truncate text-13 leading-tight text-content-primary">{basename(props.change.path)}</span>
        <Show when={folder()}>
          <span class="mt-2 block truncate text-10 leading-tight text-content-muted">{folder()}</span>
        </Show>
      </span>
      <GitChangeActions change={props.change} groupId={props.groupId} hoverGroup="row" />
    </button>
  );
}

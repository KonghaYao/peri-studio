import { createSignal } from 'solid-js';
import { Minus, Plus, Trash2 } from 'lucide-solid';
import { IconButton } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';
import { resourceWorkspace } from '../../../panel/store';
import { buildPathTree, folderPathsFromItems } from '../build-path-tree';
import { FileTree } from '../FileTree';
import { VSCodeFileIcon } from '../VSCodeFileIcon';
import type { GitChange, GitChangeGroupId, GitChangeStatus } from './types';

const STATUS_TAIL: Record<GitChangeStatus, { letter: string; className: string }> = {
  added: { letter: 'A', className: 'text-success' },
  modified: { letter: 'M', className: 'text-warning' },
  deleted: { letter: 'D', className: 'text-danger' },
  renamed: { letter: 'R', className: 'text-warning' },
  copied: { letter: 'C', className: 'text-warning' },
  untracked: { letter: 'U', className: 'text-success' },
  conflict: { letter: '!', className: 'text-danger' },
};

/** SCM 变更树：按目录折叠，复用 FileTree。 */
export function GitChangeTree(props: {
  changes: GitChange[];
  groupId: GitChangeGroupId;
  repoId: string;
  onFileSelect?: (change: GitChange) => void;
  onStageToggle?: (change: GitChange) => void;
  onDiscard?: (change: GitChange) => void;
  readOnly?: boolean;
  repoBusy?: boolean;
}) {
  const [expanded, setExpanded] = createSignal(folderPathsFromItems(props.changes));
  const nodes = () => buildPathTree(props.changes.map((change) => ({
    id: change.id,
    path: change.path,
    meta: { change },
  })));

  const trailingForChange = (change: GitChange) => {
    const staged = props.groupId === 'index';
    const discardable = props.groupId === 'working_tree' || props.groupId === 'untracked';
    const stageLabel = staged ? 'Unstage' : 'Stage';
    const tail = STATUS_TAIL[change.status];
    const mutation = () => resourceWorkspace().mutations?.[change.id];
    const busy = () => !!mutation()?.pending;
    const disabled = () => props.readOnly || props.repoBusy || busy();

    return (
      <span class="relative flex h-22 w-40 items-center justify-end">
        <span
          class={cn(
            'font-mono text-10 tabular-nums transition-opacity duration-150',
            tail.className,
            'group-hover/tree-file:opacity-0 group-focus-within/tree-file:opacity-0',
          )}
          aria-label={change.status}
        >
          {tail.letter}
        </span>
        <IconButton
          size="compact"
          label={`${stageLabel} ${change.path}`}
          busy={busy()}
          disabled={disabled()}
          class="absolute right-0 size-22 border-0 bg-surface/90 text-text-muted opacity-0 shadow-sm pointer-events-none transition-opacity duration-150 group-hover/tree-file:pointer-events-auto group-hover/tree-file:opacity-100 group-focus-within/tree-file:pointer-events-auto group-focus-within/tree-file:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100"
          onClick={(event: MouseEvent) => {
            event.stopPropagation();
            props.onStageToggle?.(change);
          }}
        >
          {staged ? <Minus size={13} strokeWidth={1.8} /> : <Plus size={13} strokeWidth={1.8} />}
        </IconButton>
        {discardable && (
          <IconButton
            size="compact"
            label={`Discard ${change.path}`}
            disabled={disabled()}
            class={cn(
              'absolute right-22 size-22 border-0 bg-surface/90 text-text-muted opacity-0 shadow-sm pointer-events-none transition-opacity duration-150',
              'hover:text-danger group-hover/tree-file:pointer-events-auto group-hover/tree-file:opacity-100 group-focus-within/tree-file:pointer-events-auto group-focus-within/tree-file:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100',
            )}
            onClick={(event: MouseEvent) => {
              event.stopPropagation();
              props.onDiscard?.(change);
            }}
          >
            <Trash2 size={13} strokeWidth={1.8} />
          </IconButton>
        )}
      </span>
    );
  };

  return (
    <div role="group" class="px-1">
      <FileTree
        nodes={nodes()}
        expandedPaths={expanded()}
        fileTreeitem={false}
        onToggleFolder={(path) => {
          setExpanded((current) => {
            const next = new Set(current);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
          });
        }}
        renderFileIcon={(node) => <VSCodeFileIcon path={node.path} size={15} class="size-14" />}
        onSelect={(node) => {
          const change = node.meta?.change as GitChange | undefined;
          if (change) props.onFileSelect?.(change);
        }}
        renderFileTrailing={(node) => {
          const change = node.meta?.change as GitChange | undefined;
          if (!change) return undefined;
          return trailingForChange(change);
        }}
        getFileDataAttrs={(node) => {
          const change = node.meta?.change as GitChange | undefined;
          if (!change) return {};
          return {
            'data-resource-focus-key': `diff:${props.repoId}:${props.groupId}:${change.id}`,
            'data-resource-focus-view': 'scm',
          };
        }}
        fileAriaLabel={(node) => {
          const change = node.meta?.change as GitChange | undefined;
          return change ? `Open changes for ${change.path}` : undefined;
        }}
      />
    </div>
  );
}

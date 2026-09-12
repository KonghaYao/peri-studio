import { createSignal } from 'solid-js';
import { Minus, Plus, Trash2 } from 'lucide-solid';
import { IconButton } from '@/lib/catalog-ui';
import { FileTree, buildPathTree, folderPathsFromItems } from '@/components/blocks/resource';
import { GitFileIcon } from './GitFileIcon';
import { cn } from '@/lib/catalog-ui';
import type { GitChange, GitChangeGroupId, GitChangeStatus } from './types';

const STATUS_TAIL: Record<GitChangeStatus, { letter: string; className: string }> = {
  added: { letter: 'A', className: 'text-content-muted' },
  modified: { letter: 'M', className: 'text-content-muted' },
  deleted: { letter: 'D', className: 'text-danger-solid' },
  renamed: { letter: 'R', className: 'text-content-muted' },
  copied: { letter: 'C', className: 'text-content-muted' },
  untracked: { letter: 'U', className: 'text-content-muted' },
  conflict: { letter: '!', className: 'text-danger-solid' },
};

function trailingForChange(change: GitChange, groupId: GitChangeGroupId) {
  const staged = groupId === 'index';
  const discardable = groupId === 'working_tree' || groupId === 'untracked';
  const stageLabel = staged ? 'Unstage' : 'Stage';
  const tail = STATUS_TAIL[change.status];

  return (
    <span class="relative flex h-24 w-40 items-center justify-end">
      <span
        class={cn(
          'font-mono text-10 tabular-nums transition-opacity duration-(--duration-fast)',
          tail.className,
          'group-hover/tree-file:opacity-0',
        )}
        aria-label={change.status}
      >
        {tail.letter}
      </span>
      <IconButton
        size="sm"
        label={`${stageLabel} ${change.path}`}
        class="absolute right-0 size-24 border-0 bg-surface-overlay/90 text-content-muted opacity-0 shadow-sm pointer-events-none transition-opacity duration-(--duration-fast) group-hover/tree-file:pointer-events-auto group-hover/tree-file:opacity-100 group-focus-within/tree-file:pointer-events-auto group-focus-within/tree-file:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
        onClick={(event) => event.stopPropagation()}
      >
        {staged ? <Minus size={13} strokeWidth={1.8} /> : <Plus size={13} strokeWidth={1.8} />}
      </IconButton>
      {discardable && (
        <IconButton
          size="sm"
          label={`Discard ${change.path}`}
          class={cn(
            'absolute right-24 size-24 border-0 bg-surface-overlay/90 text-content-muted opacity-0 shadow-sm pointer-events-none transition-opacity duration-(--duration-fast)',
            'hover:text-danger-solid group-hover/tree-file:pointer-events-auto group-hover/tree-file:opacity-100 group-focus-within/tree-file:pointer-events-auto group-focus-within/tree-file:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100',
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <Trash2 size={13} strokeWidth={1.8} />
        </IconButton>
      )}
    </span>
  );
}

/** SCM 变更树：按目录折叠，复用 FileTree。 */
export function GitChangeTree(props: {
  changes: GitChange[];
  groupId: GitChangeGroupId;
  onFileSelect?: (path: string) => void;
}) {
  const [expanded, setExpanded] = createSignal(folderPathsFromItems(props.changes));
  const nodes = () => buildPathTree(props.changes.map((change) => ({
    id: change.id,
    path: change.path,
    meta: { change },
  })));

  return (
    <div role="group" class="px-4">
      <FileTree
        nodes={nodes()}
        expandedPaths={expanded()}
        onToggleFolder={(path) => {
          setExpanded((current) => {
            const next = new Set(current);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
          });
        }}
        renderFileIcon={(node) => <GitFileIcon path={node.path} />}
        onSelect={(node) => props.onFileSelect?.(node.path)}
        renderFileTrailing={(node) => {
          const change = node.meta?.change as GitChange | undefined;
          if (!change) return undefined;
          return trailingForChange(change, props.groupId);
        }}
      />
    </div>
  );
}

import { createSignal } from 'solid-js';
import { GitChangeActions } from '@peri/ui';
import { resourceWorkspace } from '@/store';
import { buildPathTree, FileTree, folderPathsFromItems, VSCodeFileIcon } from '@peri/ui';
import type { GitChange, GitChangeGroupId } from './types';

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
    const mutation = () => resourceWorkspace().mutations?.[change.id];
    const busy = () => !!mutation()?.pending;
    const disabled = () => props.readOnly || props.repoBusy || busy();

    return (
      <GitChangeActions
        change={change}
        groupId={props.groupId}
        hoverGroup="tree-file"
        busy={busy()}
        disabled={disabled()}
        onStageToggle={() => props.onStageToggle?.(change)}
        onDiscard={() => props.onDiscard?.(change)}
      />
    );
  };

  return (
    <div role="group" class="px-4">
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

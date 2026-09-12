import { createSignal } from 'solid-js';
import { FileTree, buildPathTree, folderPathsFromItems } from '@/components/blocks/resource';
import { GitChangeActions } from './GitChangeActions';
import { GitFileIcon } from './GitFileIcon';
import type { GitChange, GitChangeGroupId } from './types';

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
          return <GitChangeActions change={change} groupId={props.groupId} hoverGroup="tree-file" />;
        }}
      />
    </div>
  );
}

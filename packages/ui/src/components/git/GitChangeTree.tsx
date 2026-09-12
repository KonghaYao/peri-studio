import { createSignal, type JSX } from 'solid-js';
import { buildPathTree, folderPathsFromItems } from '../../lib/build-path-tree';
import { FileTree, type FileTreeNode } from '../FileTree';
import { VSCodeFileIcon } from '../VSCodeFileIcon';
import { GitChangeActions } from './GitChangeActions';
import type { GitChange, GitChangeGroupId } from './types';

export type GitChangeTreeProps = {
  changes: GitChange[];
  groupId: GitChangeGroupId;
  onFileSelect?: (change: GitChange) => void;
  renderFileTrailing?: (change: GitChange) => JSX.Element | undefined;
  getFileDataAttrs?: (change: GitChange) => Record<string, string>;
  fileAriaLabel?: (change: GitChange) => string | undefined;
  fileTreeitem?: boolean;
  renderFileIcon?: (node: FileTreeNode) => JSX.Element;
  class?: string;
};

const changeFromNode = (node: FileTreeNode) => node.meta?.change as GitChange | undefined;

/** SCM 变更树：按目录折叠，复用 FileTree。 */
export function GitChangeTree(props: GitChangeTreeProps) {
  const [expanded, setExpanded] = createSignal(folderPathsFromItems(props.changes));
  const nodes = () => buildPathTree(props.changes.map((change) => ({
    id: change.id,
    path: change.path,
    meta: { change },
  })));

  return (
    <div role="group" class={props.class ?? 'px-4'}>
      <FileTree
        nodes={nodes()}
        expandedPaths={expanded()}
        fileTreeitem={props.fileTreeitem}
        onToggleFolder={(path) => {
          setExpanded((current) => {
            const next = new Set(current);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
          });
        }}
        renderFileIcon={props.renderFileIcon ?? ((node) => (
          <VSCodeFileIcon path={node.path} size={15} class="size-14" />
        ))}
        onSelect={(node) => {
          const change = changeFromNode(node);
          if (change) props.onFileSelect?.(change);
        }}
        renderFileTrailing={(node) => {
          const change = changeFromNode(node);
          if (!change) return undefined;
          return props.renderFileTrailing?.(change) ?? (
            <GitChangeActions change={change} groupId={props.groupId} hoverGroup="tree-file" />
          );
        }}
        getFileDataAttrs={(node) => {
          const change = changeFromNode(node);
          if (!change) return {};
          return props.getFileDataAttrs?.(change) ?? {};
        }}
        fileAriaLabel={(node) => {
          const change = changeFromNode(node);
          if (!change) return undefined;
          return props.fileAriaLabel?.(change);
        }}
      />
    </div>
  );
}

import { type JSX } from 'solid-js';
import { FileTree, type FileTreeNode } from '@peri/ui';
import { FileTreeInlineNameEditor } from './FileTreeInlineNameEditor';
import { ExplorerItemMenu, type ExplorerMenuAction } from './ExplorerItemMenu';
import { basename, findExplorerNode } from './explorer-mutations-tree-utils';

export type InlineEditState =
  | { mode: 'create'; parentPath: string; kind: 'file' | 'folder' }
  | { mode: 'rename'; path: string };

export function inlineCreateAtParent(
  inline: InlineEditState | null | undefined,
  parentPath: string,
): Extract<InlineEditState, { mode: 'create' }> | undefined {
  if (inline?.mode === 'create' && inline.parentPath === parentPath) return inline;
  return undefined;
}

export function ExplorerMutationsTree(props: {
  nodes: FileTreeNode[];
  expandedPaths: Set<string>;
  selectedPath?: string;
  mutationsDisabled?: boolean;
  pendingPath?: string | null;
  inline?: InlineEditState | null;
  inlineError?: string;
  onToggleFolder: (path: string) => void;
  onSelect: (node: FileTreeNode) => void;
  onBlankContextMenu?: (ev: MouseEvent) => void;
  onRowContextMenu?: (node: FileTreeNode, ev: MouseEvent) => void;
  onMenuAction: (action: ExplorerMenuAction, node: FileTreeNode | null) => void;
  onInlineCommit: (value: string) => void;
  onInlineCancel: () => void;
}) {
  const rowActions = (node: FileTreeNode) => (
    <ExplorerItemMenu
      context={node.kind === 'folder' ? 'folder' : 'file'}
      mutationsDisabled={props.mutationsDisabled}
      onAction={(action) => props.onMenuAction(action, node)}
    />
  );

  const nodeLabel = (node: FileTreeNode) => {
    if (props.pendingPath !== node.path) return node.name;
    return node.kind === 'folder' ? `${node.name} — Deleting…` : `${node.name} — Renaming…`;
  };

  const inlineRename = (
    node: FileTreeNode,
    depth: number,
    kind: 'file' | 'folder',
  ): JSX.Element | undefined => {
    if (props.inline?.mode !== 'rename' || props.inline.path !== node.path) return undefined;
    return (
      <FileTreeInlineNameEditor
        depth={depth}
        kind={kind}
        path={node.path}
        mode="rename"
        initialValue={kind === 'file' ? basename(node.path) : node.name}
        invalid={Boolean(props.inlineError)}
        errorMessage={props.inlineError}
        ariaLabel={`Rename ${node.name}`}
        onCommit={props.onInlineCommit}
        onCancel={props.onInlineCancel}
      />
    );
  };

  const inlineCreate = (parentPath: string, depth: number, kind: 'file' | 'folder') => (
    <FileTreeInlineNameEditor
      depth={depth}
      kind={kind}
      path={parentPath}
      mode="create"
      placeholder={kind === 'file' ? 'New file name' : 'New folder name'}
      invalid={Boolean(props.inlineError)}
      errorMessage={props.inlineError}
      ariaLabel={
        kind === 'file'
          ? `New file name in ${parentPath || 'workspace root'}`
          : `New folder name in ${parentPath || 'workspace root'}`
      }
      onCommit={props.onInlineCommit}
      onCancel={props.onInlineCancel}
    />
  );

  return (
    <FileTree
      nodes={props.nodes}
      expandedPaths={props.expandedPaths}
      selectedPath={props.selectedPath}
      activePath={props.selectedPath}
      onToggleFolder={props.onToggleFolder}
      onSelect={props.onSelect}
      onActivePathChange={(path) => {
        const node = findExplorerNode(props.nodes, path);
        if (node) props.onSelect(node);
      }}
      getNodeLabel={nodeLabel}
      getNodeClassName={() => (props.mutationsDisabled ? 'opacity-60' : undefined)}
      renderFileTrailing={rowActions}
      renderFolderTrailing={rowActions}
      onNodeContextMenu={(node, event) => {
        event.preventDefault();
        props.onSelect(node);
        props.onRowContextMenu?.(node, event);
      }}
      renderNodeRow={(node, context) => inlineRename(node, context.depth, context.kind)}
      renderFolderFooter={(node, depth) => {
        const create = inlineCreateAtParent(props.inline, node.path);
        return create ? inlineCreate(node.path, depth + 1, create.kind) : undefined;
      }}
    />
  );
}

/** 根空白区右键占位（workspace 根菜单语义）。 */
export function ExplorerTreeBlankArea(props: { children: JSX.Element; onContextMenu: (ev: MouseEvent) => void }) {
  return (
    <div
      class="min-h-64 flex-1"
      onContextMenu={(ev) => {
        ev.preventDefault();
        props.onContextMenu(ev);
      }}
    >
      {props.children}
    </div>
  );
}

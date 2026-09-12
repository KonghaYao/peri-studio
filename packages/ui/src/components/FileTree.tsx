import { For, Show, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import { VSCodeFileIcon } from './VSCodeFileIcon';

export type FileTreeNode = {
  id: string;
  name: string;
  path: string;
  kind: 'folder' | 'file';
  children?: FileTreeNode[];
  meta?: Record<string, unknown>;
};

export type FileTreeProps = {
  nodes: FileTreeNode[];
  depth?: number;
  expandedPaths: Set<string>;
  onToggleFolder: (path: string) => void;
  selectedPath?: string;
  activePath?: string;
  onSelect?: (node: FileTreeNode) => void;
  onActivePathChange?: (path: string) => void;
  renderFileIcon?: (node: FileTreeNode) => JSX.Element;
  renderFolderIcon?: (node: FileTreeNode, open: boolean) => JSX.Element;
  renderFileTrailing?: (node: FileTreeNode) => JSX.Element;
  renderFolderTrailing?: (node: FileTreeNode) => JSX.Element;
  onNodeContextMenu?: (node: FileTreeNode, event: MouseEvent) => void;
  onNodeMount?: (node: FileTreeNode, element: HTMLElement) => void;
  getFileDataAttrs?: (node: FileTreeNode) => Record<string, string | undefined>;
  fileAriaLabel?: (node: FileTreeNode) => string | undefined;
  folderLoadingPaths?: Set<string>;
  fileTreeitem?: boolean;
  dropTargetPath?: string | null;
  onFolderDragOver?: (path: string, event: DragEvent) => void;
  onFolderDragLeave?: (path: string, event: DragEvent) => void;
  onFolderDrop?: (path: string, event: DragEvent) => void;
  getNodeLabel?: (node: FileTreeNode) => string;
  getNodeClassName?: (node: FileTreeNode) => string | undefined;
  renderNodeRow?: (
    node: FileTreeNode,
    context: { depth: number; kind: 'file' | 'folder'; open?: boolean; index: number; setSize: number },
  ) => JSX.Element | undefined;
  renderFolderFooter?: (node: FileTreeNode, depth: number) => JSX.Element | undefined;
};

/** Explorer / SCM 共用文件树：目录仅展示文件夹图标，无 chevron。 */
export function FileTree(props: FileTreeProps) {
  const depth = () => props.depth ?? 0;

  return (
    <For each={props.nodes}>
      {(node, index) => {
        const rowContext = {
          depth: depth(),
          index: index(),
          setSize: props.nodes.length,
        };
        const replacement = () => props.renderNodeRow?.(node, node.kind === 'folder'
          ? { ...rowContext, kind: 'folder', open: props.expandedPaths.has(node.path) }
          : { ...rowContext, kind: 'file' });

        return (
          <Show
            when={node.kind === 'folder'}
            fallback={replacement() ?? (
              <FileTreeFileRow
                node={node}
                depth={rowContext.depth}
                index={rowContext.index}
                setSize={rowContext.setSize}
                selected={props.selectedPath === node.path}
                active={props.activePath === node.path}
                defaultTabIndex={!props.activePath && rowContext.depth === 0 && rowContext.index === 0}
                label={props.getNodeLabel?.(node) ?? node.name}
                rowClassName={props.getNodeClassName?.(node)}
                onSelect={props.onSelect}
                onActivePathChange={props.onActivePathChange}
                renderFileIcon={props.renderFileIcon}
                trailing={props.renderFileTrailing?.(node)}
                onContextMenu={(event) => props.onNodeContextMenu?.(node, event)}
                onMount={(element) => props.onNodeMount?.(node, element)}
                dataAttrs={props.getFileDataAttrs?.(node)}
                ariaLabel={props.fileAriaLabel?.(node)}
                treeitem={props.fileTreeitem !== false}
              />
            )}
          >
            {replacement() ?? (
              <FileTreeFolderRow
                node={node}
                depth={rowContext.depth}
                index={rowContext.index}
                setSize={rowContext.setSize}
                open={props.expandedPaths.has(node.path)}
                selected={props.selectedPath === node.path}
                active={props.activePath === node.path}
                defaultTabIndex={!props.activePath && rowContext.depth === 0 && rowContext.index === 0}
                label={props.getNodeLabel?.(node) ?? node.name}
                rowClassName={props.getNodeClassName?.(node)}
                onToggle={() => props.onToggleFolder(node.path)}
                onActivePathChange={props.onActivePathChange}
                renderFolderIcon={props.renderFolderIcon}
                trailing={props.renderFolderTrailing?.(node)}
                onContextMenu={(event) => props.onNodeContextMenu?.(node, event)}
                onMount={(element) => props.onNodeMount?.(node, element)}
                dropTargetPath={props.dropTargetPath}
                onFolderDragOver={props.onFolderDragOver}
                onFolderDragLeave={props.onFolderDragLeave}
                onFolderDrop={props.onFolderDrop}
              />
            )}
            <Show when={props.expandedPaths.has(node.path)}>
              <div role="group">
                <Show
                  when={!props.folderLoadingPaths?.has(node.path)}
                  fallback={(
                    <div
                      class="flex h-(--tree-row-height) items-center text-11 text-text-muted pointer-coarse:h-44"
                      style={{ 'padding-left': `${32 + depth() * 12}px` }}
                    >
                      Loading…
                    </div>
                  )}
                >
                  <FileTree
                    nodes={node.children ?? []}
                    depth={depth() + 1}
                    expandedPaths={props.expandedPaths}
                    onToggleFolder={props.onToggleFolder}
                    selectedPath={props.selectedPath}
                    activePath={props.activePath}
                    onSelect={props.onSelect}
                    onActivePathChange={props.onActivePathChange}
                    renderFileIcon={props.renderFileIcon}
                    renderFolderIcon={props.renderFolderIcon}
                    renderFileTrailing={props.renderFileTrailing}
                    renderFolderTrailing={props.renderFolderTrailing}
                    onNodeContextMenu={props.onNodeContextMenu}
                    onNodeMount={props.onNodeMount}
                    getFileDataAttrs={props.getFileDataAttrs}
                    fileAriaLabel={props.fileAriaLabel}
                    getNodeLabel={props.getNodeLabel}
                    getNodeClassName={props.getNodeClassName}
                    renderNodeRow={props.renderNodeRow}
                    renderFolderFooter={props.renderFolderFooter}
                    folderLoadingPaths={props.folderLoadingPaths}
                    fileTreeitem={props.fileTreeitem}
                    dropTargetPath={props.dropTargetPath}
                    onFolderDragOver={props.onFolderDragOver}
                    onFolderDragLeave={props.onFolderDragLeave}
                    onFolderDrop={props.onFolderDrop}
                  />
                </Show>
                {props.renderFolderFooter?.(node, depth())}
              </div>
            </Show>
          </Show>
        );
      }}
    </For>
  );
}

function rowPadding(depth: number) {
  return { 'padding-left': `${7 + depth * 12}px` };
}

function dropAccentLeft(depth: number) {
  return `${Math.max(4, 7 + depth * 12 - 3)}px`;
}

function FileTreeFolderRow(props: {
  node: FileTreeNode;
  depth: number;
  index: number;
  setSize: number;
  open: boolean;
  selected: boolean;
  active: boolean;
  defaultTabIndex: boolean;
  label: string;
  rowClassName?: string;
  onToggle: () => void;
  onActivePathChange?: (path: string) => void;
  renderFolderIcon?: (node: FileTreeNode, open: boolean) => JSX.Element;
  trailing?: JSX.Element;
  onContextMenu?: (event: MouseEvent) => void;
  onMount?: (element: HTMLElement) => void;
  dropTargetPath?: string | null;
  onFolderDragOver?: (path: string, event: DragEvent) => void;
  onFolderDragLeave?: (path: string, event: DragEvent) => void;
  onFolderDrop?: (path: string, event: DragEvent) => void;
}) {
  const isDropTarget = () => props.dropTargetPath === props.node.path;
  return (
    <div
      class={cn(
        'group/tree-file relative flex h-(--tree-row-height) w-full items-center rounded-4 pr-5 text-11 pointer-coarse:h-44',
        isDropTarget() ? 'file-tree-row--drop-target' : '',
        props.rowClassName,
      )}
      style={rowPadding(props.depth)}
    >
      <Show when={isDropTarget()}>
        <span
          class="file-tree-drop-accent pointer-events-none"
          style={{ left: dropAccentLeft(props.depth) }}
          aria-hidden="true"
        />
      </Show>
      <button
        type="button"
        ref={(element) => props.onMount?.(element)}
        role="treeitem"
        aria-expanded={props.open}
        aria-level={props.depth + 1}
        aria-posinset={props.index + 1}
        aria-setsize={props.setSize}
        data-path={props.node.path}
        data-directory="true"
        data-drop-target-path={props.node.path}
        tabIndex={props.active || props.defaultTabIndex ? 0 : -1}
        class={cn(
          'file-tree-folder-btn flex h-(--tree-row-height) w-full min-w-0 items-center gap-4 rounded-4 border-0 bg-transparent pr-6 text-left text-11 text-text-primary hover:bg-hover focus-visible:bg-selected focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-neg-2 pointer-coarse:h-44',
          props.active || props.selected ? 'bg-selected' : '',
        )}
        onClick={props.onToggle}
        onFocus={() => props.onActivePathChange?.(props.node.path)}
        onContextMenu={props.onContextMenu}
        onDragOver={(event) => props.onFolderDragOver?.(props.node.path, event)}
        onDragLeave={(event) => props.onFolderDragLeave?.(props.node.path, event)}
        onDrop={(event) => props.onFolderDrop?.(props.node.path, event)}
        title={props.node.path}
      >
        {props.renderFolderIcon
          ? props.renderFolderIcon(props.node, props.open)
          : <VSCodeFileIcon path={props.node.path} directory open={props.open} size={16} class="size-16" />}
        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-600">{props.label}</span>
      </button>
      <Show when={props.trailing}>
        <div class="shrink-0">{props.trailing}</div>
      </Show>
    </div>
  );
}

function FileTreeFileRow(props: {
  node: FileTreeNode;
  depth: number;
  index: number;
  setSize: number;
  selected?: boolean;
  active: boolean;
  defaultTabIndex: boolean;
  label: string;
  rowClassName?: string;
  onSelect?: (node: FileTreeNode) => void;
  onActivePathChange?: (path: string) => void;
  renderFileIcon?: (node: FileTreeNode) => JSX.Element;
  trailing?: JSX.Element;
  onContextMenu?: (event: MouseEvent) => void;
  onMount?: (element: HTMLElement) => void;
  dataAttrs?: Record<string, string | undefined>;
  ariaLabel?: string;
  treeitem: boolean;
}) {
  return (
    <div
      class={cn(
        'group/tree-file flex h-(--tree-row-height) w-full items-center rounded-4 pr-5 text-11 pointer-coarse:h-44',
        props.selected || props.active ? 'bg-selected' : 'hover:bg-hover',
        props.rowClassName,
      )}
      style={rowPadding(props.depth)}
    >
      <button
        type="button"
        ref={(element) => props.onMount?.(element)}
        role={props.treeitem ? 'treeitem' : undefined}
        aria-level={props.treeitem ? props.depth + 1 : undefined}
        aria-posinset={props.treeitem ? props.index + 1 : undefined}
        aria-setsize={props.treeitem ? props.setSize : undefined}
        data-path={props.node.path}
        data-directory="false"
        tabIndex={props.treeitem && (props.active || props.defaultTabIndex) ? 0 : props.treeitem ? -1 : undefined}
        class="flex h-full min-w-0 flex-1 items-center gap-5 rounded-4 border-0 bg-transparent pl-6 text-left text-inherit focus-visible:bg-selected focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-neg-2"
        onClick={() => props.onSelect?.(props.node)}
        onFocus={() => props.treeitem ? props.onActivePathChange?.(props.node.path) : undefined}
        onContextMenu={props.onContextMenu}
        title={props.node.path}
        aria-label={props.ariaLabel}
        {...Object.fromEntries(Object.entries(props.dataAttrs ?? {}).filter(([, value]) => value !== undefined))}
      >
        {props.renderFileIcon
          ? props.renderFileIcon(props.node)
          : <VSCodeFileIcon path={props.node.path} size={16} class="size-16" />}
        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{props.label}</span>
      </button>
      <Show when={props.trailing}>
        <div class="shrink-0">{props.trailing}</div>
      </Show>
    </div>
  );
}

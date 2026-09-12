import { For, Show, createContext, createMemo, useContext, type JSX } from 'solid-js';
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

const FileTreeContext = createContext<FileTreeProps>();

/** Explorer / SCM 共用文件树：目录仅展示文件夹图标，无 chevron。 */
export function FileTree(props: FileTreeProps) {
  return (
    <FileTreeContext.Provider value={props}>
      <FileTreeList nodes={props.nodes} depth={props.depth ?? 0} />
    </FileTreeContext.Provider>
  );
}

function FileTreeList(props: { nodes: FileTreeNode[]; depth: number }) {
  return (
    <For each={props.nodes}>
      {(node, index) => (
        <FileTreeItem
          node={node}
          index={index()}
          setSize={props.nodes.length}
          depth={props.depth}
        />
      )}
    </For>
  );
}

/**
 * 每行独立组件 + 按路径 memo 展开/选中态。
 * For 回调不得读取 expandedPaths，否则换 Set 会重建整棵已展开子树。
 * `{replacement() ?? <Row />}` 同样会在表达式重跑时新建行，须用 Show fallback 保住默认行。
 */
function FileTreeItem(props: {
  node: FileTreeNode;
  index: number;
  setSize: number;
  depth: number;
}) {
  const tree = useContext(FileTreeContext)!;
  const isFolder = () => props.node.kind === 'folder';
  const open = createMemo(() => isFolder() && tree.expandedPaths.has(props.node.path));
  const selected = createMemo(() => tree.selectedPath === props.node.path);
  const active = createMemo(() => tree.activePath === props.node.path);
  const defaultTabIndex = createMemo(() => !tree.activePath && props.depth === 0 && props.index === 0);
  const loading = createMemo(() => tree.folderLoadingPaths?.has(props.node.path) ?? false);
  const customRow = () => tree.renderNodeRow?.(props.node, isFolder()
    ? { depth: props.depth, index: props.index, setSize: props.setSize, kind: 'folder', open: open() }
    : { depth: props.depth, index: props.index, setSize: props.setSize, kind: 'file' });

  return (
    <>
      <Show
        when={customRow()}
        fallback={(
          <Show
            when={isFolder()}
            fallback={(
              <FileTreeFileRow
                node={props.node}
                depth={props.depth}
                index={props.index}
                setSize={props.setSize}
                selected={selected()}
                active={active()}
                defaultTabIndex={defaultTabIndex()}
                label={tree.getNodeLabel?.(props.node) ?? props.node.name}
                rowClassName={tree.getNodeClassName?.(props.node)}
                onSelect={tree.onSelect}
                onActivePathChange={tree.onActivePathChange}
                renderFileIcon={tree.renderFileIcon}
                trailing={tree.renderFileTrailing?.(props.node)}
                onContextMenu={(event) => tree.onNodeContextMenu?.(props.node, event)}
                onMount={(element) => tree.onNodeMount?.(props.node, element)}
                dataAttrs={tree.getFileDataAttrs?.(props.node)}
                ariaLabel={tree.fileAriaLabel?.(props.node)}
                treeitem={tree.fileTreeitem !== false}
              />
            )}
          >
            <FileTreeFolderRow
              node={props.node}
              depth={props.depth}
              index={props.index}
              setSize={props.setSize}
              open={open()}
              selected={selected()}
              active={active()}
              defaultTabIndex={defaultTabIndex()}
              label={tree.getNodeLabel?.(props.node) ?? props.node.name}
              rowClassName={tree.getNodeClassName?.(props.node)}
              onToggle={() => tree.onToggleFolder(props.node.path)}
              onActivePathChange={tree.onActivePathChange}
              renderFolderIcon={tree.renderFolderIcon}
              trailing={tree.renderFolderTrailing?.(props.node)}
              onContextMenu={(event) => tree.onNodeContextMenu?.(props.node, event)}
              onMount={(element) => tree.onNodeMount?.(props.node, element)}
              dropTargetPath={tree.dropTargetPath}
              onFolderDragOver={tree.onFolderDragOver}
              onFolderDragLeave={tree.onFolderDragLeave}
              onFolderDrop={tree.onFolderDrop}
            />
          </Show>
        )}
      >
        {(row) => row()}
      </Show>
      <Show when={isFolder() && open()}>
        <div role="group">
          <Show
            when={!loading()}
            fallback={(
              <div
                class="flex h-(--tree-row-height) items-center text-11 text-text-muted pointer-coarse:h-44"
                style={{ 'padding-left': `${32 + props.depth * 12}px` }}
              >
                Loading…
              </div>
            )}
          >
            <FileTreeList nodes={props.node.children ?? []} depth={props.depth + 1} />
          </Show>
          {tree.renderFolderFooter?.(props.node, props.depth)}
        </div>
      </Show>
    </>
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

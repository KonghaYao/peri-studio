import { For, Show, type JSX } from 'solid-js';
import { File, Folder, FolderOpen } from 'lucide-solid';
import { cn } from '@/lib/catalog-ui';

export type FileTreeNode = {
  id: string;
  name: string;
  path: string;
  kind: 'folder' | 'file';
  children?: FileTreeNode[];
  meta?: Record<string, unknown>;
};

export function FileTree(props: {
  nodes: FileTreeNode[];
  depth?: number;
  expandedPaths: Set<string>;
  onToggleFolder: (path: string) => void;
  selectedPath?: string;
  onSelect?: (node: FileTreeNode) => void;
  renderFileIcon?: (node: FileTreeNode) => JSX.Element;
  renderFileTrailing?: (node: FileTreeNode) => JSX.Element;
}) {
  const depth = () => props.depth ?? 0;

  return (
    <For each={props.nodes}>
      {(node) => (
        <Show
          when={node.kind === 'folder'}
          fallback={
            <FileTreeFileRow
              node={node}
              depth={depth()}
              selected={props.selectedPath === node.path}
              onSelect={props.onSelect}
              renderFileIcon={props.renderFileIcon}
              trailing={props.renderFileTrailing?.(node)}
            />
          }
        >
          <FileTreeFolderRow
            node={node}
            depth={depth()}
            open={props.expandedPaths.has(node.path)}
            onToggle={() => props.onToggleFolder(node.path)}
          />
          <Show when={props.expandedPaths.has(node.path)}>
            <div role="group">
              <FileTree
                nodes={node.children ?? []}
                depth={depth() + 1}
                expandedPaths={props.expandedPaths}
                onToggleFolder={props.onToggleFolder}
                selectedPath={props.selectedPath}
                onSelect={props.onSelect}
                renderFileIcon={props.renderFileIcon}
                renderFileTrailing={props.renderFileTrailing}
              />
            </div>
          </Show>
        </Show>
      )}
    </For>
  );
}

function FileTreeFolderRow(props: {
  node: FileTreeNode;
  depth: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="treeitem"
      aria-expanded={props.open}
      aria-level={props.depth + 1}
      class="flex w-full items-center gap-6 rounded-md border-0 bg-transparent pr-8 text-left text-12 text-content-primary hover:bg-interaction-hover"
      style={{
        'min-height': 'var(--resource-tree-row)',
        'padding-left': `calc(6px + ${props.depth} * 12px)`,
      }}
      onClick={props.onToggle}
    >
      {props.open
        ? <FolderOpen size={14} class="shrink-0 text-content-muted" />
        : <Folder size={14} class="shrink-0 text-content-muted" />}
      <span class="min-w-0 flex-1 truncate font-medium">{props.node.name}</span>
    </button>
  );
}

function FileTreeFileRow(props: {
  node: FileTreeNode;
  depth: number;
  selected?: boolean;
  onSelect?: (node: FileTreeNode) => void;
  renderFileIcon?: (node: FileTreeNode) => JSX.Element;
  trailing?: JSX.Element;
}) {
  return (
    <div
      role="treeitem"
      aria-level={props.depth + 1}
      class={cn(
        'group/tree-file flex w-full items-center gap-4 rounded-md pr-8',
        props.selected ? 'bg-sidebar-selected' : 'hover:bg-interaction-hover',
      )}
      style={{
        'min-height': 'var(--resource-tree-row)',
        'padding-left': `calc(6px + ${props.depth} * 12px)`,
      }}
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-6 border-0 bg-transparent py-0 text-left"
        onClick={() => props.onSelect?.(props.node)}
      >
        {props.renderFileIcon
          ? props.renderFileIcon(props.node)
          : <File size={14} class="shrink-0 text-content-muted" />}
        <span class="min-w-0 flex-1 truncate text-12 text-content-primary">{props.node.name}</span>
      </button>
      <Show when={props.trailing}>
        <div class="shrink-0">{props.trailing}</div>
      </Show>
    </div>
  );
}

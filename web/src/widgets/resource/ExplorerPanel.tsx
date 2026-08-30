import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { IconButton, LoadingState } from '@/shared/ui';
import { openFilePreview, openResourceDirectory, refreshResourceProject, resourceWorkspace } from '../../panel/store';
import type { ResourceEntry } from '../../panel/lib/resource-view';
import { RefreshCw } from 'lucide-solid';
import { FileTree, type FileTreeNode } from './FileTree';

function RefreshIcon() { return <RefreshCw size={14} strokeWidth={1.8} />; }

type ExplorerPanelProps = {
  expanded?: Set<string>;
  onExpandedChange?: (expanded: Set<string>) => void;
  activePath?: string;
  onActivePathChange?: (path: string) => void;
  scrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
  onPreviewIntent?: (key: string) => void;
};

function entryToNode(entry: ResourceEntry, expanded: Set<string>, cache: Map<string, FileTreeNode>): FileTreeNode {
  const path = String(entry.path ?? '');
  const directory = entry.kind === 'directory';
  const cached = cache.get(path);
  const node: FileTreeNode = cached ?? {
    id: String(entry.id ?? path),
    name: String(entry.name ?? path),
    path,
    kind: directory ? 'folder' : 'file',
  };
  node.name = String(entry.name ?? path);
  node.kind = directory ? 'folder' : 'file';
  node.children = directory && expanded.has(path)
    ? (resourceWorkspace().directories[path]?.entries ?? []).map((child) => entryToNode(child, expanded, cache))
    : undefined;
  cache.set(path, node);
  return node;
}

function folderLoadingPaths(expanded: Set<string>) {
  const loading = new Set<string>();
  for (const path of expanded) {
    if (path && !resourceWorkspace().directories[path]) loading.add(path);
  }
  return loading;
}

export function ExplorerPanel(props: ExplorerPanelProps = {}) {
  const [localExpanded, setLocalExpanded] = createSignal(new Set<string>(['']));
  const expanded = () => props.expanded ?? localExpanded();
  const setExpanded = (update: (current: Set<string>) => Set<string>) => {
    const next = update(expanded());
    if (props.expanded === undefined) setLocalExpanded(next);
    props.onExpandedChange?.(next);
  };
  const [localActivePath, setLocalActivePath] = createSignal('');
  const activePath = () => props.activePath ?? localActivePath();
  const setActivePath = (path: string) => {
    if (props.activePath === undefined) setLocalActivePath(path);
    props.onActivePathChange?.(path);
  };
  const nodeCache = new Map<string, FileTreeNode>();
  const nodes = createMemo(() => (resourceWorkspace().directories['']?.entries ?? []).map((entry) => entryToNode(entry, expanded(), nodeCache)));
  const visiblePaths = createMemo(() => {
    const paths: string[] = [];
    const visit = (items: FileTreeNode[]) => {
      for (const node of items) {
        paths.push(node.path);
        if (node.kind === 'folder' && expanded().has(node.path) && node.children) visit(node.children);
      }
    };
    visit(nodes());
    return paths;
  });
  createEffect(() => {
    const paths = visiblePaths();
    const current = activePath();
    if (paths.includes(current)) return;
    let fallback = current;
    while (fallback.includes('/')) {
      fallback = fallback.slice(0, fallback.lastIndexOf('/'));
      if (paths.includes(fallback)) break;
    }
    setActivePath(paths.includes(fallback) ? fallback : (paths[0] ?? ''));
  });
  let tree: HTMLDivElement | undefined;
  let acceptingScroll = false;
  let restoreFrame: number | undefined;
  onCleanup(() => { if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame); });
  const expandFolder = (path: string) => {
    setActivePath(path);
    setExpanded((current) => {
      if (current.has(path)) return current;
      const next = new Set(current);
      next.add(path);
      openResourceDirectory(path);
      return next;
    });
  };
  const collapseFolder = (path: string) => {
    setActivePath(path);
    setExpanded((current) => {
      if (!current.has(path)) return current;
      const next = new Set(current);
      next.delete(path);
      return next;
    });
  };
  const toggleFolder = (path: string) => {
    if (expanded().has(path)) collapseFolder(path);
    else expandFolder(path);
  };
  const focusItem = (item: HTMLElement | undefined) => {
    if (!item) return;
    setActivePath(item.dataset.path ?? '');
    queueMicrotask(() => item.focus());
  };
  const navigateTree = (event: KeyboardEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (!target || !tree) return;
    const items = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const index = items.indexOf(target);
    const directory = target.dataset.directory === 'true';
    const expandedNow = target.getAttribute('aria-expanded') === 'true';
    if (event.key === 'ArrowDown') focusItem(items[index + 1]);
    else if (event.key === 'ArrowUp') focusItem(items[index - 1]);
    else if (event.key === 'Home') focusItem(items[0]);
    else if (event.key === 'End') focusItem(items.at(-1));
    else if (event.key === 'ArrowRight' && directory) {
      const path = target.dataset.path ?? '';
      if (!expandedNow) expandFolder(path);
      else if (Number(items[index + 1]?.getAttribute('aria-level')) > Number(target.getAttribute('aria-level'))) focusItem(items[index + 1]);
    } else if (event.key === 'ArrowLeft') {
      const path = target.dataset.path ?? '';
      if (directory && expandedNow) collapseFolder(path);
      else {
        const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        focusItem(items.find((item) => item.dataset.path === parent));
      }
    } else if (event.key === 'Enter' || event.key === ' ') target.click();
    else return;
    event.preventDefault();
  };
  const nextCursor = () => resourceWorkspace().directories['']?.nextCursor;

  return <section class="flex min-h-0 flex-1 flex-col" aria-label="Explorer">
    <div class="resource-section-title flex h-32 items-center border-b border-border-subtle px-10 text-10 font-semibold uppercase tracking-wide text-content-muted pointer-coarse:h-44">
      <span>Files</span><IconButton label="Refresh Explorer" size="compact" onClick={refreshResourceProject} class="ml-auto border-0 bg-transparent text-content-muted hover:text-content-primary"><RefreshIcon /></IconButton>
    </div>
    <div
      ref={(element) => {
        tree = element;
        const savedScrollTop = props.scrollTop ?? 0;
        queueMicrotask(() => {
          if (!element.isConnected) return;
          element.scrollTop = savedScrollTop;
          restoreFrame = requestAnimationFrame(() => { acceptingScroll = true; });
        });
      }}
      class="ui-scrollbar min-h-0 flex-1 overflow-auto py-2"
      role="tree"
      aria-label="Workspace files"
      onKeyDown={navigateTree}
      onScroll={(event) => { if (acceptingScroll) props.onScrollTopChange?.(event.currentTarget.scrollTop); }}
    >
      <Show when={resourceWorkspace().directories['']} fallback={<LoadingState label="Loading files" class="m-8 p-8! text-left!" />}>
        <FileTree
          nodes={nodes()}
          expandedPaths={expanded()}
          onToggleFolder={toggleFolder}
          activePath={activePath()}
          onActivePathChange={setActivePath}
          folderLoadingPaths={folderLoadingPaths(expanded())}
          onSelect={(node) => {
            props.onPreviewIntent?.(`file:${node.path}`);
            openFilePreview(node.path);
          }}
          getFileDataAttrs={(node) => ({
            'data-resource-focus-key': `file:${node.path}`,
            'data-resource-focus-view': 'explorer',
          })}
        />
        <Show when={nextCursor()}>{(cursor) => <button type="button" class="h-(--tree-row-height) w-full border-0 bg-transparent text-left text-11 text-accent hover:bg-hover pointer-coarse:h-44" style={{ 'padding-left': '26px' }} onClick={() => openResourceDirectory('', cursor())}>Load more…</button>}</Show>
      </Show>
    </div>
  </section>;
}

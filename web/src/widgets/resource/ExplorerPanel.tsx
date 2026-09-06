import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { Button, IconButton, InlineNotice, LoadingState } from '@/shared/ui';
import { enqueueExplorerUpload, openFilePreview, openResourceDirectory, refreshResourceProject, resourceWorkspace, retryWorkspaceUpload, workspaceUploadAvailable, workspaceUploadBatch, workspaceUploadBlockedMessage, workspaceUploadLiveMessage, workspaceUploadOrigin, workspaceUploadProgressPercent } from '../../panel/store';
import type { ResourceEntry } from '../../panel/lib/resource-view';
import { RefreshCw } from 'lucide-solid';
import { FileTree, type FileTreeNode } from './FileTree';
import { ResourceSectionTitle } from './ResourceSectionTitle';
import { dataTransferHasFiles, parseFileDropTransfer, preventBrowserFileDrop } from '../composer/composer-upload-drop';
import { cn } from '@/shared/lib/cn';

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
  const directoryRevision = createMemo(() => Object.entries(resourceWorkspace().directories)
    .map(([directory, page]) => `${directory}:${page.entries.map((entry) => String(entry.path ?? entry.id)).join('\0')}`)
    .join('\n'));
  let previousDirectoryRevision = '';
  const nodes = createMemo(() => {
    const revision = directoryRevision();
    if (revision !== previousDirectoryRevision) {
      nodeCache.clear();
      previousDirectoryRevision = revision;
    }
    return (resourceWorkspace().directories['']?.entries ?? []).map((entry) => entryToNode(entry, expanded(), nodeCache));
  });
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
  const [dropTargetPath, setDropTargetPath] = createSignal<string | null>(null);
  const [rootDropActive, setRootDropActive] = createSignal(false);
  const [directoryAlert, setDirectoryAlert] = createSignal<string | null>(null);
  const projectId = () => resourceWorkspace().projectId;
  const uploadBlocked = () => !workspaceUploadAvailable(projectId());
  const blockedMessage = () => workspaceUploadBlockedMessage(projectId());
  const explorerBatch = () => {
    const batch = workspaceUploadBatch();
    if (!batch || batch.projectId !== projectId()) return null;
    return batch;
  };
  const explorerItems = () => {
    const batch = explorerBatch();
    if (!batch) return [];
    return batch.items.filter((item) => workspaceUploadOrigin(item.id) === 'explorer');
  };
  const batchProgress = () => {
    const items = explorerItems();
    const total = items.length;
    if (!total) return null;
    const done = items.filter((item) => item.phase === 'ready' || item.phase === 'failed').length;
    return { done, total };
  };

  const handleDrop = (directoryPath: string, event: DragEvent) => {
    preventBrowserFileDrop(event);
    setDropTargetPath(null);
    setRootDropActive(false);
    setDirectoryAlert(null);
    if (uploadBlocked()) {
      setDirectoryAlert(blockedMessage());
      return;
    }
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const parsed = parseFileDropTransfer(transfer);
    if (!parsed.ok) {
      setDirectoryAlert(parsed.reason === 'directory'
        ? 'Folders are not supported yet. Upload individual files instead.'
        : 'No files detected in drop.');
      return;
    }
    enqueueExplorerUpload(projectId()!, directoryPath, parsed.files);
  };

  return <section class="flex min-h-0 flex-1 flex-col" aria-label="Explorer">
    <ResourceSectionTitle>
      <span>Files</span><IconButton label="Refresh Explorer" size="compact" onClick={refreshResourceProject} class="ml-auto border-0 bg-transparent text-content-muted hover:text-content-primary"><RefreshIcon /></IconButton>
    </ResourceSectionTitle>
    <Show when={directoryAlert()}>
      <InlineNotice class="mx-8 mb-8" tone="warning" role="alert" title="Upload not started">
        <span>{directoryAlert()}</span>
      </InlineNotice>
    </Show>
    <Show when={batchProgress()}>
      {(progress) => (
        <p class="mx-8 mb-8 text-11 text-content-secondary" role="status">
          Uploaded {progress().done} of {progress().total} files.
        </p>
      )}
    </Show>
    <Show when={explorerItems().length > 0}>
      <ul class="mx-8 mb-8 grid gap-4" aria-label="Explorer uploads">
        <For each={explorerItems()}>{(item) => (
          <li class="flex min-w-0 items-center gap-6 text-11" data-testid={`explorer-upload-${item.id}`}>
            <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-content-primary">{item.workspaceRelativePath || item.displayName}</span>
            <Show when={item.phase === 'uploading'}>
              <span
                class="text-content-secondary"
                role="progressbar"
                aria-label={`Uploading ${item.displayName}`}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={workspaceUploadProgressPercent(item)}
              >{workspaceUploadProgressPercent(item)}%</span>
            </Show>
            <Show when={item.phase === 'ready'}><span class="text-success">Uploaded</span></Show>
            <Show when={item.phase === 'failed'}>
              <span class="text-danger" role="alert">{item.error?.message ?? 'Upload failed.'}</span>
              <Show when={item.error?.retryable}>
                <Button size="compact" variant="ghost" onClick={() => retryWorkspaceUpload(item.id)}>Retry</Button>
              </Show>
            </Show>
          </li>
        )}</For>
      </ul>
    </Show>
    <p class="sr-only" aria-live="polite">{workspaceUploadLiveMessage()}</p>
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
      class={cn(
        'ui-scrollbar min-h-0 flex-1 overflow-auto py-2',
        rootDropActive() ? 'explorer-upload-tree--drop-root' : '',
      )}
      role="tree"
      aria-label="Workspace files"
      onKeyDown={navigateTree}
      onScroll={(event) => { if (acceptingScroll) props.onScrollTopChange?.(event.currentTarget.scrollTop); }}
      onDragEnter={(event) => {
        if (!dataTransferHasFiles(event.dataTransfer)) return;
        preventBrowserFileDrop(event);
        if (uploadBlocked()) {
          setDirectoryAlert(blockedMessage());
          return;
        }
        setRootDropActive(true);
      }}
      onDragOver={(event) => {
        if (!dataTransferHasFiles(event.dataTransfer)) return;
        preventBrowserFileDrop(event);
        if (uploadBlocked()) {
          setDirectoryAlert(blockedMessage());
          return;
        }
        setRootDropActive(true);
        setDropTargetPath(null);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setRootDropActive(false);
      }}
      onDrop={(event) => handleDrop('', event)}
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
          dropTargetPath={dropTargetPath()}
          onFolderDragOver={(path, event) => {
            if (!dataTransferHasFiles(event.dataTransfer)) return;
            preventBrowserFileDrop(event);
            if (uploadBlocked()) {
              setDirectoryAlert(blockedMessage());
              return;
            }
            setRootDropActive(false);
            setDropTargetPath(path);
          }}
          onFolderDragLeave={(path, event) => {
            if ((event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) return;
            if (dropTargetPath() === path) setDropTargetPath(null);
          }}
          onFolderDrop={(path, event) => handleDrop(path, event)}
        />
        <Show when={nextCursor()}>{(cursor) => <button type="button" class="h-(--tree-row-height) w-full border-0 bg-transparent text-left text-11 text-accent hover:bg-hover pointer-coarse:h-44" style={{ 'padding-left': '26px' }} onClick={() => openResourceDirectory('', cursor())}>Load more…</button>}</Show>
      </Show>
    </div>
  </section>;
}

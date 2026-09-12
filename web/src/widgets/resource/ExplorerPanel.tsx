import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import {
  Button,
  ExplorerDeleteDialog,
  ExplorerItemMenu,
  ExplorerMoveDialog,
  FileTree,
  FileTreeInlineNameEditor,
  IconButton,
  InlineNotice,
  LoadingState,
  cn,
  fileTreeDropRootClass,
  parentDirectoryPath,
  ResourceSectionTitle,
  type ExplorerMenuAction,
  type FileTreeNode,
} from '@peri/ui';
import {
  createEmptyExplorerFile, createResourceDirectory, deleteResourcePath, enqueueExplorerUpload,
  fsMutationAvailability, fsMutationState, moveResourcePath, openFilePreview,
  openResourceDirectory, refreshResourceProject, resourceWorkspace, retryFsMutation, retryWorkspaceUpload, workspaceUploadAvailable, workspaceUploadBatch,
  workspaceUploadBlockedMessage, workspaceUploadLiveMessage, workspaceUploadOrigin,
  workspaceUploadProgressPercent,
} from '@/store';
import type { ResourceEntry } from '@/entities/resource/resource-view';
import { validateMutationName } from '@/features/resource/fs-mutation-controller';
import { FilePlus, FolderPlus, MoreHorizontal, RefreshCw } from 'lucide-solid';
import { createExplorerTreeFocus } from './explorer-tree-focus';
import { dataTransferHasFiles, parseFileDropTransfer, preventBrowserFileDrop } from '../composer/composer-upload-drop';
function RefreshIcon() { return <RefreshCw size={14} strokeWidth={1.8} />; }

type ExplorerEdit =
  | { mode: 'new-file' | 'new-folder'; parentPath: string }
  | { mode: 'rename'; node: FileTreeNode };

function validateMoveDestination(dest: string): string | null {
  if (!dest || dest.startsWith('/') || dest.includes('\\') || dest.split('/').some((part) => !part || part === '.' || part === '..')) {
    return 'Enter a workspace-relative destination.';
  }
  return null;
}

function inlineCreateKind(edit: ExplorerEdit | null, parentPath: string): 'file' | 'folder' | undefined {
  if (!edit || edit.mode === 'rename' || edit.parentPath !== parentPath) return undefined;
  return edit.mode === 'new-file' ? 'file' : 'folder';
}

const basename = (path: string) => path.split('/').at(-1) || path;

type ExplorerMenuTarget =
  | { scope: 'root'; node: null; x: number; y: number }
  | { scope: 'file' | 'folder'; node: FileTreeNode; x: number; y: number };

type ExplorerPanelProps = {
  expanded?: Set<string>; onExpandedChange?: (expanded: Set<string>) => void;
  activePath?: string; onActivePathChange?: (path: string) => void;
  scrollTop?: number; onScrollTopChange?: (scrollTop: number) => void; onPreviewIntent?: (key: string) => void;
};
function entryToNode(entry: ResourceEntry, cache: Map<string, FileTreeNode>, seen: Set<string>): FileTreeNode {
  const path = String(entry.path ?? '');
  seen.add(path);
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
  node.meta = { revision: typeof entry.revision === 'string' ? entry.revision : '' };
  // 子节点跟已加载的 directory page，不跟展开态；展开只由 FileTree 的 Show 控制可见性。
  const page = directory ? resourceWorkspace().directories[path] : undefined;
  node.children = page ? page.entries.map((child) => entryToNode(child, cache, seen)) : undefined;
  cache.set(path, node);
  return node;
}
function folderLoadingPaths(expanded: Set<string>) {
  return new Set([...expanded].filter((path) => path && !resourceWorkspace().directories[path]));
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
  const [edit, setEdit] = createSignal<ExplorerEdit | null>(null);
  const [inlineError, setInlineError] = createSignal<string | undefined>();
  const [moveNode, setMoveNode] = createSignal<FileTreeNode | null>(null);
  const [moveConflict, setMoveConflict] = createSignal<string | undefined>();
  const [deleteNode, setDeleteNode] = createSignal<FileTreeNode | null>(null);
  const [menuTarget, setMenuTarget] = createSignal<ExplorerMenuTarget | null>(null);
  let menuAnchor: HTMLSpanElement | undefined;

  const menuOpen = () => menuTarget() !== null;
  const menuContext = createMemo(() => menuTarget()?.scope ?? 'root');
  const menuNode = () => menuTarget()?.node ?? null;
  const positionMenuAnchor = (x: number, y: number) => {
    if (!menuAnchor) return;
    menuAnchor.style.left = `${x}px`;
    menuAnchor.style.top = `${y}px`;
  };
  const openMenuAt = (target: ExplorerMenuTarget) => {
    queueMicrotask(() => {
      positionMenuAnchor(target.x, target.y);
      setMenuTarget(target);
    });
  };
  const closeMenu = () => setMenuTarget(null);
  const openNodeMenu = (node: FileTreeNode, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    openMenuAt({ scope: node.kind === 'folder' ? 'folder' : 'file', node, x: event.clientX, y: event.clientY });
  };
  const openRootMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    openMenuAt({ scope: 'root', node: null, x: event.clientX, y: event.clientY });
  };
  const renderRowActions = (node: FileTreeNode) => (
    <IconButton
      label="More actions"
      size="compact"
      showTooltip={false}
      class="border-0 bg-transparent text-content-muted opacity-0 hover:text-content-primary group-hover/tree-file:opacity-100 focus-visible:opacity-100"
      onClick={(event) => {
        event.stopPropagation();
        setActivePath(node.path);
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        openMenuAt({ scope: node.kind === 'folder' ? 'folder' : 'file', node, x: rect.left, y: rect.bottom });
      }}
    >
      <MoreHorizontal size={14} />
    </IconButton>
  );

  const activePath = () => props.activePath ?? localActivePath();
  const setActivePath = (path: string) => {
    if (props.activePath === undefined) setLocalActivePath(path);
    props.onActivePathChange?.(path);
  };
  const nodeCache = new Map<string, FileTreeNode>();
  const directoryRevision = createMemo(() => Object.entries(resourceWorkspace().directories)
    .map(([directory, page]) => `${directory}:${page.entries.map((entry) => String(entry.path ?? entry.id)).join('\0')}`)
    .join('\n'));
  const nodes = createMemo(() => {
    directoryRevision();
    const seen = new Set<string>();
    const roots = (resourceWorkspace().directories['']?.entries ?? []).map((entry) => entryToNode(entry, nodeCache, seen));
    for (const path of nodeCache.keys()) {
      if (!seen.has(path)) nodeCache.delete(path);
    }
    return roots;
  });
  const loadingPaths = createMemo(() => folderLoadingPaths(expanded()));
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
  const [treeMounted, setTreeMounted] = createSignal(false);
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
    if (event.key === 'F2' && selectedNode()) {
      event.preventDefault();
      startEdit({ mode: 'rename', node: selectedNode()! });
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedNode()) {
      event.preventDefault();
      setDeleteNode(selectedNode());
      return;
    }
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
  const mutationAvailability = () => fsMutationAvailability(projectId());
  const newFileAvailable = () => workspaceUploadAvailable(projectId());
  const newFileBlockedMessage = () => workspaceUploadBlockedMessage(projectId());
  const selectedNode = () => {
    const path = activePath();
    const visit = (items: FileTreeNode[]): FileTreeNode | null => {
      for (const node of items) {
        if (node.path === path) return node;
        const child = node.children && visit(node.children);
        if (child) return child;
      }
      return null;
    };
    return visit(nodes());
  };
  const handleNodeMount = createExplorerTreeFocus({
    tree: () => tree,
    treeMounted,
    visiblePaths,
    expanded,
    setExpanded,
    projectId,
    setActivePath,
  });
  const editParent = (node: FileTreeNode | null) => node?.kind === 'folder'
    ? node.path
    : node?.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';
  const startEdit = (next: ExplorerEdit) => {
    setInlineError(undefined);
    setEdit(next);
    if (next.mode !== 'rename' && next.parentPath) expandFolder(next.parentPath);
  };
  createEffect(() => {
    const current = edit();
    if (!current || current.mode === 'rename' || !current.parentPath) return;
    if (!expanded().has(current.parentPath)) expandFolder(current.parentPath);
  });
  const cancelInline = () => {
    setEdit(null);
    setInlineError(undefined);
  };
  const handleInlineCommit = (value: string) => {
    const current = edit();
    if (!current) return;
    const issue = validateMutationName(value);
    if (issue) {
      setInlineError(issue);
      return;
    }
    commitEdit(current, value);
    setInlineError(undefined);
  };
  const renderInlineNameEditor = (editor: {
    depth: number;
    kind: 'file' | 'folder';
    path?: string;
    mode: 'create' | 'rename';
    initialValue?: string;
    placeholder?: string;
    ariaLabel: string;
  }): JSX.Element => (
    <FileTreeInlineNameEditor
      depth={editor.depth}
      kind={editor.kind}
      path={editor.path}
      mode={editor.mode}
      initialValue={editor.initialValue}
      placeholder={editor.placeholder}
      invalid={Boolean(inlineError())}
      errorMessage={inlineError()}
      ariaLabel={editor.ariaLabel}
      onCommit={handleInlineCommit}
      onCancel={cancelInline}
    />
  );
  const handleMenuAction = async (action: ExplorerMenuAction, node: FileTreeNode | null) => {
    if (action === 'copy-path' && node) { await navigator.clipboard.writeText(node.path); return; }
    if (action === 'new-file' || action === 'new-folder') startEdit({ mode: action, parentPath: editParent(node) });
    else if (action === 'rename' && node) startEdit({ mode: 'rename', node });
    else if (action === 'move' && node) setMoveNode(node);
    else if (node) setDeleteNode(node);
  };
  const commitEdit = (current: ExplorerEdit, name: string) => {
    const currentProject = projectId();
    if (!currentProject) return;
    if (current.mode === 'new-file') createEmptyExplorerFile(currentProject, current.parentPath, name);
    else if (current.mode === 'new-folder') createResourceDirectory(currentProject, current.parentPath ? `${current.parentPath}/${name}` : name);
    else if (current.mode === 'rename') {
      const parent = current.node.path.includes('/') ? current.node.path.slice(0, current.node.path.lastIndexOf('/')) : '';
      moveResourcePath(currentProject, current.node.path, parent ? `${parent}/${name}` : name, String(current.node.meta?.revision ?? ''));
    }
    setEdit(null);
  };
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
      <span>Files</span>
      <span class="ml-auto flex items-center gap-2">
        <IconButton label="New File" showTooltip={false} size="compact" disabled={!newFileAvailable()} title={newFileAvailable() ? undefined : newFileBlockedMessage()} onClick={() => startEdit({ mode: 'new-file', parentPath: editParent(selectedNode()) })} class="border-0 bg-transparent text-content-muted hover:text-content-primary"><FilePlus size={14} /></IconButton>
        <IconButton label="New Folder" showTooltip={false} size="compact" disabled={!mutationAvailability().available} title={mutationAvailability().reason} onClick={() => startEdit({ mode: 'new-folder', parentPath: editParent(selectedNode()) })} class="border-0 bg-transparent text-content-muted hover:text-content-primary"><FolderPlus size={14} /></IconButton>
        <IconButton label="Refresh Explorer" showTooltip={false} size="compact" onClick={refreshResourceProject} class="border-0 bg-transparent text-content-muted hover:text-content-primary"><RefreshIcon /></IconButton>
      </span>
    </ResourceSectionTitle>
    <Show when={fsMutationState().projectId === projectId() && fsMutationState().message}>
      <InlineNotice class="mx-8 mb-8" tone={fsMutationState().phase === 'conflict' || fsMutationState().phase === 'error' ? 'warning' : 'info'} role="status" title="File change">
        <span>{fsMutationState().message}</span>
        <Show when={fsMutationState().phase === 'conflict'}><Button size="compact" variant="ghost" onClick={refreshResourceProject}>Refresh</Button></Show>
        <Show when={fsMutationState().phase === 'uncertain'}><Button size="compact" variant="ghost" onClick={() => projectId() && retryFsMutation(projectId()!)}>Reconcile</Button></Show>
      </InlineNotice>
    </Show>
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
        setTreeMounted(true);
        const savedScrollTop = props.scrollTop ?? 0;
        queueMicrotask(() => {
          if (!element.isConnected) return;
          element.scrollTop = savedScrollTop;
          restoreFrame = requestAnimationFrame(() => { acceptingScroll = true; });
        });
      }}
      class={cn(
        'overflow-anchor-none ui-scrollbar min-h-0 flex-1 overflow-auto py-2',
        rootDropActive() && fileTreeDropRootClass,
      )}
      role="tree"
      aria-label="Workspace files"
      onKeyDown={navigateTree}
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest('[role="treeitem"]')) return;
        openRootMenu(event);
      }}
      onScroll={(event) => {
        if (!acceptingScroll || !event.currentTarget.isConnected) return;
        props.onScrollTopChange?.(event.currentTarget.scrollTop);
      }}
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
        <Show when={inlineCreateKind(edit(), '')}>
          {(kind) => renderInlineNameEditor({
            depth: 0,
            kind: kind(),
            path: '',
            mode: 'create',
            placeholder: kind() === 'file' ? 'New file name' : 'New folder name',
            ariaLabel: kind() === 'file' ? 'New file name' : 'New folder name',
          })}
        </Show>
        <FileTree
          nodes={nodes()}
          nodesRevision={directoryRevision()}
          expandedPaths={expanded()}
          onToggleFolder={toggleFolder}
          activePath={activePath()}
          onActivePathChange={setActivePath}
          renderFileTrailing={renderRowActions}
          renderFolderTrailing={renderRowActions}
          renderNodeRow={(node, context) => {
            const current = edit();
            if (!current || current.mode !== 'rename' || current.node.path !== node.path) return undefined;
            return renderInlineNameEditor({
              depth: context.depth,
              kind: context.kind,
              path: node.path,
              mode: 'rename',
              initialValue: context.kind === 'file' ? basename(node.path) : node.name,
              ariaLabel: 'Rename item',
            });
          }}
          renderFolderFooter={(node, depth) => {
            const kind = inlineCreateKind(edit(), node.path);
            if (!kind) return undefined;
            return renderInlineNameEditor({
              depth: depth + 1,
              kind,
              path: node.path,
              mode: 'create',
              placeholder: kind === 'file' ? 'New file name' : 'New folder name',
              ariaLabel: kind === 'file' ? 'New file name' : 'New folder name',
            });
          }}
          onNodeContextMenu={(node, event) => {
            setActivePath(node.path);
            openNodeMenu(node, event);
          }}
          onNodeMount={handleNodeMount}
          folderLoadingPaths={loadingPaths()}
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
        <Show when={nextCursor()}>{(cursor) => <Button size="compact" variant="ghost" class="h-(--tree-row-height) w-full justify-start border-0! bg-transparent! text-left text-11 text-accent hover:bg-hover pointer-coarse:h-44" style={{ 'padding-left': '26px' }} onClick={() => openResourceDirectory('', cursor())}>Load more…</Button>}</Show>
      </Show>
    </div>
    <ExplorerItemMenu
      context={menuContext()}
      disabled={!mutationAvailability().available}
      disabledReason={mutationAvailability().reason}
      newFileDisabled={!newFileAvailable()}
      newFileDisabledReason={newFileBlockedMessage()}
      open={menuOpen()}
      onOpenChange={(open) => { if (!open) closeMenu(); }}
      trigger={(
        <span
          ref={(element) => { menuAnchor = element; }}
          class="pointer-events-none fixed z-(--z-overlay) size-1 opacity-0"
          aria-hidden="true"
          style={{ left: '0px', top: '0px' }}
        />
      )}
      onAction={(action) => {
        void handleMenuAction(action, menuNode());
        closeMenu();
      }}
    />
    <ExplorerMoveDialog
      open={moveNode() !== null}
      onOpenChange={(open) => {
        if (!open) {
          setMoveNode(null);
          setMoveConflict(undefined);
        }
      }}
      sourceName={moveNode()?.name ?? ''}
      initialDestination={moveNode() ? parentDirectoryPath(moveNode()!.path) : ''}
      conflictMessage={moveConflict()}
      onConfirm={(target) => {
        const node = moveNode();
        const issue = validateMoveDestination(target);
        if (issue) {
          setMoveConflict(issue);
          return;
        }
        if (node && target === node.path) {
          setMoveConflict('Destination must differ from the source path.');
          return;
        }
        const currentProject = projectId();
        if (node && currentProject) moveResourcePath(currentProject, node.path, target, String(node.meta?.revision ?? ''));
        setMoveNode(null);
        setMoveConflict(undefined);
      }}
    />
    <ExplorerDeleteDialog
      open={deleteNode() !== null}
      onOpenChange={(open) => { if (!open) setDeleteNode(null); }}
      name={deleteNode()?.name ?? ''}
      kind={deleteNode()?.kind === 'folder' ? 'folder' : 'file'}
      recursive={deleteNode()?.kind === 'folder'}
      onConfirm={() => {
        const node = deleteNode();
        const currentProject = projectId();
        if (node && currentProject) deleteResourcePath(currentProject, node.path, String(node.meta?.revision ?? ''), node.kind === 'folder');
        setDeleteNode(null);
      }}
    />
  </section>;
}

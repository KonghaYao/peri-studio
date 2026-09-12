import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import { Button, InlineNotice } from '@/lib/catalog-ui';
import {
  ExplorerDeleteDialog,
  ExplorerItemMenu,
  ExplorerMoveDialog,
  ExplorerMutationsTree,
  ExplorerSectionHeader,
  ExplorerTreeBlankArea,
  FileTreeInlineNameEditor,
  addChildNode,
  cloneExplorerTree,
  explorerJoinPath as joinPath,
  findExplorerNode,
  folderChildCount,
  inlineCreateAtParent,
  parentDirectoryPath,
  removeNodeAtPath,
  renameNodeAtPath,
  resolveNewItemParent,
  siblingBasenames,
  validateExplorerBasename,
  type ExplorerMenuAction,
  type FileTreeNode,
  type InlineEditState,
} from '@peri/ui';
import {
  createExplorerMutationsDemoTree,
  type ExplorerMutationsDemoMode,
} from './explorer-mutations-demo-data';

export function ExplorerMutationsPanel(props: {
  demoMode?: ExplorerMutationsDemoMode;
}) {
  const mode = () => props.demoMode ?? 'idle';

  const [tree, setTree] = createSignal<FileTreeNode[]>(cloneExplorerTree(createExplorerMutationsDemoTree()));
  const [expanded, setExpanded] = createSignal(new Set<string>(['src', 'src/web']));
  const [selectedPath, setSelectedPath] = createSignal<string | undefined>('src/web/Composer.tsx');
  const [inline, setInline] = createSignal<InlineEditState | null>(null);
  const [inlineError, setInlineError] = createSignal<string | undefined>();
  const [pendingPath, setPendingPath] = createSignal<string | null>(null);
  const [headerStatus, setHeaderStatus] = createSignal<string | undefined>();
  const [conflictNotice, setConflictNotice] = createSignal(false);
  const [mutationsDisabled, setMutationsDisabled] = createSignal(false);
  const [disabledReason] = createSignal('File changes are not supported on this workspace.');

  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [deleteTarget, setDeleteTarget] = createSignal<FileTreeNode | null>(null);
  const [deleteBusy, setDeleteBusy] = createSignal(false);

  const [moveOpen, setMoveOpen] = createSignal(false);
  const [moveTarget, setMoveTarget] = createSignal<FileTreeNode | null>(null);
  const [moveBusy, setMoveBusy] = createSignal(false);
  const [moveConflict, setMoveConflict] = createSignal<string | undefined>();

  createEffect(() => {
    applyDemoMode(mode());
  });

  const applyDemoMode = (m: ExplorerMutationsDemoMode) => {
    const demo = cloneExplorerTree(createExplorerMutationsDemoTree());
    setConflictNotice(false);
    setMutationsDisabled(false);
    setPendingPath(null);
    setHeaderStatus(undefined);
    setInline(null);
    setInlineError(undefined);
    setDeleteOpen(false);
    setMoveOpen(false);
    setMoveConflict(undefined);
    setDeleteBusy(false);
    setMoveBusy(false);
    setTree(demo);
    setExpanded(new Set(['src', 'src/web']));
    setSelectedPath('src/web/Composer.tsx');

    switch (m) {
      case 'inline-new-file':
        setInline({ mode: 'create', parentPath: 'src/web', kind: 'file' });
        break;
      case 'inline-rename':
        setInline({ mode: 'rename', path: 'src/web/Composer.tsx' });
        break;
      case 'delete-file':
        setDeleteTarget(findExplorerNode(demo, 'src/web/Composer.tsx'));
        setDeleteOpen(true);
        break;
      case 'delete-folder-recursive':
        setDeleteTarget(findExplorerNode(demo, 'src/web'));
        setDeleteOpen(true);
        break;
      case 'move-dialog':
        setMoveTarget(findExplorerNode(demo, 'src/web/Composer.tsx'));
        setMoveOpen(true);
        break;
      case 'conflict':
        setConflictNotice(true);
        break;
      case 'disabled':
        setMutationsDisabled(true);
        break;
      case 'pending':
        setPendingPath('src/web/Composer.tsx');
        setHeaderStatus('Renaming…');
        break;
      default:
        break;
    }
  };

  const notice = createMemo(() => {
    if (conflictNotice()) {
      return (
        <InlineNotice tone="warning" title="Version conflict">
          Version conflict. Refresh and try again.
          <div class="mt-8">
            <Button size="sm" variant="default" onClick={() => setConflictNotice(false)}>
              Refresh
            </Button>
          </div>
        </InlineNotice>
      );
    }
    if (mutationsDisabled()) {
      return (
        <InlineNotice tone="info" title="File changes unavailable">
          {disabledReason()}
        </InlineNotice>
      );
    }
    return undefined;
  });

  const toggleFolder = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const ensureExpanded = (path: string) => {
    if (!path) return;
    setExpanded((prev) => new Set(prev).add(path));
  };

  const startCreate = (kind: 'file' | 'folder', anchor: FileTreeNode | null) => {
    if (mutationsDisabled() || pendingPath()) return;
    const parent = anchor
      ? anchor.kind === 'folder'
        ? anchor.path
        : parentDirectoryPath(anchor.path)
      : resolveNewItemParent(selectedPath(), tree());
    ensureExpanded(parent);
    setInlineError(undefined);
    setInline({ mode: 'create', parentPath: parent, kind });
  };

  const startRename = (node: FileTreeNode) => {
    if (mutationsDisabled() || pendingPath()) return;
    setInlineError(undefined);
    setInline({ mode: 'rename', path: node.path });
    setSelectedPath(node.path);
  };

  const handleMenuAction = (action: ExplorerMenuAction, node: FileTreeNode | null) => {
    if (action === 'copy-path') {
      if (node) void navigator.clipboard?.writeText(node.path);
      return;
    }
    if (mutationsDisabled()) return;
    switch (action) {
      case 'new-file':
        startCreate('file', node);
        break;
      case 'new-folder':
        startCreate('folder', node);
        break;
      case 'rename':
        if (node) startRename(node);
        break;
      case 'move':
        if (node) {
          setMoveTarget(node);
          setMoveConflict(undefined);
          setMoveOpen(true);
        }
        break;
      case 'delete':
        if (node) {
          setDeleteTarget(node);
          setDeleteOpen(true);
        }
        break;
      default:
        break;
    }
  };

  const commitInline = (raw: string) => {
    const state = inline();
    if (!state) return;
    const nodes = tree();
    if (state.mode === 'create') {
      const siblings = siblingBasenames(nodes, state.parentPath);
      const check = validateExplorerBasename(raw, siblings);
      if (!check.ok) {
        setInlineError(check.message);
        return;
      }
      const name = raw.trim();
      const path = joinPath(state.parentPath, name);
      const child: FileTreeNode = {
        id: path,
        path,
        name,
        kind: state.kind,
        children: state.kind === 'folder' ? [] : undefined,
      };
      setTree(addChildNode(nodes, state.parentPath, child));
      setInline(null);
      setInlineError(undefined);
      setSelectedPath(path);
      if (state.kind === 'file') setHeaderStatus('Opening new file…');
      return;
    }
    const node = findExplorerNode(nodes, state.path);
    if (!node) {
      setInline(null);
      return;
    }
    const parent = parentDirectoryPath(state.path);
    const siblings = siblingBasenames(nodes, parent, state.path);
    const check = validateExplorerBasename(raw, siblings);
    if (!check.ok) {
      setInlineError(check.message);
      return;
    }
    const name = raw.trim();
    setPendingPath(state.path);
    setHeaderStatus('Renaming…');
    setInline(null);
    window.setTimeout(() => {
      setTree((t) => renameNodeAtPath(t, state.path, name));
      setPendingPath(null);
      setHeaderStatus(undefined);
      setSelectedPath(joinPath(parent, name));
    }, 600);
  };

  const cancelInline = () => {
    setInline(null);
    setInlineError(undefined);
  };

  const confirmDelete = () => {
    const target = deleteTarget();
    if (!target) return;
    setDeleteBusy(true);
    window.setTimeout(() => {
      setTree((t) => removeNodeAtPath(t, target.path));
      setDeleteBusy(false);
      setDeleteOpen(false);
      setDeleteTarget(null);
      setSelectedPath(parentDirectoryPath(target.path) || undefined);
    }, 500);
  };

  const confirmMove = (dest: string) => {
    const target = moveTarget();
    if (!target) return;
    if (dest === target.path) {
      setMoveConflict('Destination must differ from the source path.');
      return;
    }
    if (findExplorerNode(tree(), dest)) {
      setMoveConflict('An item already exists at that path.');
      return;
    }
    setMoveBusy(true);
    window.setTimeout(() => {
      setTree((t) => {
        const removed = removeNodeAtPath(t, target.path);
        const moved: FileTreeNode = { ...target, path: dest, id: dest, name: dest.split('/').pop() ?? target.name };
        return addChildNode(removed, parentDirectoryPath(dest), moved);
      });
      setMoveBusy(false);
      setMoveOpen(false);
      setMoveTarget(null);
      setSelectedPath(dest);
    }, 500);
  };

  const onTreeKeyDown = (ev: KeyboardEvent) => {
    if (inline()) return;
    const items = Array.from((ev.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const target = (ev.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    const index = target ? items.indexOf(target) : -1;
    const focus = (item: HTMLElement | undefined) => {
      if (!item) return;
      const path = item.dataset.path;
      if (path) setSelectedPath(path);
      item.focus();
      ev.preventDefault();
    };
    if (ev.key === 'ArrowDown') { focus(items[index + 1]); return; }
    if (ev.key === 'ArrowUp') { focus(items[index - 1]); return; }
    if (ev.key === 'Home') { focus(items[0]); return; }
    if (ev.key === 'End') { focus(items.at(-1)); return; }
    if (mutationsDisabled() || pendingPath()) return;
    const path = selectedPath();
    if (!path) return;
    const node = findExplorerNode(tree(), path);
    if (!node) return;
    if (ev.key === 'F2') {
      ev.preventDefault();
      startRename(node);
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      setDeleteTarget(node);
      setDeleteOpen(true);
    } else if (ev.key === 'Escape') {
      cancelInline();
    }
  };

  const deleteRecursive = () => {
    const t = deleteTarget();
    if (!t || t.kind !== 'folder') return false;
    return folderChildCount(tree(), t.path) > 0;
  };

  return (
    <div class="flex max-w-sm flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-base">
      <ExplorerSectionHeader
        mutationsDisabled={mutationsDisabled()}
        disabledReason={disabledReason()}
        pendingLabel={headerStatus()}
        notice={notice()}
        onNewFile={() => startCreate('file', null)}
        onNewFolder={() => startCreate('folder', null)}
        onRefresh={() => setHeaderStatus('Refreshing…')}
      />
      <ExplorerTreeBlankArea
        onContextMenu={(event) => {
          const target = (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>('[aria-label="Workspace root actions"]');
          target?.click();
        }}
      >
        <ExplorerItemMenu
          context="root"
          mutationsDisabled={mutationsDisabled()}
          menuLabel="Workspace root actions"
          trigger={<button type="button" class="sr-only" aria-label="Workspace root actions">Workspace root actions</button>}
          onAction={(action) => handleMenuAction(action, null)}
        />
        <div
          role="tree"
          tabindex={-1}
          aria-label="Explorer files"
          aria-disabled={mutationsDisabled()}
          class="px-4 pb-8 outline-none focus-visible:shadow-(--shadow-focus-ring)"
          onKeyDown={onTreeKeyDown}
        >
          <ExplorerMutationsTree
            nodes={tree()}
            expandedPaths={expanded()}
            selectedPath={selectedPath()}
            mutationsDisabled={mutationsDisabled()}
            pendingPath={pendingPath()}
            inline={inline()}
            inlineError={inlineError()}
            onToggleFolder={toggleFolder}
            onSelect={(node) => setSelectedPath(node.path)}
            onRowContextMenu={(node, event) => {
              setSelectedPath(node.path);
              const row = event.currentTarget as HTMLElement;
              queueMicrotask(() => row.querySelector<HTMLButtonElement>('[aria-label="More actions"]')?.click());
            }}
            onMenuAction={handleMenuAction}
            onInlineCommit={commitInline}
            onInlineCancel={cancelInline}
          />
          <Show when={inlineCreateAtParent(inline(), '')}>
            {(createState) => (
              <FileTreeInlineNameEditor
                depth={0}
                kind={createState().kind}
                path=""
                mode="create"
                placeholder={createState().kind === 'file' ? 'New file name' : 'New folder name'}
                invalid={Boolean(inlineError())}
                errorMessage={inlineError()}
                ariaLabel={
                  createState().kind === 'file'
                    ? 'New file name in workspace root'
                    : 'New folder name in workspace root'
                }
                onCommit={commitInline}
                onCancel={cancelInline}
              />
            )}
          </Show>
        </div>
      </ExplorerTreeBlankArea>

      <ExplorerDeleteDialog
        open={deleteOpen()}
        onOpenChange={setDeleteOpen}
        name={deleteTarget()?.name ?? ''}
        kind={deleteTarget()?.kind === 'folder' ? 'folder' : 'file'}
        recursive={deleteRecursive()}
        affectedCount={deleteTarget()?.kind === 'folder' ? folderChildCount(tree(), deleteTarget()!.path) : undefined}
        busy={deleteBusy()}
        onConfirm={confirmDelete}
      />

      <ExplorerMoveDialog
        open={moveOpen()}
        onOpenChange={setMoveOpen}
        sourceName={moveTarget()?.name ?? ''}
        initialDestination={moveTarget() ? parentDirectoryPath(moveTarget()!.path) : ''}
        busy={moveBusy()}
        conflictMessage={moveConflict()}
        onConfirm={confirmMove}
      />
    </div>
  );
}

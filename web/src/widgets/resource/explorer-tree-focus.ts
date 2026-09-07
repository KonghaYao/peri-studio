import { createEffect, onCleanup, type Accessor } from 'solid-js';
import {
  explorerCreatedFileFocus,
  fsMutationState,
  openResourceDirectory,
  resourceWorkspace,
} from '@/store';
import type { FileTreeNode } from './FileTree';

type ExplorerTreeFocusOptions = {
  tree: () => HTMLDivElement | undefined;
  treeMounted: Accessor<boolean>;
  visiblePaths: Accessor<string[]>;
  expanded: Accessor<Set<string>>;
  setExpanded: (update: (current: Set<string>) => Set<string>) => void;
  projectId: Accessor<string | null>;
  setActivePath: (path: string) => void;
};

type FocusRequest = { token: string; path: string };

function requestedFocus(projectId: string | null, restoredToken: string | null): FocusRequest | null {
  const state = fsMutationState();
  const createdFile = explorerCreatedFileFocus();
  const upload = createdFile ? { token: `upload:${createdFile.id}`, path: createdFile.path } : null;
  const structural = state.projectId === projectId
    && state.phase === 'idle'
    && state.focusPath !== undefined
    && state.commandId
    ? { token: `mutation:${state.commandId}`, path: state.focusPath }
    : null;
  if (upload && upload.token !== restoredToken) return upload;
  return structural && structural.token !== restoredToken ? structural : null;
}

function parentPaths(path: string): string[] {
  return path.split('/').slice(0, -1)
    .map((_, index, parts) => parts.slice(0, index + 1).join('/'));
}

export function createExplorerTreeFocus(options: ExplorerTreeFocusOptions) {
  let restoredToken: string | null = null;
  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  const revealLoads = new Set<string>();

  const focus = (request: FocusRequest, target: HTMLElement | undefined) => {
    if (!target?.isConnected || request.token === restoredToken) return;
    target.focus();
    if (document.activeElement !== target) return;
    restoredToken = request.token;
    options.setActivePath(target.dataset.path ?? '');
  };

  createEffect(() => {
    const paths = options.visiblePaths();
    options.treeMounted();
    const request = requestedFocus(options.projectId(), restoredToken);
    const tree = options.tree();
    if (!request || !tree) return;
    const collapsedParent = parentPaths(request.path)
      .find((path) => !options.expanded().has(path));
    if (collapsedParent) {
      options.setExpanded((current) => new Set([...current, collapsedParent]));
      if (!resourceWorkspace().directories[collapsedParent] && !revealLoads.has(collapsedParent)) {
        revealLoads.add(collapsedParent);
        openResourceDirectory(collapsedParent);
      }
      return;
    }
    if (request.path && !paths.includes(request.path)) return;
    if (focusTimer !== undefined) clearTimeout(focusTimer);
    focusTimer = setTimeout(() => {
      focusTimer = undefined;
      const items = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'));
      focus(request, request.path
        ? items.find((item) => item.dataset.path === request.path)
        : items[0]);
    });
  });

  onCleanup(() => { if (focusTimer !== undefined) clearTimeout(focusTimer); });

  return (node: FileTreeNode, element: HTMLElement) => {
    queueMicrotask(() => {
      const request = requestedFocus(options.projectId(), restoredToken);
      if (!request) return;
      const firstItem = options.tree()?.querySelector<HTMLElement>('[role="treeitem"]');
      if (request.path === node.path || (request.path === '' && firstItem === element)) {
        focus(request, element);
      }
    });
  };
}

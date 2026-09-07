import { For, Show, type JSX } from 'solid-js';
import { File, Folder, FolderOpen } from 'lucide-solid';
import { cn } from '@/lib/cn';
import type { FileTreeNode } from './FileTree';
import { FileTreeInlineNameEditor } from './FileTreeInlineNameEditor';
import { ExplorerItemMenu, type ExplorerMenuAction } from './ExplorerItemMenu';
import { basename } from './explorer-mutations-tree-utils';

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
  depth?: number;
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
  const depth = () => props.depth ?? 0;

  return (
    <For each={props.nodes}>
      {(node) => (
        <Show
          when={node.kind === 'folder'}
          fallback={
            <ExplorerFileRow
              node={node}
              depth={depth()}
              selected={props.selectedPath === node.path}
              pending={props.pendingPath === node.path}
              mutationsDisabled={props.mutationsDisabled}
              renaming={props.inline?.mode === 'rename' && props.inline.path === node.path}
              inlineError={props.inline?.mode === 'rename' && props.inline.path === node.path ? props.inlineError : undefined}
              onSelect={() => props.onSelect(node)}
              onContextMenu={(ev) => props.onRowContextMenu?.(node, ev)}
              onMenuAction={(action) => props.onMenuAction(action, node)}
              onInlineCommit={props.onInlineCommit}
              onInlineCancel={props.onInlineCancel}
            />
          }
        >
          <ExplorerFolderRow
            node={node}
            depth={depth()}
            open={props.expandedPaths.has(node.path)}
            selected={props.selectedPath === node.path}
            pending={props.pendingPath === node.path}
            mutationsDisabled={props.mutationsDisabled}
            renaming={props.inline?.mode === 'rename' && props.inline.path === node.path}
            inlineError={props.inline?.mode === 'rename' && props.inline.path === node.path ? props.inlineError : undefined}
            onToggle={() => props.onToggleFolder(node.path)}
            onSelect={() => props.onSelect(node)}
            onContextMenu={(ev) => props.onRowContextMenu?.(node, ev)}
            onMenuAction={(action) => props.onMenuAction(action, node)}
            onInlineCommit={props.onInlineCommit}
            onInlineCancel={props.onInlineCancel}
          />
          <Show when={props.expandedPaths.has(node.path)}>
            <div role="group">
              <ExplorerMutationsTree
                nodes={node.children ?? []}
                depth={depth() + 1}
                expandedPaths={props.expandedPaths}
                selectedPath={props.selectedPath}
                mutationsDisabled={props.mutationsDisabled}
                pendingPath={props.pendingPath}
                inline={props.inline}
                inlineError={props.inlineError}
                onToggleFolder={props.onToggleFolder}
                onSelect={props.onSelect}
                onRowContextMenu={props.onRowContextMenu}
                onMenuAction={props.onMenuAction}
                onInlineCommit={props.onInlineCommit}
                onInlineCancel={props.onInlineCancel}
              />
              <Show when={inlineCreateAtParent(props.inline, node.path)}>
                {(createState) => (
                  <FileTreeInlineNameEditor
                    depth={depth() + 1}
                    kind={createState().kind}
                    mode="create"
                    placeholder={createState().kind === 'file' ? 'New file name' : 'New folder name'}
                    invalid={Boolean(props.inlineError)}
                    errorMessage={props.inlineError}
                    ariaLabel={
                      createState().kind === 'file'
                        ? `New file name in ${node.path}`
                        : `New folder name in ${node.path}`
                    }
                    onCommit={props.onInlineCommit}
                    onCancel={props.onInlineCancel}
                  />
                )}
              </Show>
            </div>
          </Show>
        </Show>
      )}
    </For>
  );
}

function ExplorerFolderRow(props: {
  node: FileTreeNode;
  depth: number;
  open: boolean;
  selected?: boolean;
  pending?: boolean;
  mutationsDisabled?: boolean;
  renaming?: boolean;
  inlineError?: string;
  onToggle: () => void;
  onSelect: () => void;
  onContextMenu: (ev: MouseEvent) => void;
  onMenuAction: (action: ExplorerMenuAction) => void;
  onInlineCommit: (value: string) => void;
  onInlineCancel: () => void;
}) {
  const rowPadding = () => `calc(6px + ${props.depth} * 12px)`;

  return (
    <Show
      when={props.renaming}
      fallback={
        <div
          role="treeitem"
          aria-expanded={props.open}
          aria-level={props.depth + 1}
          aria-selected={props.selected}
          aria-busy={props.pending || undefined}
          data-path={props.node.path}
          tabindex={props.selected ? 0 : -1}
          class={cn(
            'group/tree-row flex w-full items-center gap-0.5 rounded-md pr-1',
            props.selected ? 'bg-sidebar-selected' : 'hover:bg-interaction-hover',
            props.mutationsDisabled && 'opacity-60',
          )}
          style={{ 'min-height': 'var(--resource-tree-row)', 'padding-left': rowPadding() }}
          onFocus={props.onSelect}
          onContextMenu={(ev) => {
            ev.preventDefault();
            props.onContextMenu(ev);
          }}
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-1.5 border-0 bg-transparent py-0 text-left"
            onClick={() => {
              props.onSelect();
              props.onToggle();
            }}
          >
            {props.open
              ? <FolderOpen size={14} class="shrink-0 text-content-muted" />
              : <Folder size={14} class="shrink-0 text-content-muted" />}
            <span class="min-w-0 flex-1 truncate text-12 font-medium text-content-primary">
              {props.pending ? `${props.node.name} — Deleting…` : props.node.name}
            </span>
          </button>
          <ExplorerItemMenu context="folder" mutationsDisabled={props.mutationsDisabled} onAction={props.onMenuAction} />
        </div>
      }
    >
      <FileTreeInlineNameEditor
        depth={props.depth}
        kind="folder"
        mode="rename"
        initialValue={props.node.name}
        invalid={Boolean(props.inlineError)}
        errorMessage={props.inlineError}
        ariaLabel={`Rename ${props.node.name}`}
        onCommit={props.onInlineCommit}
        onCancel={props.onInlineCancel}
      />
    </Show>
  );
}

function ExplorerFileRow(props: {
  node: FileTreeNode;
  depth: number;
  selected?: boolean;
  pending?: boolean;
  mutationsDisabled?: boolean;
  renaming?: boolean;
  inlineError?: string;
  onSelect: () => void;
  onContextMenu: (ev: MouseEvent) => void;
  onMenuAction: (action: ExplorerMenuAction) => void;
  onInlineCommit: (value: string) => void;
  onInlineCancel: () => void;
}) {
  const rowPadding = () => `calc(6px + ${props.depth} * 12px)`;

  return (
    <Show
      when={props.renaming}
      fallback={
        <div
          role="treeitem"
          aria-level={props.depth + 1}
          aria-selected={props.selected}
          aria-busy={props.pending || undefined}
          data-path={props.node.path}
          tabindex={props.selected ? 0 : -1}
          class={cn(
            'group/tree-row flex w-full items-center gap-0.5 rounded-md pr-1',
            props.selected ? 'bg-sidebar-selected' : 'hover:bg-interaction-hover',
            props.mutationsDisabled && 'opacity-60',
          )}
          style={{ 'min-height': 'var(--resource-tree-row)', 'padding-left': rowPadding() }}
          onFocus={props.onSelect}
          onContextMenu={(ev) => {
            ev.preventDefault();
            props.onContextMenu(ev);
          }}
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-1.5 border-0 bg-transparent py-0 text-left text-12 text-content-primary"
            onClick={props.onSelect}
          >
            <File size={14} class="shrink-0 text-content-muted" />
            <span class="min-w-0 flex-1 truncate">
              {props.pending ? `${props.node.name} — Renaming…` : props.node.name}
            </span>
          </button>
          <ExplorerItemMenu context="file" mutationsDisabled={props.mutationsDisabled} onAction={props.onMenuAction} />
        </div>
      }
    >
      <FileTreeInlineNameEditor
        depth={props.depth}
        kind="file"
        mode="rename"
        initialValue={basename(props.node.path)}
        invalid={Boolean(props.inlineError)}
        errorMessage={props.inlineError}
        ariaLabel={`Rename ${props.node.name}`}
        onCommit={props.onInlineCommit}
        onCancel={props.onInlineCancel}
      />
    </Show>
  );
}

/** 根空白区右键占位（workspace 根菜单语义）。 */
export function ExplorerTreeBlankArea(props: { children: JSX.Element; onContextMenu: (ev: MouseEvent) => void }) {
  return (
    <div
      class="min-h-16 flex-1"
      onContextMenu={(ev) => {
        ev.preventDefault();
        props.onContextMenu(ev);
      }}
    >
      {props.children}
    </div>
  );
}

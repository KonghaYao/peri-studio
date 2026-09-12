import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { RefreshCw } from 'lucide-solid';
import { cn } from '../../lib/cn';
import {
  GIT_GRAPH_COLORS,
  GIT_GRAPH_HEADER_HEIGHT,
  GIT_GRAPH_ROW_HEIGHT,
  layoutGitGraph,
  type GitGraphLayoutCommit,
} from '../../lib/git-graph-engine';
import { IconButton } from '../Button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../context-menu';
import {
  gitGraphAuthorColClass,
  gitGraphCommitColClass,
  gitGraphContentClass,
  gitGraphControlBtnClass,
  gitGraphControlsClass,
  gitGraphDateColClass,
  gitGraphDescriptionClass,
  gitGraphHeadDotClass,
  gitGraphMessageClass,
  gitGraphMessageCurrentClass,
  gitGraphPanelClass,
  gitGraphRowClass,
  gitGraphRowHoverClass,
  gitGraphRowSelectedClass,
  gitGraphScrollClass,
  gitGraphSvgClass,
  gitGraphTableClass,
  gitGraphTdClass,
  gitGraphTdDescColClass,
  gitGraphTdGraphColClass,
  gitGraphThClass,
  gitGraphThGraphColClass,
} from '../git-graph/git-graph-layout';
import { GitGraphBranchDialog, GitGraphConfirmDialog } from './GitGraphActionDialog';
import { GitGraphRefBadge } from './GitGraphRefBadge';
import type { GitGraphActionKind, GitGraphActionParams, GitGraphCommit } from './types';

export type GitGraphPanelProps = {
  commits: GitGraphCommit[];
  /** 外层已有标题栏时隐藏面板内重复的 Git Graph 顶栏。 */
  nested?: boolean;
  onRefresh?: () => void;
  onGraphAction?: (action: GitGraphActionKind, params: GitGraphActionParams) => boolean | void;
};

type TableMetrics = {
  headerHeight: number;
  rowHeight: number;
  rowCenters: number[];
  tableHeight: number;
};

type BranchDialogState = {
  mode: 'create' | 'rename';
  commit: GitGraphCommit;
  refName?: string;
};

function hasIncompleteDag(commits: GitGraphCommit[]): boolean {
  return commits.some((commit) => commit.parentsComplete === false || commit.refsComplete === false);
}

function toLayoutCommits(commits: GitGraphCommit[]): GitGraphLayoutCommit[] {
  return commits.map((commit) => ({
    hash: commit.hash ?? commit.id,
    parents: commit.parents ?? [],
    stash: null,
  }));
}

function headHash(commits: GitGraphCommit[]) {
  const head = commits.find((commit) => commit.isHead);
  return head?.hash ?? head?.id ?? commits[0]?.hash ?? commits[0]?.id ?? null;
}

function commitOid(commit: GitGraphCommit) {
  return commit.hash ?? commit.id;
}

function displayMessage(commit: GitGraphCommit) {
  const message = commit.message?.trim();
  if (message) return message;
  return '(no message)';
}

/** VS Code Git Graph 插件风格：HTML table + 绝对定位 SVG 叠加层。 */
export function GitGraphPanel(props: GitGraphPanelProps) {
  const [hovered, setHovered] = createSignal<number | null>(null);
  const [selected, setSelected] = createSignal(0);
  const [branchDialog, setBranchDialog] = createSignal<BranchDialogState | null>(null);
  const [resetConfirm, setResetConfirm] = createSignal<{ commit: GitGraphCommit; mode: 'soft' | 'mixed' | 'hard' } | null>(null);
  const [metrics, setMetrics] = createSignal<TableMetrics>({
    headerHeight: GIT_GRAPH_HEADER_HEIGHT,
    rowHeight: GIT_GRAPH_ROW_HEIGHT,
    rowCenters: [],
    tableHeight: 0,
  });

  let tableRef: HTMLTableElement | undefined;

  const measureTable = () => {
    const table = tableRef;
    if (!table) return;

    const tableBox = table.getBoundingClientRect();
    const thead = table.tHead;
    const tbody = table.tBodies[0];
    if (!thead || !tbody) return;

    const headerHeight = thead.getBoundingClientRect().height;
    const rows = tbody.querySelectorAll('tr');
    const rowCenters: number[] = [];
    let rowHeight = GIT_GRAPH_ROW_HEIGHT;

    if (rows.length > 0) {
      rowHeight = rows[0].getBoundingClientRect().height;
      rows.forEach((row) => {
        const rect = row.getBoundingClientRect();
        rowCenters.push(rect.top - tableBox.top + rect.height / 2);
      });
    }

    setMetrics({
      headerHeight,
      rowHeight,
      rowCenters,
      tableHeight: tableBox.height,
    });
  };

  createEffect(() => {
    props.commits.length;
    queueMicrotask(measureTable);
  });

  createEffect(() => {
    const table = tableRef;
    if (!table) return;

    measureTable();
    const observer = new ResizeObserver(() => measureTable());
    observer.observe(table);
    onCleanup(() => observer.disconnect());
  });

  const layout = createMemo(() => layoutGitGraph(
    toLayoutCommits(props.commits),
    headHash(props.commits),
    {
      colors: GIT_GRAPH_COLORS,
      bgColor: 'var(--surface-overlay)',
      headerHeight: metrics().headerHeight,
      rowHeight: metrics().rowHeight,
    },
  ));

  const graphColWidth = () => Math.max(layout().contentWidth, 64);
  const svgHeight = () => Math.max(layout().height, metrics().tableHeight);

  const nodeCy = (index: number) => {
    const centers = metrics().rowCenters;
    if (centers[index] !== undefined) return centers[index];
    const node = layout().nodes.find((entry) => entry.index === index);
    return node?.cy ?? 0;
  };

  const incompleteDag = createMemo(() => hasIncompleteDag(props.commits));

  const dispatch = (action: GitGraphActionKind, params: GitGraphActionParams) => {
    props.onGraphAction?.(action, params);
  };

  return (
    <div
      class={cn(
        gitGraphPanelClass,
        props.nested ? 'min-w-0 flex-1' : 'h-full',
      )}
      aria-label="Git Graph"
    >
      <Show when={!props.nested}>
        <div class={gitGraphControlsClass}>
          <span class="min-w-0 flex-1 text-11 font-semibold tracking-wide uppercase text-content-muted">Git Graph</span>
          <IconButton
            size="compact"
            label="Refresh graph"
            class={gitGraphControlBtnClass}
            onClick={() => props.onRefresh?.()}
          >
            <RefreshCw size={14} strokeWidth={1.7} />
          </IconButton>
        </div>
      </Show>

      <Show when={incompleteDag()}>
        <div role="status" class="border-b border-border-subtle bg-surface-muted px-10 py-6 text-11 text-content-muted">
          Some commit relationships are truncated. Load more history or refresh for a fuller graph.
        </div>
      </Show>

      <div class={gitGraphContentClass}>
        <div class={gitGraphScrollClass} style={{ height: `${svgHeight()}px` }}>
          <svg
            data-testid="git-graph-svg"
            class={gitGraphSvgClass}
            width={graphColWidth()}
            height={svgHeight()}
            aria-hidden="true"
          >
            <For each={layout().paths}>
              {(segment) => (
                <>
                  <path
                    class="fill-none"
                    d={segment.d}
                    stroke={segment.shadowColor}
                    stroke-width={4}
                    stroke-opacity={0.75}
                  />
                  <path class="fill-none" d={segment.d} stroke={segment.color} stroke-width={2} />
                </>
              )}
            </For>
            <For each={layout().nodes}>
              {(node) => (
                <circle
                  class="pointer-events-auto"
                  cx={node.cx}
                  cy={nodeCy(node.index)}
                  r={node.isStash ? 4.5 : 4}
                  fill={node.isCurrent ? 'var(--surface-overlay)' : node.color}
                  stroke={node.color}
                  stroke-width={node.isCurrent ? 2 : 1}
                  stroke-opacity={node.isCurrent ? 1 : 0.75}
                  onMouseEnter={() => setHovered(node.index)}
                  onMouseLeave={() => setHovered(null)}
                />
              )}
            </For>
          </svg>

          <table
            ref={tableRef}
            data-testid="git-graph-table"
            class={gitGraphTableClass}
            style={{ 'table-layout': 'fixed' }}
          >
            <colgroup>
              <col style={{ width: `${graphColWidth()}px` }} />
              <col />
              <col style={{ width: 'var(--git-graph-date-col-width)' }} />
              <col style={{ width: 'var(--git-graph-author-col-width)' }} />
              <col style={{ width: 'var(--git-graph-commit-col-width)' }} />
            </colgroup>
            <thead>
              <tr>
                <th class={cn(gitGraphThClass, gitGraphThGraphColClass)}>Graph</th>
                <th class={gitGraphThClass}>Description</th>
                <th class={cn(gitGraphThClass, gitGraphDateColClass)}>Date</th>
                <th class={cn(gitGraphThClass, gitGraphAuthorColClass)}>Author</th>
                <th class={cn(gitGraphThClass, gitGraphCommitColClass)}>Commit</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.commits}>
                {(commit, index) => {
                  const colorIndex = () => layout().vertexColors[index()] ?? 0;
                  const isCurrent = () => commit.isHead;
                  const rowState = () => {
                    if (selected() === index()) return 'selected';
                    if (hovered() === index()) return 'hover';
                    return '';
                  };

                  return (
                    <ContextMenu>
                      <ContextMenuTrigger
                        as="tr"
                        class={cn(
                          gitGraphRowClass,
                          rowState() === 'hover' && gitGraphRowHoverClass,
                          rowState() === 'selected' && gitGraphRowSelectedClass,
                        )}
                        data-color={colorIndex()}
                        onMouseEnter={() => setHovered(index())}
                        onMouseLeave={() => setHovered(null)}
                        onClick={() => setSelected(index())}
                      >
                        <td class={cn(gitGraphTdClass, gitGraphTdGraphColClass)} />
                        <td class={cn(gitGraphTdClass, gitGraphTdDescColClass)}>
                          <span class={gitGraphDescriptionClass}>
                            <Show when={isCurrent()}>
                              <span
                                class={gitGraphHeadDotClass}
                                style={{ 'border-color': `var(--git-graph-color-${colorIndex() % 12})` }}
                                aria-hidden="true"
                              />
                            </Show>
                            <Show when={commit.refs?.length}>
                              <For each={commit.refs!}>
                                {(ref) => (
                                  <ContextMenu>
                                    <ContextMenuTrigger
                                      as="span"
                                      onContextMenu={(event: MouseEvent) => event.stopPropagation()}
                                    >
                                      <GitGraphRefBadge
                                        gitRef={ref}
                                        active={ref.tone === 'branch'}
                                      />
                                    </ContextMenuTrigger>
                                    <ContextMenuContent
                                      data-git-graph-menu
                                      aria-label="Branch actions"
                                    >
                                      <ContextMenuItem onSelect={() => dispatch('checkout', { refName: ref.label })}>
                                        Checkout branch
                                      </ContextMenuItem>
                                      <ContextMenuItem onSelect={() => setBranchDialog({ mode: 'rename', commit, refName: ref.label })}>
                                        Rename branch…
                                      </ContextMenuItem>
                                    </ContextMenuContent>
                                  </ContextMenu>
                                )}
                              </For>
                            </Show>
                            <span class={cn(gitGraphMessageClass, isCurrent() && gitGraphMessageCurrentClass)}>
                              {displayMessage(commit)}
                            </span>
                          </span>
                        </td>
                        <td class={cn(gitGraphTdClass, gitGraphDateColClass, 'text-content-muted')}>
                          {commit.time || commit.date}
                        </td>
                        <td class={cn(gitGraphTdClass, gitGraphAuthorColClass, 'text-content-muted')}>
                          {commit.author}
                        </td>
                        <td class={cn(gitGraphTdClass, gitGraphCommitColClass, 'font-mono text-content-muted')}>
                          {commit.shortHash ?? commit.hash?.slice(0, 8) ?? commit.id.slice(0, 8)}
                        </td>
                      </ContextMenuTrigger>
                      <ContextMenuContent
                        data-git-graph-menu
                        aria-label="Commit actions"
                      >
                        <ContextMenuItem onSelect={() => dispatch('checkout', { targetOid: commitOid(commit) })}>
                          Checkout commit
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => setBranchDialog({ mode: 'create', commit })}>
                          Create branch…
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => setResetConfirm({ commit, mode: 'soft' })}>
                          Reset current branch (soft)
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => setResetConfirm({ commit, mode: 'mixed' })}>
                          Reset current branch (mixed)
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => setResetConfirm({ commit, mode: 'hard' })}>
                          Reset current branch (hard)
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => dispatch('revert', { targetOid: commitOid(commit) })}>
                          Revert commit
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
      </div>

      <Show when={branchDialog()}>
        {(dialog) => (
          <GitGraphBranchDialog
            open
            mode={dialog().mode}
            initialName={dialog().mode === 'rename' ? dialog().refName : ''}
            title={dialog().mode === 'create' ? 'Create branch at commit' : 'Rename branch'}
            onClose={() => setBranchDialog(null)}
            onSubmit={(name) => {
              if (dialog().mode === 'create') {
                dispatch('create-branch', { refName: name, targetOid: commitOid(dialog().commit) });
                return;
              }
              if (dialog().refName) {
                dispatch('rename-branch', { refName: dialog().refName, newRefName: name });
              }
            }}
          />
        )}
      </Show>

      <GitGraphConfirmDialog
        open={!!resetConfirm()}
        title="Reset current branch?"
        description={resetConfirm()?.mode === 'hard'
          ? 'Hard reset will discard uncommitted changes in your working tree.'
          : 'This moves the current branch pointer to the selected commit.'}
        confirmLabel={resetConfirm() ? `Reset (${resetConfirm()!.mode})` : 'Reset'}
        onClose={() => setResetConfirm(null)}
        onConfirm={() => {
          const pending = resetConfirm();
          if (!pending) return;
          dispatch('reset', { targetOid: commitOid(pending.commit), resetMode: pending.mode });
        }}
      />
    </div>
  );
}

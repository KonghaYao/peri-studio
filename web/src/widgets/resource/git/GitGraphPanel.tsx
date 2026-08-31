import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { RefreshCw, Search, Settings2, Terminal } from 'lucide-solid';
import { IconButton } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';
import {
  GIT_GRAPH_COLORS,
  GIT_GRAPH_HEADER_HEIGHT,
  GIT_GRAPH_ROW_HEIGHT,
  layoutGitGraph,
  type GitGraphLayoutCommit,
} from './git-graph-engine';
import { GitGraphRefBadge } from './GitGraphRefBadge';
import type { GitGraphCommit } from './types';
import { gitLogHasIncompleteDag } from '@/features/resource/map-git-log';

type TableMetrics = {
  headerHeight: number;
  rowHeight: number;
  rowCenters: number[];
  tableHeight: number;
};

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

/** VS Code Git Graph 插件风格：HTML table + 绝对定位 SVG 叠加层。 */
export function GitGraphPanel(props: {
  commits: GitGraphCommit[];
  onRefresh?: () => void;
}) {
  const [hovered, setHovered] = createSignal<number | null>(null);
  const [selected, setSelected] = createSignal(0);
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

  const incompleteDag = createMemo(() => gitLogHasIncompleteDag(props.commits));

  return (
    <div class="git-graph-panel flex h-full min-h-0 flex-col bg-surface-overlay" aria-label="Git Graph">
      <div class="git-graph-controls flex h-32 shrink-0 items-center border-b border-border-subtle px-10">
        <span class="text-13 text-content-primary">Git Graph</span>
        <div class="ml-auto flex items-center">
          <IconButton size="compact" label="Find" class="git-graph-control-btn">
            <Search size={16} strokeWidth={1.8} />
          </IconButton>
          <IconButton size="compact" label="Terminal" class="git-graph-control-btn">
            <Terminal size={16} strokeWidth={1.8} />
          </IconButton>
          <IconButton size="compact" label="Settings" class="git-graph-control-btn">
            <Settings2 size={16} strokeWidth={1.8} />
          </IconButton>
          <IconButton size="compact" label="Refresh" class="git-graph-control-btn" onClick={() => props.onRefresh?.()}>
            <RefreshCw size={16} strokeWidth={1.8} />
          </IconButton>
        </div>
      </div>

      <Show when={incompleteDag()}>
        <div role="status" class="border-b border-border-subtle bg-surface-muted px-10 py-6 text-11 text-content-muted">
          Some commit relationships are truncated. Load more history or refresh for a fuller graph.
        </div>
      </Show>

      <div class="git-graph-content ui-scrollbar min-h-0 flex-1 overflow-auto">
        <div class="git-graph-scroll relative" style={{ height: `${svgHeight()}px` }}>
          <svg
            data-testid="git-graph-svg"
            class="git-graph-svg pointer-events-none absolute top-0 left-0 z-2"
            width={graphColWidth()}
            height={svgHeight()}
            aria-hidden="true"
          >
            <For each={layout().paths}>
              {(segment) => (
                <>
                  <path class="git-graph-path-shadow" d={segment.d} stroke={segment.shadowColor} />
                  <path class="git-graph-path-line" d={segment.d} stroke={segment.color} />
                </>
              )}
            </For>
            <For each={layout().nodes}>
              {(node) => (
                <circle
                  class={cn('pointer-events-auto', node.isCurrent && 'git-graph-node-current')}
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
            class="git-graph-table w-full border-collapse"
            style={{ 'table-layout': 'fixed' }}
          >
            <colgroup>
              <col style={{ width: `${graphColWidth()}px` }} />
              <col />
              <col style={{ width: '124px' }} />
              <col style={{ width: '124px' }} />
              <col style={{ width: '80px' }} />
            </colgroup>
            <thead>
              <tr>
                <th class="git-graph-th git-graph-graph-col">Graph</th>
                <th class="git-graph-th">Description</th>
                <th class="git-graph-th git-graph-date-col">Date</th>
                <th class="git-graph-th git-graph-author-col">Author</th>
                <th class="git-graph-th git-graph-commit-col">Commit</th>
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
                    <tr
                      class={cn(
                        'git-graph-row',
                        rowState(),
                        isCurrent() && 'current',
                      )}
                      data-color={colorIndex()}
                      onMouseEnter={() => setHovered(index())}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => setSelected(index())}
                    >
                      <td class="git-graph-td git-graph-graph-col" />
                      <td class="git-graph-td git-graph-desc-col">
                        <span class="git-graph-description">
                          <Show when={isCurrent()}>
                            <span
                              class="git-graph-head-dot"
                              style={{ 'border-color': `var(--git-graph-color-${colorIndex() % 12})` }}
                              aria-hidden="true"
                            />
                          </Show>
                          <Show when={commit.refs?.length}>
                            <For each={commit.refs!}>
                              {(ref) => (
                                <GitGraphRefBadge
                                  gitRef={ref}
                                  active={ref.tone === 'branch'}
                                />
                              )}
                            </For>
                          </Show>
                          <span class="git-graph-message">{commit.message}</span>
                        </span>
                      </td>
                      <td class="git-graph-td git-graph-date-col text-content-muted">{commit.date ?? commit.time}</td>
                      <td class="git-graph-td git-graph-author-col text-content-muted">{commit.author}</td>
                      <td class="git-graph-td git-graph-commit-col font-mono text-content-muted">
                        {commit.shortHash ?? commit.hash?.slice(0, 8) ?? commit.id.slice(0, 8)}
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

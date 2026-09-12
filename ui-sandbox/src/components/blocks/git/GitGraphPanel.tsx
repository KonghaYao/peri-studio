import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { RefreshCw, Search, Settings2, Terminal } from 'lucide-solid';
import {
  IconButton,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@peri/ui';
import {
  GIT_GRAPH_COLORS,
  GIT_GRAPH_HEADER_HEIGHT,
  GIT_GRAPH_ROW_HEIGHT,
  layoutGitGraph,
  type GitGraphLayoutCommit,
} from '@peri/ui';
import { GitGraphRefBadge } from './GitGraphRefBadge';
import type { GitGraphCommit } from './types';

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

/** Git Graph：Table 原语 + 绝对定位 SVG 叠加；hover / 选中交互不变。 */
export function GitGraphPanel(props: { commits: GitGraphCommit[] }) {
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

  return (
    <div class="flex h-full min-h-0 flex-col bg-surface-overlay" aria-label="Git Graph">
      <div class="flex h-36 shrink-0 items-center gap-8 border-b border-border-subtle px-12">
        <span class="min-w-0 flex-1 truncate text-11 font-semibold uppercase tracking-wide text-content-muted">
          Git Graph
        </span>
        <div class="flex shrink-0 items-center gap-2">
          <IconButton size="sm" label="Find">
            <Search size={14} strokeWidth={1.8} />
          </IconButton>
          <IconButton size="sm" label="Terminal">
            <Terminal size={14} strokeWidth={1.8} />
          </IconButton>
          <IconButton size="sm" label="Settings">
            <Settings2 size={14} strokeWidth={1.8} />
          </IconButton>
          <IconButton size="sm" label="Refresh">
            <RefreshCw size={14} strokeWidth={1.8} />
          </IconButton>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-auto">
        <div class="relative min-w-full" style={{ height: `${svgHeight()}px` }}>
          <svg
            class="git-graph-svg pointer-events-none absolute top-0 left-0"
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
            class="git-graph-table w-full table-fixed caption-bottom border-collapse text-left text-12"
          >
            <colgroup>
              <col style={{ width: `${graphColWidth()}px` }} />
              <col />
              <col style={{ width: '124px' }} />
              <col style={{ width: '124px' }} />
              <col style={{ width: '80px' }} />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>Graph</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Author</TableHead>
                <TableHead>Commit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <For each={props.commits}>
                {(commit, index) => {
                  const colorIndex = () => layout().vertexColors[index()] ?? 0;
                  const isCurrent = () => commit.isHead;
                  const isSelected = () => selected() === index();
                  const isHovered = () => hovered() === index();

                  return (
                    <TableRow
                      class={cn('cursor-default', !isSelected() && isHovered() && 'bg-interaction-hover')}
                      aria-selected={isSelected()}
                      data-color={colorIndex()}
                      onMouseEnter={() => setHovered(index())}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => setSelected(index())}
                    >
                      <TableCell class="p-0" />
                      <TableCell class="min-w-0 overflow-hidden">
                        <span class="flex min-w-0 items-center gap-4 overflow-hidden">
                          <Show when={isCurrent()}>
                            <span
                              class="inline-block size-6 shrink-0 rounded-full border-2"
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
                          <span class={cn('min-w-0 truncate text-content-primary', isCurrent() && 'font-semibold')}>
                            {commit.message}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell class="truncate text-content-muted">{commit.date ?? commit.time}</TableCell>
                      <TableCell class="truncate text-content-muted">{commit.author}</TableCell>
                      <TableCell class="truncate font-mono text-content-muted">
                        {commit.hash ?? commit.id.slice(0, 8)}
                      </TableCell>
                    </TableRow>
                  );
                }}
              </For>
            </TableBody>
          </table>
        </div>
      </div>
    </div>
  );
}

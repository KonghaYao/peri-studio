import { Show, createEffect, createMemo, createSignal, untrack } from 'solid-js';
import { IconButton } from '@/shared/ui';
import { RefreshCw, X } from 'lucide-solid';
import { RESOURCE_PANEL_HEADER_CLASS, RESOURCE_PANEL_TITLE_CLASS } from '../resource-panel-layout';
import {
  canLoadMoreGitLog,
  gitLogCommits,
  gitLogHeadOid,
  gitLogLoading,
  mutateGitGraphResource,
  openGitLog,
  openMoreGitLog,
  refreshGitLog,
  resourceWorkspace,
} from '@/store';
import { GitGraphPanel } from './GitGraphPanel';
import { mapGitLogToGraphCommits } from '@/features/resource/map-git-log';
import type { GitGraphActionKind, GitGraphActionParams } from '@/features/resource/git-graph-mutations';

type GitGraphViewProps = {
  /** 嵌在 workbench 窄面板内（移动端 / compact）。 */
  embedded?: boolean;
  onClose?: () => void;
};

/** Git Graph 大面板：桌面占满 conversation pane，compact 时嵌在 workbench。 */
export function GitGraphView(props: GitGraphViewProps = {}) {
  const [graphRepoId, setGraphRepoId] = createSignal<string | null>(null);

  const graphRepositories = createMemo(() => resourceWorkspace().repositories);
  const activeGraphRepoId = createMemo(() => {
    const repos = graphRepositories();
    if (repos.length === 0) return null;
    const selected = graphRepoId();
    if (selected && repos.some((repo) => repo.id === selected)) return selected;
    return repos[0].id;
  });
  const graphCommits = createMemo(() => {
    const repoId = activeGraphRepoId();
    if (!repoId) return [];
    return mapGitLogToGraphCommits(gitLogCommits(repoId), gitLogHeadOid(repoId));
  });

  createEffect(() => {
    const repoId = activeGraphRepoId();
    if (!repoId) return;
    const workspace = resourceWorkspace();
    const repo = workspace.repositories.find((item) => item.id === repoId);
    if (!repo?.generation || gitLogLoading(repoId) || repo.log) return;
    if (workspace.loading.includes(`repository:${repoId}`)) return;
    untrack(() => openGitLog(repoId));
  });

  const runGraphAction = (
    action: GitGraphActionKind,
    params: GitGraphActionParams,
  ) => {
    const repoId = activeGraphRepoId();
    if (!repoId) return false;
    return mutateGitGraphResource(repoId, action, params);
  };

  return (
    <div
      data-testid="git-graph-view"
      class={`flex min-h-0 flex-col bg-surface-overlay ${props.embedded ? 'min-h-0 flex-1' : 'h-full w-full'}`}
      aria-label="Git Graph workspace"
    >
      <Show when={!props.embedded && props.onClose}>
        <header class={RESOURCE_PANEL_HEADER_CLASS}>
          <strong class={RESOURCE_PANEL_TITLE_CLASS}>Git Graph</strong>
          <IconButton
            label="Refresh graph"
            size="compact"
            disabled={!activeGraphRepoId() || gitLogLoading(activeGraphRepoId()!)}
            onClick={() => {
              const repoId = activeGraphRepoId();
              if (repoId) refreshGitLog(repoId);
            }}
            class="border-0 bg-transparent text-content-muted hover:text-content-primary"
          >
            <RefreshCw size={14} strokeWidth={1.7} />
          </IconButton>
          <IconButton
            label="Close Git Graph"
            size="compact"
            onClick={() => props.onClose?.()}
            class="border-0 bg-transparent text-content-muted hover:text-content-primary"
          >
            <X size={14} strokeWidth={1.7} />
          </IconButton>
        </header>
      </Show>

      <Show when={resourceWorkspace().error}>
        {(message) => (
          <div role="alert" class="m-8 flex items-start gap-6 rounded-6 border border-danger-border bg-danger-soft p-9 text-11 leading-16 text-danger">
            <span class="min-w-0 flex-1">{message()}</span>
            <button
              type="button"
              class="shrink-0 border-0 bg-transparent px-3 font-650 text-danger underline pointer-coarse:min-h-44 pointer-coarse:px-8"
              onClick={() => {
                const repoId = activeGraphRepoId();
                if (repoId) refreshGitLog(repoId);
              }}
            >
              Retry
            </button>
          </div>
        )}
      </Show>

      <Show when={graphRepositories().length > 1}>
        <div class="flex items-center gap-6 border-b border-border-subtle px-10 py-8">
          <span class="text-11 text-content-muted">Repository</span>
          <div class="flex min-w-0 flex-wrap gap-4">
            {graphRepositories().map((repo) => (
              <button
                type="button"
                class={`rounded-4 px-8 py-4 text-11 ${activeGraphRepoId() === repo.id ? 'bg-selected text-content-primary' : 'text-content-muted hover:bg-interaction-hover'}`}
                onClick={() => {
                  setGraphRepoId(repo.id);
                  if (!repo.log && repo.generation) openGitLog(repo.id);
                }}
              >
                {repo.name}
              </button>
            ))}
          </div>
        </div>
      </Show>

      <Show when={activeGraphRepoId()} fallback={<div class="p-16 text-12 text-content-muted">No Git repositories in this workspace.</div>}>
        {(repoId) => (
          <>
            <GitGraphPanel
              nested={props.embedded || !!props.onClose}
              commits={graphCommits()}
              onRefresh={() => refreshGitLog(repoId())}
              onGraphAction={(action, params) => runGraphAction(action, params)}
            />
            <Show when={canLoadMoreGitLog(repoId())}>
              <div class="border-t border-border-subtle px-10 py-8">
                <button
                  type="button"
                  class="text-11 text-accent hover:underline pointer-coarse:min-h-44"
                  disabled={gitLogLoading(repoId())}
                  onClick={() => openMoreGitLog(repoId())}
                >
                  Load more commits
                </button>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

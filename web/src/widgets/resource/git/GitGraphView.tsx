import { Button, GitGraphPanel, InlineNotice } from '@peri/ui';
import { Show, createEffect, createMemo, createSignal, untrack } from 'solid-js';
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
import { mapGitLogToGraphCommits } from '@/features/resource/map-git-log';
import type { GitGraphActionKind, GitGraphActionParams } from '@/features/resource/git-graph-mutations';

type GitGraphViewProps = {
  /** 嵌在 workbench 面板内；标题与关闭由 workbench 头部负责。 */
  embedded?: boolean;
};

/** Git Graph 内容区，由 ResourceWorkbench 浮动面板承载。 */
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
      class={`flex min-h-0 flex-col bg-neutral-25 ${props.embedded ? 'min-h-0 flex-1' : 'h-full w-full'}`}
      aria-label="Git Graph workspace"
    >
      <Show when={resourceWorkspace().error}>
        {(message) => (
          <InlineNotice tone="danger" class="m-8 items-center gap-6 py-9 text-11 leading-16" role="alert">
            <div class="flex min-w-0 flex-1 items-center gap-6">
              <span class="min-w-0 flex-1">{message()}</span>
              <Button
                size="compact"
                variant="ghost"
                class="shrink-0 border-0! bg-transparent! px-3 font-650 text-danger underline pointer-coarse:min-h-44 pointer-coarse:px-8"
                onClick={() => {
                  const repoId = activeGraphRepoId();
                  if (repoId) refreshGitLog(repoId);
                }}
              >
                Retry
              </Button>
            </div>
          </InlineNotice>
        )}
      </Show>

      <Show when={graphRepositories().length > 1}>
        <div class="flex items-center gap-6 border-b border-border-subtle px-10 py-8">
          <span class="text-11 text-content-muted">Repository</span>
          <div class="flex min-w-0 flex-wrap gap-4">
            {graphRepositories().map((repo) => (
              <Button
                size="compact"
                variant="ghost"
                class={`rounded-4 border-0! px-8 py-4 text-11 ${activeGraphRepoId() === repo.id ? 'bg-selected text-content-primary' : 'text-content-muted hover:bg-interaction-hover'}`}
                onClick={() => {
                  setGraphRepoId(repo.id);
                  if (!repo.log && repo.generation) openGitLog(repo.id);
                }}
              >
                {repo.name}
              </Button>
            ))}
          </div>
        </div>
      </Show>

      <Show when={activeGraphRepoId()} fallback={<div class="p-16 text-12 text-content-muted">No Git repositories in this workspace.</div>}>
        {(repoId) => (
          <div class="flex min-h-0 min-w-0 flex-1 flex-col">
            <GitGraphPanel
              nested={props.embedded ?? true}
              commits={graphCommits()}
              onRefresh={() => refreshGitLog(repoId())}
              onGraphAction={(action, params) => runGraphAction(action, params)}
            />
            <Show when={canLoadMoreGitLog(repoId())}>
              <div class="border-t border-border-subtle px-10 py-8">
                <Button
                  size="compact"
                  variant="ghost"
                  class="border-0! bg-transparent! text-11 text-accent hover:underline pointer-coarse:min-h-44"
                  disabled={gitLogLoading(repoId())}
                  onClick={() => openMoreGitLog(repoId())}
                >
                  Load more commits
                </Button>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

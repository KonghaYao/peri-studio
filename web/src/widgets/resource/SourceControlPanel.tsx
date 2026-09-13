import { For, Show, createSignal } from 'solid-js';
import { Button, GitBranchBar, GitChangeGroup, GitCommitBar, InlineNotice, LoadingState } from '@peri/ui';
import { mutateGitResource, openFilePreview, openMoreGitChanges, resourceWorkspace, retryGitRepositoryMutation, retryGitResourceMutation } from '@/store';
import type { RepositoryState } from '@/features/resource/resource-store';
import { readOnly } from '@/features/auth/auth-state';
import { ConfirmDialog } from '@/widgets/shell/shared/ConfirmDialog';
import { MAX_COMMIT_MESSAGE_BYTES } from '@/features/resource/resource-mutations';
import { GitChangeTree } from './git';
import { ResourceSectionTitle } from '@peri/ui';
import type { GitChange, GitChangeGroupId } from './git/types';

const GROUPS: Array<{ id: GitChangeGroupId; label: string }> = [
  { id: 'conflicts', label: 'Merge Changes' },
  { id: 'index', label: 'Staged Changes' },
  { id: 'working_tree', label: 'Changes' },
  { id: 'untracked', label: 'Untracked Changes' },
];

type SourceControlPanelProps = {
  /** 嵌在 workbench 浮动面板内；标题与关闭由 WorkbenchPanelChrome 负责。 */
  embedded?: boolean;
  commitMessages?: Record<string, string>;
  onCommitMessageChange?: (repoId: string, message: string) => void;
  onCommitSubmitted?: (repoId: string, requestId: string, message: string) => void;
  onPreviewIntent?: (key: string) => void;
};

export function SourceControlPanel(props: SourceControlPanelProps = {}) {
  return <section class="flex min-h-0 flex-1 flex-col" aria-label="Source Control">
    <Show when={!props.embedded}>
      <ResourceSectionTitle>Source Control</ResourceSectionTitle>
    </Show>
    <div class="ui-scrollbar min-h-0 flex-1 overflow-auto pb-12">
      <Show when={!resourceWorkspace().loading.includes('repositories')} fallback={<LoadingState label="Reading repositories" class="m-8 p-8! text-left!" />}>
        <Show when={resourceWorkspace().repositories.length} fallback={<div class="px-14 py-18 text-12 leading-18 text-content-muted">No Git repository was found in this workspace.</div>}>
          <For each={resourceWorkspace().repositories}>{(repo) => <Repository repo={repo} commitMessage={props.commitMessages?.[repo.id]} onCommitMessageChange={props.onCommitMessageChange} onCommitSubmitted={props.onCommitSubmitted} onPreviewIntent={props.onPreviewIntent} />}</For>
        </Show>
      </Show>
    </div>
  </section>;
}

function Repository(props: { repo: RepositoryState; commitMessage?: string; onCommitMessageChange?: (repoId: string, message: string) => void; onCommitSubmitted?: (repoId: string, requestId: string, message: string) => void; onPreviewIntent?: (key: string) => void }) {
  const [localMessage, setLocalMessage] = createSignal('');
  const message = () => props.commitMessage ?? localMessage();
  const setMessage = (value: string) => {
    setLocalMessage(value);
    props.onCommitMessageChange?.(props.repo.id, value);
  };
  const [discard, setDiscard] = createSignal<GitChange | null>(null);
  const branch = () => props.repo.detached ? 'detached HEAD' : props.repo.headName || 'No commits yet';
  const repoMutation = () => resourceWorkspace().repoMutations?.[props.repo.id];
  const repoBusy = () => !!repoMutation()?.pending || Object.values(resourceWorkspace().mutations ?? {}).some((mutation) => mutation.repoId === props.repo.id && mutation.pending);
  const staged = () => props.repo.groups.index?.count ?? 0;
  const syncBusyAction = () => {
    const action = repoMutation()?.action;
    return action === 'pull' || action === 'push' || action === 'sync' ? action : undefined;
  };
  const commit = () => {
    const submitted = message().trim();
    if (!mutateGitResource(props.repo.id, 'commit', [], submitted)) return;
    const mutation = repoMutation();
    if (mutation?.action === 'commit' && mutation.pending) props.onCommitSubmitted?.(props.repo.id, mutation.requestId, submitted);
  };
  const runRepoAction = (action: 'pull' | 'push' | 'sync') => mutateGitResource(props.repo.id, action);
  const retryRepoMutation = () => {
    const failed = repoMutation();
    if (!failed || !retryGitRepositoryMutation(props.repo.id)) return;
    const retried = repoMutation();
    if (retried?.action === 'commit' && retried.pending) props.onCommitSubmitted?.(props.repo.id, retried.requestId, failed.message ?? message().trim());
  };
  const previewChange = (change: GitChange) => {
    const path = change.path;
    if (!path) return;
    props.onPreviewIntent?.(`file:${path}`);
    openFilePreview(path);
  };
  const toggleStage = (groupId: GitChangeGroupId, change: GitChange) => {
    const action = groupId === 'index' ? 'unstage' : 'stage';
    mutateGitResource(props.repo.id, action, [change.id]);
  };

  return <><section class="border-b border-border-subtle pb-6">
    <GitBranchBar
      repoName={props.repo.name}
      branch={branch()}
      root={props.repo.root}
      ahead={props.repo.ahead}
      behind={props.repo.behind}
      hasUpstream={!!props.repo.upstream}
      readOnly={readOnly() || !props.repo.generation}
      busy={repoBusy()}
      busyAction={repoMutation()?.pending ? syncBusyAction() : undefined}
      onPull={() => runRepoAction('pull')}
      onSync={() => runRepoAction('sync')}
      onPush={() => runRepoAction('push')}
      pullTitle={props.repo.upstream ? `Pull ${props.repo.upstream}` : 'Configure an upstream branch first'}
      syncTitle={props.repo.upstream ? `Pull then push ${props.repo.upstream}` : 'Configure an upstream branch first'}
      pushTitle={props.repo.upstream ? `Push ${props.repo.upstream}` : 'Configure an upstream branch first'}
    />
    <GitCommitBar
      class="px-8 pb-7"
      value={message()}
      onValueChange={setMessage}
      onCommit={commit}
      stagedCount={staged()}
      rows={2}
      maxBytes={MAX_COMMIT_MESSAGE_BYTES}
      commitShortcut="mod+enter"
      readOnly={readOnly()}
      busy={repoBusy()}
      commitBusy={repoMutation()?.action === 'commit' && repoMutation()?.pending}
      commitDisabled={!props.repo.generation}
    />
    <Show when={repoMutation()?.error}>{(error) => <InlineNotice tone="danger" class="mx-8 mb-7 min-h-28 items-center gap-6 px-8 py-5 text-10 leading-14" role="alert">
      <div class="flex min-w-0 flex-1 items-center gap-6">
        <span class="min-w-0 flex-1">{error()}</span>
        <Show when={repoMutation()?.retryable}><Button size="compact" variant="ghost" class="shrink-0 border-0! bg-transparent! px-3 font-650 text-danger underline pointer-coarse:min-h-44 pointer-coarse:px-8" onClick={retryRepoMutation}>Retry</Button></Show>
      </div>
    </InlineNotice>}</Show>
    <For each={GROUPS}>{(group) => {
      const state = () => props.repo.groups[group.id];
      return <Show when={state()?.count}>
        <GitChangeGroup label={group.label} count={state().count}>
          <GitChangeTree
            repoId={props.repo.id}
            changes={state().changes as GitChange[]}
            groupId={group.id}
            readOnly={readOnly()}
            repoBusy={repoBusy()}
            onFileSelect={(change) => previewChange(change)}
            onStageToggle={(change) => toggleStage(group.id, change)}
            onDiscard={(change) => setDiscard(change)}
          />
        </GitChangeGroup>
        <Show when={state().nextCursor}>{(cursor) => <Button size="compact" variant="ghost" class="h-(--tree-row-height) w-full justify-start border-0! bg-transparent! pl-28 text-left text-11 text-accent hover:bg-hover pointer-coarse:h-44" onClick={() => openMoreGitChanges(props.repo.id, group.id, cursor())}>Load more…</Button>}</Show>
        <For each={state().changes}>{(change) => {
          const mutation = () => resourceWorkspace().mutations?.[change.id];
          const action = () => group.id === 'index' ? 'unstage' : 'stage';
          return <Show when={mutation()?.error}>{(message) => <InlineNotice tone="danger" class="min-h-28 items-center gap-6 rounded-none border-x-0 px-12 py-4 text-10 leading-14" role="alert">
            <div class="flex min-w-0 flex-1 items-center gap-6">
              <span class="min-w-0 flex-1">{message()}</span>
              <Show when={mutation()?.retryable}><Button size="compact" variant="ghost" class="shrink-0 border-0! bg-transparent! px-4 font-650 text-danger underline pointer-coarse:min-h-44 pointer-coarse:px-8" aria-label={`Retry ${action()} ${String(change.path ?? '')}`} onClick={() => retryGitResourceMutation(change.id)}>Retry</Button></Show>
            </div>
          </InlineNotice>}</Show>;
        }}</For>
      </Show>;
    }}</For>
  </section>
  <ConfirmDialog
    open={!!discard()}
    onOpenChange={(open) => { if (!open && !repoBusy()) setDiscard(null); }}
    eyebrow="Source Control"
    title="Discard changes?"
    description={<>This permanently replaces <strong>{discard()?.path}</strong> with its last tracked version, or deletes it if untracked.</>}
    warning="This action cannot be undone from Peri Studio."
    confirmLabel="Discard changes"
    confirmDisabled={repoBusy()}
    confirmBusy={repoMutation()?.action === 'discard' && repoMutation()?.pending}
    onCancel={() => setDiscard(null)}
    onConfirm={() => { const candidate = discard(); if (candidate && mutateGitResource(props.repo.id, 'discard', [candidate.id])) setDiscard(null); }}
  /></>;
}

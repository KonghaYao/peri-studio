import { For, Show, createMemo, createSignal } from 'solid-js';
import { Button, Dialog, DialogContent, DialogTitle, LoadingState, Textarea } from '../../components/ui';
import { mutateGitResource, openGitDiffPreview, openMoreGitChanges, resourceWorkspace, retryGitRepositoryMutation, retryGitResourceMutation } from '../../panel/store';
import type { RepositoryState } from '../../panel/lib/resource-store';
import { readOnly } from '../../panel/lib/auth-state';
import { ConfirmDialog } from '@/widgets/shell/shared/ConfirmDialog';
import { MAX_COMMIT_MESSAGE_BYTES } from '../../panel/lib/resource-mutations';
import { GitBranch } from 'lucide-solid';
import { GitChangeGroup, GitChangeTree } from './git';
import type { GitChange, GitChangeGroupId } from './git/types';

const GROUPS: Array<{ id: GitChangeGroupId; label: string }> = [
  { id: 'conflicts', label: 'Merge Changes' },
  { id: 'index', label: 'Staged Changes' },
  { id: 'working_tree', label: 'Changes' },
  { id: 'untracked', label: 'Untracked Changes' },
];

type SourceControlPanelProps = {
  commitMessages?: Record<string, string>;
  onCommitMessageChange?: (repoId: string, message: string) => void;
  onCommitSubmitted?: (repoId: string, requestId: string, message: string) => void;
  onPreviewIntent?: (key: string) => void;
};

export function SourceControlPanel(props: SourceControlPanelProps = {}) {
  return <section class="flex min-h-0 flex-1 flex-col" aria-label="Source Control">
    <div class="resource-section-title flex h-28 items-center border-b border-divider px-8 text-10 font-650 uppercase tracking-6 text-text-secondary pointer-coarse:h-44">Source Control</div>
    <div class="ui-scrollbar min-h-0 flex-1 overflow-auto pb-12">
      <Show when={!resourceWorkspace().loading.includes('repositories')} fallback={<LoadingState label="Reading repositories" class="m-8 p-8! text-left!" />}>
        <Show when={resourceWorkspace().repositories.length} fallback={<div class="px-14 py-18 text-12 leading-18 text-text-muted">No Git repository was found in this workspace.</div>}>
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
  const messageTooLarge = createMemo(() => new TextEncoder().encode(message().trim()).byteLength > MAX_COMMIT_MESSAGE_BYTES);
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
  const previewChange = (groupId: GitChangeGroupId, change: GitChange) => {
    props.onPreviewIntent?.(`diff:${props.repo.id}:${groupId}:${change.id}`);
    openGitDiffPreview(props.repo.id, groupId, change);
  };
  const toggleStage = (groupId: GitChangeGroupId, change: GitChange) => {
    const action = groupId === 'index' ? 'unstage' : 'stage';
    mutateGitResource(props.repo.id, action, [change.id]);
  };

  return <><section class="border-b border-divider pb-6">
    <div class="flex h-32 items-center gap-6 px-8 text-12 font-550 text-text-primary" title={props.repo.root}>
      <GitBranch size={14} strokeWidth={1.8} /><span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{props.repo.name}</span>
      <span class="max-w-100 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-10 font-normal text-text-muted">{branch()}</span>
    </div>
    <Show when={(props.repo.ahead ?? 0) + (props.repo.behind ?? 0) > 0}>
      <div class="px-28 pb-4 text-10 text-text-muted">↑ {props.repo.ahead ?? 0} ↓ {props.repo.behind ?? 0}</div>
    </Show>
    <div class="px-8 pb-7">
      <Textarea
        aria-label="Commit message"
        placeholder="Message (Ctrl+Enter to commit)"
        maxlength={4096}
        rows={2}
        value={message()}
        disabled={readOnly() || repoBusy()}
        onInput={(event) => setMessage(event.currentTarget.value)}
        onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && staged() > 0 && message().trim() && !messageTooLarge()) { event.preventDefault(); commit(); } }}
        class="box-border min-h-52 w-full resize-y rounded-5 border border-divider bg-surface px-8 py-6 text-11 leading-16 text-text-primary outline-none focus-visible:border-focus-ring"
      />
      <Show when={messageTooLarge()}><div role="alert" class="mt-4 text-10 leading-14 text-danger">Commit message must be at most {MAX_COMMIT_MESSAGE_BYTES.toLocaleString()} UTF-8 bytes.</div></Show>
      <Button size="compact" variant="primary" class="mt-5 w-full min-h-28! text-11! pointer-coarse:min-h-44!" aria-label="Commit staged changes" busy={repoMutation()?.action === 'commit' && repoMutation()?.pending} disabled={readOnly() || repoBusy() || !props.repo.generation || staged() === 0 || !message().trim() || messageTooLarge()} onClick={commit}>Commit</Button>
      <div class="mt-5 grid grid-cols-3 gap-4">
        <Button size="compact" class="min-h-28! px-4! text-10! pointer-coarse:min-h-44!" aria-label="Pull from upstream" busy={repoMutation()?.action === 'pull' && repoMutation()?.pending} disabled={readOnly() || repoBusy() || !props.repo.generation || !props.repo.upstream} title={props.repo.upstream ? `Pull ${props.repo.upstream}` : 'Configure an upstream branch first'} onClick={() => runRepoAction('pull')}>Pull</Button>
        <Button size="compact" class="min-h-28! px-4! text-10! pointer-coarse:min-h-44!" aria-label="Synchronize changes" busy={repoMutation()?.action === 'sync' && repoMutation()?.pending} disabled={readOnly() || repoBusy() || !props.repo.generation || !props.repo.upstream} title={props.repo.upstream ? `Pull then push ${props.repo.upstream}` : 'Configure an upstream branch first'} onClick={() => runRepoAction('sync')}>Sync</Button>
        <Button size="compact" class="min-h-28! px-4! text-10! pointer-coarse:min-h-44!" aria-label="Push to upstream" busy={repoMutation()?.action === 'push' && repoMutation()?.pending} disabled={readOnly() || repoBusy() || !props.repo.generation || !props.repo.upstream} title={props.repo.upstream ? `Push ${props.repo.upstream}` : 'Configure an upstream branch first'} onClick={() => runRepoAction('push')}>Push</Button>
      </div>
      <Show when={repoMutation()?.error}>{(error) => <div role="alert" class="mt-5 flex min-h-28 items-center gap-6 border border-danger-border bg-danger-soft px-8 py-5 text-10 leading-14 text-danger">
        <span class="min-w-0 flex-1">{error()}</span>
        <Show when={repoMutation()?.retryable}><button type="button" class="shrink-0 border-0 bg-transparent px-3 font-650 text-danger underline pointer-coarse:min-h-44 pointer-coarse:px-8" onClick={retryRepoMutation}>Retry</button></Show>
      </div>}</Show>
    </div>
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
            onFileSelect={(change) => previewChange(group.id, change)}
            onStageToggle={(change) => toggleStage(group.id, change)}
            onDiscard={(change) => setDiscard(change)}
          />
        </GitChangeGroup>
        <Show when={state().nextCursor}>{(cursor) => <button type="button" class="h-(--tree-row-height) w-full border-0 bg-transparent pl-28 text-left text-11 text-accent hover:bg-hover pointer-coarse:h-44" onClick={() => openMoreGitChanges(props.repo.id, group.id, cursor())}>Load more…</button>}</Show>
        <For each={state().changes}>{(change) => {
          const mutation = () => resourceWorkspace().mutations?.[change.id];
          const action = () => group.id === 'index' ? 'unstage' : 'stage';
          return <Show when={mutation()?.error}>{(message) => <div role="alert" class="flex min-h-28 items-center gap-6 border-y border-danger-border bg-danger-soft px-12 py-4 text-10 leading-14 text-danger">
            <span class="min-w-0 flex-1">{message()}</span>
            <Show when={mutation()?.retryable}><button type="button" class="shrink-0 border-0 bg-transparent px-4 font-650 text-danger underline pointer-coarse:min-h-44 pointer-coarse:px-8" aria-label={`Retry ${action()} ${String(change.path ?? '')}`} onClick={() => retryGitResourceMutation(change.id)}>Retry</button></Show>
          </div>}</Show>;
        }}</For>
      </Show>;
    }}</For>
  </section>
  <Dialog open={!!discard()} onOpenChange={(open) => { if (!open && !repoBusy()) setDiscard(null); }}><DialogContent dismissible={!repoBusy()}><DialogTitle class="sr-only">Discard changes</DialogTitle>
    <ConfirmDialog
      eyebrow="Source Control"
      title="Discard changes?"
      description={<>This permanently replaces <strong>{discard()?.path}</strong> with its last tracked version, or deletes it if untracked.</>}
      warning="This action cannot be undone from Peri Studio."
      confirmLabel="Discard changes"
      confirmDisabled={repoBusy()}
      confirmBusy={repoMutation()?.action === 'discard' && repoMutation()?.pending}
      onCancel={() => setDiscard(null)}
      onConfirm={() => { const candidate = discard(); if (candidate && mutateGitResource(props.repo.id, 'discard', [candidate.id])) setDiscard(null); }}
    />
  </DialogContent></Dialog></>;
}

import { For, Show, createMemo, createSignal } from 'solid-js';
import { Button, Dialog, DialogContent, DialogTitle, IconButton, LoadingState, Textarea } from '../../components/ui';
import { mutateGitResource, openGitDiffPreview, openMoreGitChanges, resourceWorkspace, retryGitRepositoryMutation, retryGitResourceMutation } from '../store';
import type { RepositoryState } from '../lib/resource-store';
import { readOnly } from '../lib/auth-state';
import { ConfirmDialog } from './shared/ConfirmDialog';
import { MAX_COMMIT_MESSAGE_BYTES } from '../lib/resource-mutations';
import { ChevronDown, File, GitBranch, Minus, Plus, Trash2 } from 'lucide-solid';

const GROUPS = [
  { id: 'conflicts', label: 'Merge Changes' },
  { id: 'index', label: 'Staged Changes' },
  { id: 'working_tree', label: 'Changes' },
  { id: 'untracked', label: 'Untracked Changes' },
] as const;

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
  const [discard, setDiscard] = createSignal<{ id: string; path: string } | null>(null);
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
        <div class="resource-group-title flex h-24 items-center gap-4 px-7 text-10 font-650 uppercase tracking-4 text-text-secondary pointer-coarse:h-44"><ChevronDown size={13} strokeWidth={1.8} /><span>{group.label}</span><span class="ml-auto tabular-nums text-text-muted">{state().count}</span></div>
        <For each={state().changes}>{(change) => {
          const mutation = () => resourceWorkspace().mutations?.[change.id];
          const action = () => group.id === 'index' ? 'unstage' : 'stage';
          const path = () => String(change.path ?? '');
          return <div>
          <div class="resource-change-row group flex h-(--tree-row-height) items-center pr-5 text-11 hover:bg-hover pointer-coarse:h-44">
          <button
            type="button"
            class="flex h-full min-w-0 flex-1 items-center gap-5 border-0 bg-transparent pl-13 text-left text-inherit"
            aria-label={`Open changes for ${path()}`}
            title={`Open changes for ${path()}`}
            data-resource-focus-key={`diff:${props.repo.id}:${group.id}:${change.id}`}
            data-resource-focus-view="scm"
            onClick={() => {
              props.onPreviewIntent?.(`diff:${props.repo.id}:${group.id}:${change.id}`);
              openGitDiffPreview(props.repo.id, group.id, change);
            }}
          >
            <span class="grid size-14 place-items-center text-text-muted"><File size={14} strokeWidth={1.7} /></span>
            <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{basename(path())}</span>
            <span class="max-w-90 overflow-hidden text-ellipsis whitespace-nowrap text-10 text-text-muted">{dirname(path())}</span>
            <span class={`w-14 text-center font-mono text-11 font-650 ${statusColor(String(change.status ?? ''))}`}>{statusLetter(String(change.status ?? ''))}</span>
          </button>
          <IconButton
            label={`${action() === 'unstage' ? 'Unstage' : 'Stage'} ${path()}`}
            busy={mutation()?.pending}
            disabled={readOnly() || repoBusy() || mutation()?.pending}
            onClick={(event) => { event.stopPropagation(); mutateGitResource(props.repo.id, action(), [change.id]); }}
            class="size-22 min-h-22 border-0 bg-transparent p-0 text-text-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:size-44 pointer-coarse:min-h-44"
          >{group.id === 'index' ? <Minus size={13} strokeWidth={1.8} /> : <Plus size={13} strokeWidth={1.8} />}</IconButton>
          <Show when={group.id === 'working_tree' || group.id === 'untracked'}><IconButton
            label={`Discard ${path()}`}
            disabled={readOnly() || repoBusy() || mutation()?.pending}
            onClick={(event) => { event.stopPropagation(); setDiscard({ id: change.id, path: path() }); }}
            class="size-22 min-h-22 border-0 bg-transparent p-0 text-text-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-danger pointer-coarse:size-44 pointer-coarse:min-h-44"
          ><Trash2 size={13} strokeWidth={1.8} /></IconButton></Show>
          </div>
          <Show when={mutation()?.error}>{(message) => <div role="alert" class="flex min-h-28 items-center gap-6 border-y border-danger-border bg-danger-soft px-12 py-4 text-10 leading-14 text-danger">
            <span class="min-w-0 flex-1">{message()}</span>
            <Show when={mutation()?.retryable}><button type="button" class="shrink-0 border-0 bg-transparent px-4 font-650 text-danger underline pointer-coarse:min-h-44 pointer-coarse:px-8" aria-label={`Retry ${action()} ${path()}`} onClick={() => retryGitResourceMutation(change.id)}>Retry</button></Show>
          </div>}</Show>
        </div>;
        }}</For>
        <Show when={state().nextCursor}>{(cursor) => <button type="button" class="h-24 w-full border-0 bg-transparent pl-28 text-left text-11 text-accent hover:bg-hover pointer-coarse:h-44" onClick={() => openMoreGitChanges(props.repo.id, group.id, cursor())}>Load more…</button>}</Show>
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

const basename = (path: string) => path.split('/').at(-1) || path;
const dirname = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const statusLetter = (status: string) => ({ added: 'A', modified: 'M', deleted: 'D', renamed: 'R', copied: 'C', untracked: 'U', conflict: '!' }[status] ?? 'M');
const statusColor = (status: string) => status === 'deleted' || status === 'conflict' ? 'text-danger' : status === 'untracked' || status === 'added' ? 'text-success' : 'text-warning';

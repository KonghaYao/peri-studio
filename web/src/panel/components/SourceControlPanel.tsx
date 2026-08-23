import { For, Show } from 'solid-js';
import { Icon, IconButton, LoadingState } from '../../components/ui';
import { mutateGitResource, resourceWorkspace } from '../store';
import type { RepositoryState } from '../lib/resource-store';
import { readOnly } from '../lib/auth-state';

const GROUPS = [
  { id: 'conflicts', label: 'Merge Changes' },
  { id: 'index', label: 'Staged Changes' },
  { id: 'working_tree', label: 'Changes' },
  { id: 'untracked', label: 'Untracked Changes' },
] as const;

function BranchIcon() { return <Icon size="small"><circle cx="5" cy="4" r="1.5" /><circle cx="5" cy="16" r="1.5" /><circle cx="15" cy="6" r="1.5" /><path d="M5 5.5v9M6.5 14c5 0 8.5-2.5 8.5-6.5" /></Icon>; }
function FileIcon() { return <Icon size="small"><path d="M5 2.8h6l4 4V17H5z" /><path d="M11 2.8V7h4" /></Icon>; }
function PlusIcon() { return <Icon size="small"><path d="M10 4v12M4 10h12" /></Icon>; }
function MinusIcon() { return <Icon size="small"><path d="M4 10h12" /></Icon>; }

export function SourceControlPanel() {
  return <section class="flex min-h-0 flex-1 flex-col" aria-label="Source Control">
    <div class="resource-section-title flex h-28 items-center border-b border-divider px-8 text-10 font-650 uppercase tracking-6 text-text-secondary">Source Control</div>
    <div class="ui-scrollbar min-h-0 flex-1 overflow-auto pb-12">
      <Show when={!resourceWorkspace().loading.includes('repositories')} fallback={<LoadingState label="Reading repositories" class="m-8 p-8! text-left!" />}>
        <Show when={resourceWorkspace().repositories.length} fallback={<div class="px-14 py-18 text-12 leading-18 text-text-muted">No Git repository was found in this workspace.</div>}>
          <For each={resourceWorkspace().repositories}>{(repo) => <Repository repo={repo} />}</For>
        </Show>
      </Show>
    </div>
  </section>;
}

function Repository(props: { repo: RepositoryState }) {
  const branch = () => props.repo.detached ? 'detached HEAD' : props.repo.headName || 'No commits yet';
  return <section class="border-b border-divider pb-6">
    <div class="flex h-32 items-center gap-6 px-8 text-12 font-550 text-text-primary" title={props.repo.root}>
      <BranchIcon /><span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{props.repo.name}</span>
      <span class="max-w-100 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-10 font-normal text-text-muted">{branch()}</span>
    </div>
    <Show when={(props.repo.ahead ?? 0) + (props.repo.behind ?? 0) > 0}>
      <div class="px-28 pb-4 text-10 text-text-muted">↑ {props.repo.ahead ?? 0} ↓ {props.repo.behind ?? 0}</div>
    </Show>
    <For each={GROUPS}>{(group) => {
      const state = () => props.repo.groups[group.id];
      return <Show when={state()?.count}>
        <div class="flex h-25 items-center px-8 text-10 font-650 uppercase tracking-4 text-text-secondary"><span>{group.label}</span><span class="ml-auto tabular-nums text-text-muted">{state().count}</span></div>
        <For each={state().changes}>{(change) => <div class="group flex h-24 items-center gap-5 pl-13 pr-5 text-12 hover:bg-hover" title={String(change.path ?? '')}>
          <span class="text-text-muted"><FileIcon /></span>
          <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{basename(String(change.path ?? ''))}</span>
          <span class="max-w-90 overflow-hidden text-ellipsis whitespace-nowrap text-10 text-text-faint">{dirname(String(change.path ?? ''))}</span>
          <span class={`w-14 text-center font-mono text-11 font-650 ${statusColor(String(change.status ?? ''))}`}>{statusLetter(String(change.status ?? ''))}</span>
          <IconButton
            label={group.id === 'index' ? `Unstage ${String(change.path ?? '')}` : `Stage ${String(change.path ?? '')}`}
            disabled={readOnly()}
            onClick={() => mutateGitResource(props.repo.id, group.id === 'index' ? 'unstage' : 'stage', [String(change.path ?? '')])}
            class="size-22 min-h-22 border-0 bg-transparent p-0 text-text-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          >{group.id === 'index' ? <MinusIcon /> : <PlusIcon />}</IconButton>
        </div>}</For>
      </Show>;
    }}</For>
  </section>;
}

const basename = (path: string) => path.split('/').at(-1) || path;
const dirname = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const statusLetter = (status: string) => ({ added: 'A', modified: 'M', deleted: 'D', renamed: 'R', copied: 'C', untracked: 'U', conflict: '!' }[status] ?? 'M');
const statusColor = (status: string) => status === 'deleted' || status === 'conflict' ? 'text-danger' : status === 'untracked' || status === 'added' ? 'text-success' : 'text-warning';

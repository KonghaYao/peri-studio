import { createSignal } from 'solid-js';
import { DocStore } from './doc-store';
import { gitResourceAction, openResourceFile, openResourceView, releaseResourceView, type ResourceResultFrame } from './resource-protocol';
import { renderResourceView, type ResourceEntry, type ResourceView } from './resource-view';

export interface DirectoryState { generation: string; entries: ResourceEntry[]; nextCursor?: string }
export interface RepositoryState {
  id: string;
  root: string;
  name: string;
  generation?: string;
  headName?: string;
  detached?: boolean;
  ahead?: number;
  behind?: number;
  groups: Record<string, { count: number; revision: string; changes: ResourceEntry[]; sourceGeneration?: string; nextCursor?: string }>;
}
export interface ResourceWorkspaceState {
  projectId: string | null;
  directories: Record<string, DirectoryState>;
  repositories: RepositoryState[];
  loading: string[];
  error: string | null;
}

const initial = (): ResourceWorkspaceState => ({
  projectId: null,
  directories: {},
  repositories: [],
  loading: [],
  error: null,
});

export const [resourceWorkspace, setResourceWorkspace] = createSignal<ResourceWorkspaceState>(initial());
const docs = new DocStore();
const pending = new Map<string, string>();
const openViews = new Map<string, string>();
const requested = new Set<string>();

interface Transport { send: (frame: unknown) => boolean; ready: () => boolean; toast: (message: string) => void }
let transport: Transport | null = null;

export function installResourceStore(next: Transport) { transport = next; }

docs.onUpdate = (docId) => {
  const view = renderResourceView(docId, docs.docFor(docId));
  if (view) consume(view);
};

export function activateResourceProject(projectId: string): void {
  if (resourceWorkspace().projectId !== projectId) resetResourceProject();
  setResourceWorkspace((state) => ({ ...state, projectId, error: null }));
  if (!transport?.ready()) return;
  request(projectId, 'directory:', { kind: 'fs-directory-page', path: '' });
  request(projectId, 'repositories', { kind: 'workspace-repositories-page' });
}

export function openResourceDirectory(path: string, cursor?: string): void {
  const projectId = resourceWorkspace().projectId;
  if (projectId) request(projectId, `directory:${path}:${cursor ?? 'first'}`, { kind: 'fs-directory-page', path, cursor });
}

export function openMoreGitChanges(repoId: string, groupId: import('./resource-protocol').GitGroupId, cursor: string): void {
  const projectId = resourceWorkspace().projectId;
  if (projectId) request(projectId, `group:${repoId}:${groupId}:${cursor}`, {
    kind: 'git-group-page', repoId, groupId, cursor,
  });
}

export function downloadResourceFile(path: string): void {
  const projectId = resourceWorkspace().projectId;
  if (!projectId || !transport?.ready()) return;
  const frame = openResourceFile(projectId, path);
  if (!transport.send(frame)) return;
  pending.set(frame.requestId, `blob:${path}`);
  setLoading(`blob:${path}`, true);
}

export function mutateGitResource(repoId: string, action: 'stage' | 'unstage', paths: string[]): void {
  const state = resourceWorkspace();
  const repo = state.repositories.find((item) => item.id === repoId);
  if (!state.projectId || !transport?.ready() || !repo?.generation || !paths.length) return;
  const frame = gitResourceAction(state.projectId, repoId, action, paths, repo.generation);
  if (!transport.send(frame)) return;
  pending.set(frame.requestId, `mutation:${repoId}`);
  setLoading(`mutation:${repoId}`, true);
}

export function refreshResourceProject(): void {
  const projectId = resourceWorkspace().projectId;
  if (!projectId) return;
  resetResourceProject();
  activateResourceProject(projectId);
}

export function handleResourceResult(frame: ResourceResultFrame): void {
  const key = pending.get(frame.requestId);
  pending.delete(frame.requestId);
  if (key) setLoading(key, false);
  if (frame.error) {
    setResourceWorkspace((state) => ({ ...state, error: frame.error!.message }));
    return;
  }
  if (frame.result?.kind === 'view') {
    openViews.set(frame.result.data.docId, frame.result.data.viewId);
    transport?.send({ t: 'ysync.subscribe', docs: [frame.result.data.docId], clientCapabilities: [] });
  } else if (frame.result?.kind === 'blob') {
    const anchor = document.createElement('a');
    anchor.href = frame.result.data.url;
    anchor.download = key?.startsWith('blob:') ? key.slice(5).split('/').at(-1) || '' : '';
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } else if (frame.result?.kind === 'mutated') {
    refreshResourceProject();
  }
}

export function handleResourceUpdate(frame: { doc: string; update: string }): boolean {
  if (!frame.doc.startsWith('resource:')) return false;
  docs.applyUpdateFrame(frame);
  return true;
}

export function replayResourceSubscriptions(): void {
  const docIds = [...openViews.keys()];
  if (docIds.length) transport?.send({ t: 'ysync.subscribe', docs: docIds, clientCapabilities: [] });
  const projectId = resourceWorkspace().projectId;
  if (projectId && !docIds.length) activateResourceProject(projectId);
}

export function resetResourceProject(): void {
  if (transport) {
    for (const [docId, viewId] of openViews) {
      transport.send({ t: 'ysync.unsubscribe', docs: [docId] });
      transport.send(releaseResourceView(viewId));
    }
  }
  docs.clear();
  pending.clear();
  openViews.clear();
  requested.clear();
  setResourceWorkspace(initial());
}

function request(projectId: string, key: string, payload: Parameters<typeof openResourceView>[1]) {
  if (!transport?.ready() || requested.has(key)) return;
  const frame = openResourceView(projectId, payload);
  if (!transport.send(frame)) return;
  requested.add(key);
  pending.set(frame.requestId, key);
  setLoading(key, true);
}

function setLoading(key: string, loading: boolean) {
  setResourceWorkspace((state) => ({
    ...state,
    loading: loading
      ? [...new Set([...state.loading, key])]
      : state.loading.filter((item) => item !== key),
  }));
}

function consume(view: ResourceView) {
  switch (view.viewType) {
    case 'fs_directory_page': {
      const path = view.path ?? '';
      setResourceWorkspace((state) => ({
        ...state,
        directories: {
          ...state.directories,
          [path]: mergeDirectoryPage(state.directories[path], view),
        },
      }));
      break;
    }
    case 'workspace_repositories_page': {
      const repositories = view.entries.map((entry) => ({
        id: String(entry.repo_id ?? entry.id),
        root: String(entry.root ?? ''),
        name: String(entry.name ?? 'Repository'),
        groups: {},
      }));
      setResourceWorkspace((state) => ({ ...state, repositories }));
      for (const repo of repositories) {
        request(view.projectId, `repository:${repo.id}`, { kind: 'git-repository', repoId: repo.id });
      }
      break;
    }
    case 'git_repository': {
      const repoId = view.repoId!;
      setResourceWorkspace((state) => ({
        ...state,
        repositories: upsertRepo(state.repositories, repoId, {
          root: String(view.meta.root ?? ''),
          generation: view.sourceGeneration,
          headName: stringOrUndefined(view.meta.head_name),
          detached: !!view.meta.detached,
          ahead: numberOrZero(view.meta.ahead),
          behind: numberOrZero(view.meta.behind),
          groups: Object.fromEntries(view.entries.map((entry) => [entry.id, {
            count: numberOrZero(entry.count), revision: String(entry.revision ?? ''), changes: [],
          }])),
        }),
      }));
      for (const group of view.entries) {
        if (numberOrZero(group.count) > 0) request(view.projectId, `group:${repoId}:${group.id}`, {
          kind: 'git-group-page', repoId, groupId: group.id as Parameters<typeof openResourceView>[1]['groupId'],
        });
      }
      break;
    }
    case 'git_group_page': {
      const repoId = view.repoId!;
      const groupId = view.groupId!;
      setResourceWorkspace((state) => ({
        ...state,
        repositories: state.repositories.map((repo) => repo.id === repoId ? {
          ...repo,
          groups: {
            ...repo.groups,
            [groupId]: mergeGitPage(repo.groups[groupId], view),
          },
        } : repo),
      }));
      break;
    }
  }
}

function mergeDirectoryPage(current: DirectoryState | undefined, view: ResourceView): DirectoryState {
  const generation = view.sourceGeneration ?? '';
  const entries = current?.generation === generation
    ? mergeEntries(current.entries, view.entries)
    : view.entries;
  return { generation, entries, nextCursor: view.nextCursor };
}

function mergeGitPage(
  current: RepositoryState['groups'][string] | undefined,
  view: ResourceView,
): RepositoryState['groups'][string] {
  const sourceGeneration = view.sourceGeneration ?? '';
  const changes = current?.sourceGeneration === sourceGeneration
    ? mergeEntries(current.changes, view.entries)
    : view.entries;
  return {
    count: current?.count ?? changes.length,
    revision: current?.revision ?? '',
    changes,
    sourceGeneration,
    nextCursor: view.nextCursor,
  };
}

function mergeEntries(current: ResourceEntry[], incoming: ResourceEntry[]): ResourceEntry[] {
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of incoming) byId.set(entry.id, entry);
  return [...byId.values()];
}

function upsertRepo(repositories: RepositoryState[], id: string, patch: Partial<RepositoryState>): RepositoryState[] {
  const found = repositories.some((repo) => repo.id === id);
  if (!found) return [...repositories, { id, root: '', name: 'Repository', groups: {}, ...patch }];
  return repositories.map((repo) => repo.id === id ? { ...repo, ...patch } : repo);
}

const stringOrUndefined = (value: unknown) => typeof value === 'string' ? value : undefined;
const numberOrZero = (value: unknown) => typeof value === 'number' ? value : Number(value) || 0;

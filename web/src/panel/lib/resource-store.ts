import { createSignal } from 'solid-js';
import { DocStore } from './doc-store';
import { openResourceFile, openResourceGitDiff, openResourceView, releaseResourceView, type GitActionKind, type GitGroupId, type ResourceResultFrame } from './resource-protocol';
import { GitMutationController, type GitMutationState } from './resource-mutations';
import { loadFilePreview, loadGitDiff, type ResourceDiffPreviewState, type ResourceFilePreviewState } from './resource-preview';
import { renderResourceView, type ResourceEntry, type ResourceView } from './resource-view';

export interface DirectoryState { generation: string; entries: ResourceEntry[]; nextCursor?: string }
export interface RepositoryState {
  id: string;
  root: string;
  name: string;
  generation?: string;
  headName?: string;
  upstream?: string;
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
  mutations?: Record<string, GitMutationState>;
  repoMutations?: Record<string, GitMutationState>;
}

const initial = (): ResourceWorkspaceState => ({
  projectId: null,
  directories: {},
  repositories: [],
  loading: [],
  error: null,
  mutations: {},
  repoMutations: {},
});

export const [resourceWorkspace, setResourceWorkspace] = createSignal<ResourceWorkspaceState>(initial());
export const [resourceDiffPreview, setResourceDiffPreview] = createSignal<ResourceDiffPreviewState | null>(null);
export const [resourceFilePreview, setResourceFilePreview] = createSignal<ResourceFilePreviewState | null>(null);
const docs = new DocStore();
const pending = new Map<string, string>();
const pendingDiffs = new Map<string, ResourceDiffPreviewState>();
const pendingFiles = new Map<string, ResourceFilePreviewState>();
const ignoredRequests = new Set<string>();
const gitMutations = new GitMutationController();
const openViews = new Map<string, string>();
const openViewKeys = new Map<string, string>();
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

export function openFilePreview(path: string): void {
  const projectId = resourceWorkspace().projectId;
  if (!projectId || !path || !transport?.ready()) return;
  const frame = openResourceFile(projectId, path);
  if (!transport.send(frame)) return;
  const preview: ResourceFilePreviewState = { requestId: frame.requestId, path, loading: true };
  pending.set(frame.requestId, `preview:${path}`);
  pendingFiles.set(frame.requestId, preview);
  setResourceDiffPreview(null);
  setResourceFilePreview(preview);
}

export function closeResourceFilePreview(): void {
  setResourceFilePreview(null);
}

export function retryResourceFilePreview(): void {
  const preview = resourceFilePreview();
  if (preview) openFilePreview(preview.path);
}

export function downloadPreviewedFile(): void {
  const preview = resourceFilePreview();
  if (preview) downloadResourceFile(preview.path);
}

export function openGitDiffPreview(repoId: string, groupId: GitGroupId, change: ResourceEntry): void {
  const projectId = resourceWorkspace().projectId;
  const path = typeof change.path === 'string' ? change.path : '';
  if (!projectId || !path || !transport?.ready()) return;
  const frame = openResourceGitDiff(projectId, repoId, change.id);
  if (!transport.send(frame)) return;
  const preview: ResourceDiffPreviewState = {
    requestId: frame.requestId,
    repoId,
    groupId,
    changeId: change.id,
    path,
    originalPath: typeof change.original_path === 'string' ? change.original_path : undefined,
    status: typeof change.status === 'string' ? change.status : 'modified',
    loading: true,
  };
  pending.set(frame.requestId, `diff:${path}`);
  pendingDiffs.set(frame.requestId, preview);
  setResourceFilePreview(null);
  setResourceDiffPreview(preview);
}

export function closeResourceDiffPreview(): void {
  setResourceDiffPreview(null);
}

export function retryGitDiffPreview(): void {
  const preview = resourceDiffPreview();
  if (!preview) return;
  openGitDiffPreview(preview.repoId, preview.groupId, {
    id: preview.changeId,
    path: preview.path,
    original_path: preview.originalPath,
    status: preview.status,
  });
}

export function mutateGitResource(repoId: string, action: GitActionKind, changeIds: string[] = [], message?: string): boolean {
  if (!transport) return false;
  return gitMutations.start({ state: resourceWorkspace(), repoId, action, changeIds, message,
    ready: transport.ready(), send: transport.send, update: setResourceWorkspace, setLoading });
}

export function retryGitResourceMutation(changeId: string): boolean {
  const mutation = resourceWorkspace().mutations?.[changeId];
  if (!mutation || mutation.pending || !mutation.retryable) return false;
  return mutateGitResource(mutation.repoId, mutation.action, mutation.changeIds, mutation.message);
}

export function retryGitRepositoryMutation(repoId: string): boolean {
  const mutation = resourceWorkspace().repoMutations?.[repoId];
  if (!mutation || mutation.pending || !mutation.retryable) return false;
  return mutateGitResource(mutation.repoId, mutation.action, mutation.changeIds, mutation.message);
}

export function refreshResourceProject(): void {
  const projectId = resourceWorkspace().projectId;
  if (!projectId) return;
  resetResourceProject();
  activateResourceProject(projectId);
}

export function handleResourceResult(frame: ResourceResultFrame): void {
  if (ignoredRequests.delete(frame.requestId)) {
    if (frame.result?.kind === 'view') transport?.send(releaseResourceView(frame.result.data.viewId));
    return;
  }
  const key = pending.get(frame.requestId);
  const diffRequest = pendingDiffs.get(frame.requestId);
  const fileRequest = pendingFiles.get(frame.requestId);
  const mutationRequest = gitMutations.take(frame.requestId);
  pending.delete(frame.requestId);
  pendingDiffs.delete(frame.requestId);
  pendingFiles.delete(frame.requestId);
  if (key) setLoading(key, false);
  if (mutationRequest) setLoading(`mutation:${mutationRequest.repoId}`, false);
  // 只有本 session 明确登记过的 request 才能取得 view/blob/mutation 的
  // 所有权。切 project 或 reset 后的迟到 view 立即释放，绝不订阅。
  if (!key && !diffRequest && !fileRequest && !mutationRequest) {
    if (frame.result?.kind === 'view') transport?.send(releaseResourceView(frame.result.data.viewId));
    return;
  }
  if (frame.error) {
    if (diffRequest) {
      updateDiffPreview(diffRequest.requestId, {
        loading: false,
        error: frame.error.message,
        errorCode: frame.error.code,
        retryable: frame.error.retryable,
      });
      return;
    }
    if (fileRequest) {
      updateFilePreview(fileRequest.requestId, { loading: false, error: frame.error.message });
      return;
    }
    if (mutationRequest) {
      gitMutations.fail(mutationRequest, frame.error, setResourceWorkspace);
      return;
    }
    setResourceWorkspace((state) => ({ ...state, error: frame.error!.message }));
    return;
  }
  if (frame.result?.kind === 'view') {
    openViews.set(frame.result.data.docId, frame.result.data.viewId);
    if (key) openViewKeys.set(frame.result.data.docId, key);
    transport?.send({ t: 'ysync.subscribe', docs: [frame.result.data.docId], clientCapabilities: [] });
  } else if (frame.result?.kind === 'blob') {
    if (diffRequest) {
      void loadGitDiff(frame.result.data.url, diffRequest, updateDiffPreview);
      return;
    }
    if (fileRequest) {
      void loadFilePreview(frame.result.data.url, frame.result.data.etag, fileRequest, updateFilePreview);
      return;
    }
    downloadUrl(frame.result.data.url, key?.startsWith('blob:') ? basename(key.slice(5)) : '');
  } else if (frame.result?.kind === 'mutated' && mutationRequest) {
    gitMutations.succeed(mutationRequest, setResourceWorkspace);
    refreshGitRepository(mutationRequest.repoId);
  }
}

function refreshGitRepository(repoId: string): void {
  const projectId = resourceWorkspace().projectId;
  if (!projectId || !transport) return;
  const prefixes = [`repository:${repoId}`, `group:${repoId}:`];
  for (const key of [...requested]) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) requested.delete(key);
  }
  for (const [requestId, key] of [...pending]) {
    if (!prefixes.some((prefix) => key.startsWith(prefix))) continue;
    pending.delete(requestId);
    ignoredRequests.add(requestId);
  }
  for (const [docId, key] of [...openViewKeys]) {
    if (!prefixes.some((prefix) => key.startsWith(prefix))) continue;
    const viewId = openViews.get(docId);
    transport.send({ t: 'ysync.unsubscribe', docs: [docId] });
    if (viewId) transport.send(releaseResourceView(viewId));
    docs.drop(docId);
    openViews.delete(docId);
    openViewKeys.delete(docId);
  }
  setResourceWorkspace((state) => ({
    ...state,
    repositories: state.repositories.map((repo) => repo.id === repoId
      ? { ...repo, groups: {} }
      : repo),
  }));
  request(projectId, `repository:${repoId}`, { kind: 'git-repository', repoId });
}

export function handleResourceUpdate(frame: { doc: string; update: string }): boolean {
  if (!frame.doc.startsWith('resource:')) return false;
  // 合法 docId 仍必须来自本 session 已接受的短租约；未知/迟到 update
  // 只在总帧入口被消费，不得分配 DocStore 或污染当前 project。
  if (!openViews.has(frame.doc)) return true;
  docs.applyUpdateFrame(frame);
  return true;
}

export function replayResourceSubscriptions(): void {
  const projectId = resourceWorkspace().projectId;
  if (!projectId) return;
  // 资源 Doc 是短租约快照；重连后重新申请，避免重放已经过期的 opaque docId。
  resetResourceProject();
  activateResourceProject(projectId);
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
  pendingDiffs.clear();
  pendingFiles.clear();
  ignoredRequests.clear();
  gitMutations.clear();
  openViews.clear();
  openViewKeys.clear();
  requested.clear();
  setResourceDiffPreview(null);
  setResourceFilePreview(null);
  setResourceWorkspace(initial());
}

function updateDiffPreview(requestId: string, patch: Partial<ResourceDiffPreviewState>) {
  setResourceDiffPreview((current) => current?.requestId === requestId ? { ...current, ...patch } : current);
}

function updateFilePreview(requestId: string, patch: Partial<ResourceFilePreviewState>) {
  setResourceFilePreview((current) => current?.requestId === requestId ? { ...current, ...patch } : current);
}

function downloadUrl(url: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

const basename = (path: string) => path.split('/').at(-1) || path;

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
  if (view.projectId !== resourceWorkspace().projectId) return;
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
          upstream: stringOrUndefined(view.meta.upstream),
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

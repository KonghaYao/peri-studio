import { createSignal } from 'solid-js';
import { DocStore } from './doc-store';
import { gitResourceAction, openResourceFile, openResourceGitDiff, openResourceView, releaseResourceView, type GitGroupId, type ResourceResultFrame } from './resource-protocol';
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
  mutations?: Record<string, GitMutationState>;
}

export interface GitMutationState {
  requestId: string;
  repoId: string;
  action: 'stage' | 'unstage';
  changeIds: string[];
  pending: boolean;
  error?: string;
  retryable?: boolean;
}

export interface ResourceDiffPreviewState {
  requestId: string;
  repoId: string;
  groupId: GitGroupId;
  changeId: string;
  path: string;
  originalPath?: string;
  status: string;
  loading: boolean;
  text?: string;
  error?: string;
  errorCode?: string;
  retryable?: boolean;
}

export interface ResourceFilePreviewState {
  requestId: string;
  path: string;
  loading: boolean;
  mode?: 'text' | 'image' | 'binary' | 'large';
  url?: string;
  contentType?: string;
  size?: number;
  etag?: string;
  text?: string;
  error?: string;
}

const initial = (): ResourceWorkspaceState => ({
  projectId: null,
  directories: {},
  repositories: [],
  loading: [],
  error: null,
  mutations: {},
});

export const [resourceWorkspace, setResourceWorkspace] = createSignal<ResourceWorkspaceState>(initial());
export const [resourceDiffPreview, setResourceDiffPreview] = createSignal<ResourceDiffPreviewState | null>(null);
export const [resourceFilePreview, setResourceFilePreview] = createSignal<ResourceFilePreviewState | null>(null);
const docs = new DocStore();
const pending = new Map<string, string>();
const pendingDiffs = new Map<string, ResourceDiffPreviewState>();
const pendingFiles = new Map<string, ResourceFilePreviewState>();
const pendingMutations = new Map<string, GitMutationState>();
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

export function mutateGitResource(repoId: string, action: 'stage' | 'unstage', changeIds: string[]): boolean {
  const state = resourceWorkspace();
  const repo = state.repositories.find((item) => item.id === repoId);
  if (!state.projectId || !transport?.ready() || !repo?.generation || !changeIds.length) return false;
  if (changeIds.some((changeId) => state.mutations?.[changeId]?.pending)) return false;
  const frame = gitResourceAction(state.projectId, repoId, action, changeIds, repo.generation);
  if (!transport.send(frame)) return false;
  const mutation: GitMutationState = {
    requestId: frame.requestId, repoId, action, changeIds, pending: true,
  };
  pendingMutations.set(frame.requestId, mutation);
  pending.set(frame.requestId, `mutation:${repoId}`);
  setLoading(`mutation:${repoId}`, true);
  setResourceWorkspace((current) => ({
    ...current,
    mutations: {
      ...current.mutations,
      ...Object.fromEntries(changeIds.map((changeId) => [changeId, mutation])),
    },
  }));
  return true;
}

export function retryGitResourceMutation(changeId: string): boolean {
  const mutation = resourceWorkspace().mutations?.[changeId];
  if (!mutation || mutation.pending || !mutation.retryable) return false;
  return mutateGitResource(mutation.repoId, mutation.action, mutation.changeIds);
}

export function refreshResourceProject(): void {
  const projectId = resourceWorkspace().projectId;
  if (!projectId) return;
  resetResourceProject();
  activateResourceProject(projectId);
}

export function handleResourceResult(frame: ResourceResultFrame): void {
  const key = pending.get(frame.requestId);
  const diffRequest = pendingDiffs.get(frame.requestId);
  const fileRequest = pendingFiles.get(frame.requestId);
  const mutationRequest = pendingMutations.get(frame.requestId);
  pending.delete(frame.requestId);
  pendingDiffs.delete(frame.requestId);
  pendingFiles.delete(frame.requestId);
  pendingMutations.delete(frame.requestId);
  if (key) setLoading(key, false);
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
      setResourceWorkspace((state) => ({
        ...state,
        mutations: {
          ...state.mutations,
          ...Object.fromEntries(mutationRequest.changeIds.map((changeId) => [changeId, {
            ...mutationRequest,
            pending: false,
            error: frame.error!.message,
            retryable: frame.error!.retryable,
          }])),
        },
      }));
      return;
    }
    setResourceWorkspace((state) => ({ ...state, error: frame.error!.message }));
    return;
  }
  if (frame.result?.kind === 'view') {
    openViews.set(frame.result.data.docId, frame.result.data.viewId);
    transport?.send({ t: 'ysync.subscribe', docs: [frame.result.data.docId], clientCapabilities: [] });
  } else if (frame.result?.kind === 'blob') {
    if (diffRequest) {
      void loadGitDiff(frame.result.data.url, diffRequest);
      return;
    }
    if (fileRequest) {
      void loadFilePreview(frame.result.data.url, frame.result.data.etag, fileRequest);
      return;
    }
    downloadUrl(frame.result.data.url, key?.startsWith('blob:') ? basename(key.slice(5)) : '');
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
  pendingMutations.clear();
  openViews.clear();
  requested.clear();
  setResourceDiffPreview(null);
  setResourceFilePreview(null);
  setResourceWorkspace(initial());
}

async function loadGitDiff(url: string, request: ResourceDiffPreviewState) {
  try {
    const response = await fetch(url, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'text/x-diff, text/plain;q=0.9' },
    });
    if (!response.ok) throw new Error('diff fetch failed');
    updateDiffPreview(request.requestId, {
      loading: false,
      text: await response.text(),
      error: undefined,
      errorCode: undefined,
      retryable: undefined,
    });
  } catch {
    updateDiffPreview(request.requestId, {
      loading: false,
      error: 'Unable to load this diff. Refresh Source Control and try again.',
      retryable: true,
    });
  }
}

const MAX_TEXT_PREVIEW_BYTES = 4 * 1024 * 1024;

async function loadFilePreview(url: string, etag: string | undefined, request: ResourceFilePreviewState) {
  try {
    const head = await fetch(url, {
      method: 'HEAD', credentials: 'same-origin', cache: 'no-store',
    });
    if (!head.ok) throw new Error('file metadata fetch failed');
    const contentType = head.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
    const contentLength = head.headers.get('content-length');
    const parsedSize = contentLength === null ? undefined : Number(contentLength);
    const size = parsedSize !== undefined && Number.isFinite(parsedSize) ? parsedSize : undefined;
    const metadata = { url, etag, contentType, size };
    if (isRasterImage(contentType)) {
      updateFilePreview(request.requestId, { ...metadata, loading: false, mode: 'image' });
      return;
    }
    if (!isTextPreview(request.path, contentType) && contentType !== 'application/octet-stream') {
      updateFilePreview(request.requestId, { ...metadata, loading: false, mode: 'binary' });
      return;
    }
    if (size !== undefined && size > MAX_TEXT_PREVIEW_BYTES) {
      updateFilePreview(request.requestId, { ...metadata, loading: false, mode: 'large' });
      return;
    }
    const response = await fetch(url, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'text/plain, application/json;q=0.9, */*;q=0.1' },
    });
    if (!response.ok) throw new Error('file fetch failed');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_TEXT_PREVIEW_BYTES) {
      updateFilePreview(request.requestId, { ...metadata, size: bytes.byteLength, loading: false, mode: 'large' });
      return;
    }
    if (new Uint8Array(bytes).includes(0)) {
      updateFilePreview(request.requestId, { ...metadata, size: bytes.byteLength, loading: false, mode: 'binary' });
      return;
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      updateFilePreview(request.requestId, { ...metadata, size: bytes.byteLength, loading: false, mode: 'binary' });
      return;
    }
    updateFilePreview(request.requestId, { ...metadata, size: bytes.byteLength, loading: false, mode: 'text', text });
  } catch {
    updateFilePreview(request.requestId, { loading: false, error: 'Unable to open this file. Refresh Explorer and try again.' });
  }
}

function updateDiffPreview(requestId: string, patch: Partial<ResourceDiffPreviewState>) {
  setResourceDiffPreview((current) => current?.requestId === requestId ? { ...current, ...patch } : current);
}

function updateFilePreview(requestId: string, patch: Partial<ResourceFilePreviewState>) {
  setResourceFilePreview((current) => current?.requestId === requestId ? { ...current, ...patch } : current);
}

function isTextPreview(path: string, contentType: string): boolean {
  if (contentType.startsWith('text/')) return true;
  if (['application/json', 'application/javascript', 'application/xml', 'image/svg+xml'].includes(contentType)) return true;
  return /\.(?:c|cc|cpp|h|hpp|go|java|kt|kts|py|rb|php|sh|bash|zsh|fish|sql|vue|svelte|astro|xml|ini|cfg|conf|env|lock|gitignore|dockerfile)$/i.test(path);
}

function isRasterImage(contentType: string): boolean {
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'].includes(contentType);
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

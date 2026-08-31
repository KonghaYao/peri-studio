import { createSignal } from 'solid-js';
import { DocStore } from './doc-store';
import { openResourceFile, openResourceGitDiff, openResourceView, releaseResourceView, type GitActionKind, type GitGraphActionPayload, type GitGroupId, type ResourceResultFrame } from './resource-protocol';
import { GitMutationController } from './resource-mutations';
import { downloadResourceUrl, loadFilePreview, loadGitDiff, type ResourceDiffPreviewState, type ResourceFilePreviewState } from './resource-preview';
import { renderResourceView, type ResourceEntry, type ResourceView } from './resource-view';
import { initialResourceWorkspace as initial, reduceResourceView, type ResourceWorkspaceState } from './resource-state';
export type { DirectoryState, RepositoryState, ResourceWorkspaceState } from './resource-state';

export const [resourceWorkspace, setResourceWorkspace] = createSignal<ResourceWorkspaceState>(initial());
export const [resourceDiffPreview, setResourceDiffPreview] = createSignal<ResourceDiffPreviewState | null>(null);
export const [resourceFilePreview, setResourceFilePreview] = createSignal<ResourceFilePreviewState | null>(null);
const docs = new DocStore();
interface PendingResourceRequest { key: string; projectId: string; generation: number }
interface OpenResourceLease { viewId: string; projectId: string; generation: number; expiresAt: number; timer?: number }

const pending = new Map<string, PendingResourceRequest>();
const pendingDiffs = new Map<string, ResourceDiffPreviewState>();
const pendingFiles = new Map<string, ResourceFilePreviewState>();
const ignoredRequests = new Set<string>();
const gitMutations = new GitMutationController();
const openViews = new Map<string, OpenResourceLease>();
const openViewKeys = new Map<string, string>();
const requested = new Set<string>();
let resourceGeneration = 0;
const activeLogViews = new Map<string, string>();
const MAX_ACCUMULATED_COMMITS_PER_REPO = 4000;

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

export function openGitLog(repoId: string, cursor?: string, limit = 50): void {
  const projectId = resourceWorkspace().projectId;
  const repo = resourceWorkspace().repositories.find((item) => item.id === repoId);
  if (!projectId || !repo?.generation) return;
  const accumulated = repo.log?.commits.length ?? 0;
  if (cursor && accumulated >= MAX_ACCUMULATED_COMMITS_PER_REPO) return;
  request(projectId, `log:${repoId}:${cursor ?? 'start'}`, {
    kind: 'git-log-page',
    repoId,
    cursor,
    limit,
    expectedGeneration: repo.generation,
  });
}

export function openMoreGitLog(repoId: string): void {
  const repo = resourceWorkspace().repositories.find((item) => item.id === repoId);
  const nextCursor = repo?.log?.nextCursor;
  if (!nextCursor) return;
  const accumulated = repo.log?.commits.length ?? 0;
  if (accumulated >= MAX_ACCUMULATED_COMMITS_PER_REPO) return;
  openGitLog(repoId, nextCursor);
}

export function refreshGitLog(repoId: string): void {
  refreshGitRepository(repoId);
}

export function gitLogCommits(repoId: string): ResourceEntry[] {
  return resourceWorkspace().repositories.find((repo) => repo.id === repoId)?.log?.commits ?? [];
}

export function gitLogNextCursor(repoId: string): string | undefined {
  return resourceWorkspace().repositories.find((repo) => repo.id === repoId)?.log?.nextCursor;
}

export function gitLogHeadOid(repoId: string): string | undefined {
  const repo = resourceWorkspace().repositories.find((item) => item.id === repoId);
  return repo?.log?.headOid ?? repo?.headOid;
}

export function gitLogLoading(repoId: string): boolean {
  return resourceWorkspace().loading.some((key) => key.startsWith(`log:${repoId}:`));
}

export function canLoadMoreGitLog(repoId: string): boolean {
  const repo = resourceWorkspace().repositories.find((item) => item.id === repoId);
  if (!repo?.log?.nextCursor) return false;
  return (repo.log.commits.length ?? 0) < MAX_ACCUMULATED_COMMITS_PER_REPO;
}

export function downloadResourceFile(path: string): void {
  const projectId = resourceWorkspace().projectId;
  if (!projectId || !transport?.ready()) return;
  const frame = openResourceFile(projectId, path);
  if (!transport.send(frame)) return;
  trackRequest(frame.requestId, `blob:${path}`, projectId);
  setLoading(`blob:${path}`, true);
}

export function openFilePreview(path: string): void {
  const projectId = resourceWorkspace().projectId;
  if (!projectId || !path || !transport?.ready()) return;
  const frame = openResourceFile(projectId, path);
  if (!transport.send(frame)) return;
  const preview: ResourceFilePreviewState = { requestId: frame.requestId, path, loading: true };
  trackRequest(frame.requestId, `preview:${path}`, projectId);
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
  trackRequest(frame.requestId, `diff:${path}`, projectId);
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

export function mutateGitResource(repoId: string, action: GitActionKind, changeIds: string[] = [], message?: string, graph?: GitGraphActionPayload): boolean {
  if (!transport) return false;
  return gitMutations.start({ state: resourceWorkspace(), repoId, action, changeIds, message, graph,
    ready: transport.ready(), send: transport.send, update: setResourceWorkspace, setLoading });
}

export function mutateGitGraphResource(
  repoId: string,
  action: Extract<GitActionKind, 'checkout' | 'create-branch' | 'rename-branch' | 'reset' | 'revert'>,
  graph: GitGraphActionPayload,
): boolean {
  return mutateGitResource(repoId, action, [], undefined, graph);
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
  const owner = pending.get(frame.requestId);
  const ownerCurrent = owner?.generation === resourceGeneration
    && owner.projectId === resourceWorkspace().projectId;
  const key = ownerCurrent ? owner.key : undefined;
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
  if ((!ownerCurrent && (diffRequest || fileRequest)) || (!key && !diffRequest && !fileRequest && !mutationRequest)) {
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
    if (key) requested.delete(key);
    if (key?.startsWith('log:') && frame.error.code === 'STALE_CURSOR') {
      const repoId = key.slice('log:'.length).split(':')[0];
      if (repoId) invalidateGitLog(repoId);
      return;
    }
    if (key?.startsWith('log:') && frame.error.code === 'VIEW_TOO_LARGE') {
      const suffix = key.slice(`log:${key.slice('log:'.length).split(':')[0]}:`.length);
      const repoId = key.slice('log:'.length).split(':')[0];
      const cursor = suffix === 'start' ? undefined : suffix;
      const suggested = frame.error.suggestedLimit;
      if (repoId && typeof suggested === 'number' && suggested > 0) {
        openGitLog(repoId, cursor, suggested);
        return;
      }
    }
    setResourceWorkspace((state) => ({ ...state, error: frame.error!.message }));
    return;
  }
  if (frame.result?.kind === 'view') {
    const expiresAt = Date.parse(frame.result.data.leaseExpiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || !owner) {
      transport?.send(releaseResourceView(frame.result.data.viewId));
      setResourceWorkspace((state) => ({ ...state, error: 'Resource view lease expired before it could be opened.' }));
      return;
    }
    const lease: OpenResourceLease = {
      viewId: frame.result.data.viewId,
      projectId: owner.projectId,
      generation: owner.generation,
      expiresAt,
    };
    openViews.set(frame.result.data.docId, lease);
    if (key) openViewKeys.set(frame.result.data.docId, key);
    transport?.send({ t: 'ysync.subscribe', docs: [frame.result.data.docId], clientCapabilities: [] });
    scheduleLeaseDeadline(frame.result.data.docId, lease);
  } else if (frame.result?.kind === 'blob') {
    if (diffRequest) {
      void loadGitDiff(frame.result.data.url, diffRequest, updateDiffPreview);
      return;
    }
    if (fileRequest) {
      void loadFilePreview(frame.result.data.url, frame.result.data.etag, fileRequest, updateFilePreview);
      return;
    }
    downloadResourceUrl(frame.result.data.url, key?.startsWith('blob:') ? basename(key.slice(5)) : '');
  } else if (frame.result?.kind === 'mutated' && mutationRequest) {
    gitMutations.succeed(mutationRequest, setResourceWorkspace);
    refreshGitRepository(mutationRequest.repoId);
  }
}

function invalidateGitLog(repoId: string): void {
  const projectId = resourceWorkspace().projectId;
  const repo = resourceWorkspace().repositories.find((item) => item.id === repoId);
  if (!projectId || !repo?.generation) return;
  const prefixes = [`log:${repoId}:`];
  activeLogViews.delete(repoId);
  for (const key of [...requested]) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) requested.delete(key);
  }
  for (const [requestId, owner] of [...pending]) {
    if (!prefixes.some((prefix) => owner.key.startsWith(prefix))) continue;
    pending.delete(requestId);
    ignoredRequests.add(requestId);
  }
  for (const [docId, key] of [...openViewKeys]) {
    if (!prefixes.some((prefix) => key.startsWith(prefix))) continue;
    releaseDocLease(docId);
  }
  setResourceWorkspace((state) => ({
    ...state,
    repositories: state.repositories.map((item) => item.id === repoId
      ? { ...item, log: undefined }
      : item),
  }));
  openGitLog(repoId);
}

function refreshGitRepository(repoId: string): void {
  const projectId = resourceWorkspace().projectId;
  if (!projectId || !transport) return;
  const prefixes = [`repository:${repoId}`, `group:${repoId}:`, `log:${repoId}:`];
  activeLogViews.delete(repoId);
  for (const key of [...requested]) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) requested.delete(key);
  }
  for (const [requestId, owner] of [...pending]) {
    if (!prefixes.some((prefix) => owner.key.startsWith(prefix))) continue;
    pending.delete(requestId);
    ignoredRequests.add(requestId);
  }
  for (const [docId, key] of [...openViewKeys]) {
    if (!prefixes.some((prefix) => key.startsWith(prefix))) continue;
    releaseDocLease(docId);
  }
  setResourceWorkspace((state) => ({
    ...state,
    repositories: state.repositories.map((repo) => repo.id === repoId
      ? { ...repo, groups: {}, log: undefined }
      : repo),
  }));
  request(projectId, `repository:${repoId}`, { kind: 'git-repository', repoId });
}

export function handleResourceUpdate(frame: { doc: string; update: string }): boolean {
  if (!frame.doc.startsWith('resource:')) return false;
  const lease = openViews.get(frame.doc);
  if (!lease || lease.generation !== resourceGeneration
    || lease.projectId !== resourceWorkspace().projectId) return true;
  // timeout callback 可能仍排在主线程队列中；首帧接受边界必须再次同步校时，
  // 不能让已过期 update 通过后清掉 deadline。
  if (Date.now() >= lease.expiresAt) {
    expireLease(frame.doc, lease);
    return true;
  }
  if (lease.timer !== undefined) {
    window.clearTimeout(lease.timer);
    lease.timer = undefined;
  }
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
  resourceGeneration += 1;
  if (transport) {
    for (const [docId, lease] of openViews) {
      if (lease.timer !== undefined) window.clearTimeout(lease.timer);
      transport.send({ t: 'ysync.unsubscribe', docs: [docId] });
      transport.send(releaseResourceView(lease.viewId));
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
  activeLogViews.clear();
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

const basename = (path: string) => path.split('/').at(-1) || path;

function request(projectId: string, key: string, payload: Parameters<typeof openResourceView>[1]) {
  if (!transport?.ready() || requested.has(key)) return;
  const frame = openResourceView(projectId, payload);
  if (!transport.send(frame)) return;
  requested.add(key);
  trackRequest(frame.requestId, key, projectId);
  setLoading(key, true);
}

function trackRequest(requestId: string, key: string, projectId: string): void {
  pending.set(requestId, { key, projectId, generation: resourceGeneration });
}

function scheduleLeaseDeadline(docId: string, lease: OpenResourceLease): void {
  const schedule = () => {
    const remaining = lease.expiresAt - Date.now();
    if (remaining > 0) {
      lease.timer = window.setTimeout(schedule, Math.min(remaining, 2_147_000_000));
      return;
    }
    expireLease(docId, lease);
  };
  schedule();
}

function expireLease(docId: string, lease: OpenResourceLease): void {
  if (openViews.get(docId) !== lease) return;
  if (lease.timer !== undefined) window.clearTimeout(lease.timer);
  releaseDocLease(docId);
  setResourceWorkspace((state) => ({ ...state, error: 'Resource view lease expired before synchronization completed.' }));
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
  const previousDocId = view.viewType === 'git_log_page' && view.repoId
    ? activeLogViews.get(view.repoId)
    : undefined;
  const hadLogCommits = view.viewType === 'git_log_page' && view.repoId
    ? (resourceWorkspace().repositories.find((repo) => repo.id === view.repoId)?.log?.commits.length ?? 0) > 0
    : false;
  const result = reduceResourceView(resourceWorkspace(), view);
  if (result.state !== resourceWorkspace()) setResourceWorkspace(result.state);
  if (view.viewType === 'git_log_page' && view.repoId) {
    if (hadLogCommits && previousDocId && previousDocId !== view.docId) {
      releaseDocLease(previousDocId);
    }
    activeLogViews.set(view.repoId, view.docId);
  }
  for (const followup of result.followups) request(view.projectId, followup.key, followup.payload);
}

function releaseDocLease(docId: string): void {
  const lease = openViews.get(docId);
  transport?.send({ t: 'ysync.unsubscribe', docs: [docId] });
  if (lease) {
    if (lease.timer !== undefined) window.clearTimeout(lease.timer);
    transport?.send(releaseResourceView(lease.viewId));
  }
  docs.drop(docId);
  openViews.delete(docId);
  openViewKeys.delete(docId);
}

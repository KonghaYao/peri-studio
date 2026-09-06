import { isStrictRfc3339 } from './rfc3339';

export type ResourceViewKind =
  | 'workspace-summary'
  | 'workspace-repositories-page'
  | 'fs-directory-page'
  | 'git-repository'
  | 'git-group-page'
  | 'git-log-page';

export type GitGroupId = 'conflicts' | 'index' | 'working_tree' | 'untracked';
export type GitActionKind =
  | 'stage'
  | 'unstage'
  | 'discard'
  | 'commit'
  | 'pull'
  | 'push'
  | 'sync'
  | 'checkout'
  | 'create-branch'
  | 'rename-branch'
  | 'reset'
  | 'revert';

export type GitResetMode = 'soft' | 'mixed' | 'hard';

export interface GitGraphActionPayload {
  targetOid?: string;
  refName?: string;
  newRefName?: string;
  resetMode?: GitResetMode;
}

export interface OpenResourceView {
  kind: ResourceViewKind;
  path?: string;
  repoId?: string;
  groupId?: GitGroupId;
  cursor?: string;
  expectedGeneration?: string;
  limit?: number;
}

export interface ResourceViewOpened {
  viewId: string;
  docId: string;
  leaseExpiresAt: string;
}

export interface ResourceFailure {
  code: string;
  message: string;
  retryable: boolean;
  suggestedLimit?: number;
}

export interface ResourceUploadOpened {
  uploadId: string;
  url: string;
  expiresAt: string;
}

export interface OpenResourceUploadPayload {
  path: string;
  expectedBytes?: number;
  sha256?: string;
}

export interface ResourceResultFrame {
  t: 'resource_result';
  requestId: string;
  result?:
    | { kind: 'view'; data: ResourceViewOpened }
    | { kind: 'released' }
    | { kind: 'mutated' }
    | { kind: 'blob'; data: { blobId: string; url: string; expiresAt: string; etag?: string } }
    | { kind: 'upload'; data: ResourceUploadOpened };
  error?: ResourceFailure;
}

export function openResourceView(
  scope: { projectId: string } | { instanceId: string },
  payload: OpenResourceView,
) {
  const base = {
    t: 'resource_query' as const,
    type: 'resource/open-view' as const,
    requestId: crypto.randomUUID(),
    payload: { limit: 200, ...payload },
  };
  if ('projectId' in scope) {
    return { ...base, projectId: scope.projectId };
  }
  return { ...base, instanceId: scope.instanceId };
}

export function releaseResourceView(viewId: string) {
  return {
    t: 'resource_query',
    type: 'resource/release-view',
    requestId: crypto.randomUUID(),
    payload: { viewId },
  } as const;
}

export function openResourceUpload(projectId: string, payload: OpenResourceUploadPayload) {
  const body: OpenResourceUploadPayload = { path: payload.path };
  if (payload.expectedBytes !== undefined) body.expectedBytes = payload.expectedBytes;
  if (payload.sha256 !== undefined) body.sha256 = payload.sha256;
  return {
    t: 'resource_query' as const,
    type: 'resource/open-upload' as const,
    requestId: crypto.randomUUID(),
    projectId,
    payload: body,
  };
}

/** create-only 写：默认 `ifNoneMatch: "*"`。 */
export function fsWriteFileAction(
  commandId: string,
  projectId: string,
  path: string,
  uploadId: string,
  options?: { ifMatch?: string; ifNoneMatch?: string },
) {
  const payload: Record<string, string> = { projectId, path, uploadId };
  if (options?.ifMatch !== undefined) payload.ifMatch = options.ifMatch;
  payload.ifNoneMatch = options?.ifNoneMatch ?? '*';
  return {
    t: 'action' as const,
    commandId,
    type: 'fs/write-file' as const,
    payload,
  };
}

export function openResourceFile(projectId: string, path: string) {
  return {
    t: 'resource_query',
    type: 'resource/open-blob',
    requestId: crypto.randomUUID(),
    projectId,
    payload: { kind: 'file', path },
  } as const;
}

export function openResourceGitDiff(projectId: string, repoId: string, changeId: string) {
  return {
    t: 'resource_query',
    type: 'resource/open-blob',
    requestId: crypto.randomUUID(),
    projectId,
    payload: { kind: 'git-diff', repoId, changeId },
  } as const;
}

export function gitResourceAction(
  projectId: string,
  repoId: string,
  action: GitActionKind,
  changeIds: string[],
  expectedGeneration: string,
  message?: string,
  graph?: GitGraphActionPayload,
) {
  return {
    t: 'resource_query',
    type: 'resource/git-action',
    requestId: crypto.randomUUID(),
    projectId,
    payload: {
      repoId,
      action,
      changeIds,
      expectedGeneration,
      ...(message === undefined ? {} : { message }),
      ...(graph?.targetOid === undefined ? {} : { targetOid: graph.targetOid }),
      ...(graph?.refName === undefined ? {} : { refName: graph.refName }),
      ...(graph?.newRefName === undefined ? {} : { newRefName: graph.newRefName }),
      ...(graph?.resetMode === undefined ? {} : { resetMode: graph.resetMode }),
    },
  } as const;
}

export function isResourceResult(frame: Record<string, unknown>): frame is Record<string, unknown> & ResourceResultFrame {
  if (frame.t !== 'resource_result' || typeof frame.requestId !== 'string') return false;
  if (frame.result !== undefined && frame.error !== undefined) return false;
  if (frame.error !== undefined) {
    const error = frame.error as Record<string, unknown>;
    if (!error || typeof error !== 'object' || typeof error.code !== 'string'
      || typeof error.message !== 'string' || typeof error.retryable !== 'boolean') return false;
  }
  if (frame.result !== undefined) {
    const result = frame.result as Record<string, unknown>;
    if (!result || typeof result !== 'object' || typeof result.kind !== 'string') return false;
    if (result.kind === 'view') {
      const data = result.data as Record<string, unknown>;
      if (!data || typeof data.viewId !== 'string' || typeof data.docId !== 'string'
        || !isServerDocId(data.docId) || data.docId !== `resource:${data.viewId}`
        || typeof data.leaseExpiresAt !== 'string' || !isStrictRfc3339(data.leaseExpiresAt)) return false;
    } else if (result.kind === 'blob') {
      const data = result.data as Record<string, unknown>;
      if (!data || typeof data.blobId !== 'string' || typeof data.url !== 'string'
        || !data.url.startsWith('/api/resource-blobs/') || typeof data.expiresAt !== 'string'
        || (data.etag !== undefined && typeof data.etag !== 'string')) return false;
    } else if (result.kind === 'upload') {
      const data = result.data as Record<string, unknown>;
      if (!data || typeof data.uploadId !== 'string' || typeof data.url !== 'string'
        || !data.url.startsWith('/api/resource-uploads/') || typeof data.expiresAt !== 'string') {
        return false;
      }
    } else if (result.kind !== 'released' && result.kind !== 'mutated') {
      return false;
    }
  }
  return frame.result !== undefined || frame.error !== undefined;
}
import { isServerDocId } from './doc-id';

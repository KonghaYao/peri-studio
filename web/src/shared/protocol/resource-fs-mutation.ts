export type FsMutationKind = 'create-dir' | 'move' | 'delete';

export interface FsMutationStat {
  path: string;
  kind: 'file' | 'directory';
  revision: string;
}

export interface FsMutationResult {
  primaryPath: string;
  affectedPaths: string[];
  stat?: FsMutationStat;
}

export interface FsMutationAck {
  commandId?: string;
  status?: string;
  resourceResult?: { kind: 'fs_mutation'; data: FsMutationResult };
}

export interface FsMutationError {
  commandId?: string;
  code?: string;
  message?: string;
  retryable?: boolean;
}

export interface DeleteConfirmOpened {
  confirmToken: string;
  expiresAt: string;
  summary: { path: string; kind: 'file' | 'directory'; entryCount?: number };
}

export interface DeleteConfirmResultFrame {
  t: 'resource_result';
  requestId: string;
  result?: { kind: 'delete_confirm'; data: DeleteConfirmOpened };
  error?: { code: string; message: string; retryable: boolean };
}

export function isDeleteConfirmResultFrame(value: unknown): value is DeleteConfirmResultFrame {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const frame = value as Record<string, unknown>;
  if (frame.t !== 'resource_result' || typeof frame.requestId !== 'string') return false;
  if (frame.result !== undefined && frame.error !== undefined) return false;
  if (frame.error !== undefined) {
    const error = frame.error as Record<string, unknown>;
    return !!error && typeof error === 'object' && typeof error.code === 'string'
      && typeof error.message === 'string' && typeof error.retryable === 'boolean';
  }
  const result = frame.result as Record<string, unknown> | undefined;
  const data = result?.data as Record<string, unknown> | undefined;
  const summary = data?.summary as Record<string, unknown> | undefined;
  return result?.kind === 'delete_confirm'
    && typeof data?.confirmToken === 'string'
    && typeof data.expiresAt === 'string'
    && typeof summary?.path === 'string'
    && ['file', 'directory'].includes(String(summary.kind))
    && (summary.entryCount === undefined || (Number.isSafeInteger(summary.entryCount) && Number(summary.entryCount) >= 0));
}

export function isActionResourceResult(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return false;
  const data = result.data as Record<string, unknown>;
  if (result.kind === 'fs_mutation') {
    return typeof data.primaryPath === 'string' && !!data.primaryPath.trim()
      && Array.isArray(data.affectedPaths)
      && data.affectedPaths.every((path) => typeof path === 'string');
  }
  if (result.kind === 'fs_stat') return typeof data.path === 'string' && !!data.path.trim() && typeof data.revision === 'string' && !!data.revision.trim();
  if (result.kind === 'mutation') return typeof data.generation === 'string' && !!data.generation.trim();
  return false;
}

export type FsMutationAction =
  | { t: 'action'; type: 'fs/create-dir'; commandId: string; payload: { projectId: string; path: string; ifNoneMatch: '*' } }
  | { t: 'action'; type: 'fs/move'; commandId: string; payload: { projectId: string; source: string; target: string; sourceIfMatch: string; targetIfNoneMatch: '*' } }
  | { t: 'action'; type: 'fs/delete'; commandId: string; payload: { projectId: string; path: string; ifMatch: string; recursive: boolean; useTrash: false; confirmToken?: string } };

export function fsCreateDirAction(commandId: string, projectId: string, path: string): FsMutationAction {
  return { t: 'action', type: 'fs/create-dir', commandId, payload: { projectId, path, ifNoneMatch: '*' } };
}

export function fsMoveAction(commandId: string, projectId: string, source: string, target: string, sourceIfMatch: string): FsMutationAction {
  return { t: 'action', type: 'fs/move', commandId, payload: { projectId, source, target, sourceIfMatch, targetIfNoneMatch: '*' } };
}

export function fsDeleteAction(commandId: string, projectId: string, path: string, ifMatch: string, recursive: boolean, confirmToken?: string): FsMutationAction {
  return {
    t: 'action', type: 'fs/delete', commandId,
    payload: { projectId, path, ifMatch, recursive, useTrash: false, ...(confirmToken ? { confirmToken } : {}) },
  };
}

export function openDeleteConfirm(requestId: string, projectId: string, path: string, ifMatch: string) {
  return {
    t: 'resource_query' as const,
    type: 'resource/open-delete-confirm' as const,
    requestId,
    projectId,
    payload: { path, ifMatch, recursive: true, useTrash: false },
  };
}

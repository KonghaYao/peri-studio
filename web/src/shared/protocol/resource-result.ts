import { isStrictRfc3339 } from '@/shared/lib/rfc3339';
import { isServerDocId } from '@/shared/yjs/doc-id';

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

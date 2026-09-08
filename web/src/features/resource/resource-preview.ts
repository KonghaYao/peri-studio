import type { GitGroupId } from './resource-protocol';

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

export function downloadResourceUrl(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

type Update<T> = (requestId: string, patch: Partial<T>) => void;

export async function loadGitDiff(
  url: string,
  request: ResourceDiffPreviewState,
  update: Update<ResourceDiffPreviewState>,
): Promise<void> {
  try {
    const response = await fetch(url, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'text/x-diff, text/plain;q=0.9' },
    });
    if (!response.ok) throw new Error('diff fetch failed');
    update(request.requestId, {
      loading: false, text: await response.text(), error: undefined,
      errorCode: undefined, retryable: undefined,
    });
  } catch {
    update(request.requestId, {
      loading: false,
      error: 'Unable to load this diff. Refresh Source Control and try again.',
      retryable: true,
    });
  }
}

const MAX_TEXT_PREVIEW_BYTES = 4 * 1024 * 1024;

export async function loadFilePreview(
  url: string,
  etag: string | undefined,
  request: ResourceFilePreviewState,
  update: Update<ResourceFilePreviewState>,
): Promise<void> {
  try {
    const head = await fetch(url, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' });
    if (!head.ok) throw new Error('file metadata fetch failed');
    const contentType = head.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
    const contentLength = head.headers.get('content-length');
    const parsedSize = contentLength === null ? undefined : Number(contentLength);
    const size = parsedSize !== undefined && Number.isFinite(parsedSize) ? parsedSize : undefined;
    const metadata = { url, etag, contentType, size };
    if (isRasterImage(contentType)) return update(request.requestId, { ...metadata, loading: false, mode: 'image' });
    if (!isTextPreview(request.path, contentType) && contentType !== 'application/octet-stream') {
      return update(request.requestId, { ...metadata, loading: false, mode: 'binary' });
    }
    if (size !== undefined && size > MAX_TEXT_PREVIEW_BYTES) {
      return update(request.requestId, { ...metadata, loading: false, mode: 'large' });
    }
    const response = await fetch(url, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'text/plain, application/json;q=0.9, */*;q=0.1' },
    });
    if (!response.ok) throw new Error('file fetch failed');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_TEXT_PREVIEW_BYTES) {
      return update(request.requestId, { ...metadata, size: bytes.byteLength, loading: false, mode: 'large' });
    }
    if (new Uint8Array(bytes).includes(0)) {
      return update(request.requestId, { ...metadata, size: bytes.byteLength, loading: false, mode: 'binary' });
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      update(request.requestId, { ...metadata, size: bytes.byteLength, loading: false, mode: 'text', text });
    } catch {
      update(request.requestId, { ...metadata, size: bytes.byteLength, loading: false, mode: 'binary' });
    }
  } catch {
    update(request.requestId, { loading: false, error: 'Unable to open this file. Refresh Explorer and try again.' });
  }
}

function isTextPreview(path: string, contentType: string): boolean {
  if (contentType.startsWith('text/')) return true;
  if (['application/json', 'application/javascript', 'application/xml', 'image/svg+xml'].includes(contentType)) return true;
  return /\.(?:c|cc|cpp|h|hpp|go|java|kt|kts|py|rb|php|sh|bash|zsh|fish|sql|vue|svelte|astro|xml|ini|cfg|conf|env|lock|gitignore|dockerfile)$/i.test(path);
}

function isRasterImage(contentType: string): boolean {
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'].includes(contentType);
}

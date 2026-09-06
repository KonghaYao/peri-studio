export interface UploadPutProgress {
  loaded: number;
  total: number;
}

export interface UploadPutResult {
  ok: boolean;
  status: number;
}

export interface UploadPutOptions {
  signal?: AbortSignal;
  onProgress?: (progress: UploadPutProgress) => void;
}

type XMLHttpRequestFactory = () => XMLHttpRequest;

/** 同源、cookie 认证的可取消 PUT；XHR upload 事件提供真实传输进度。 */
export function putResourceUploadBytes(
  url: string,
  body: Blob,
  options: UploadPutOptions = {},
  createRequest: XMLHttpRequestFactory = () => new XMLHttpRequest(),
): Promise<UploadPutResult> {
  if (!url.startsWith('/api/resource-uploads/')) {
    return Promise.resolve({ ok: false, status: 0 });
  }

  return new Promise((resolve, reject) => {
    const request = createRequest();
    const total = body.size;
    let settled = false;

    const cleanup = () => options.signal?.removeEventListener('abort', abort);
    const finish = (result: UploadPutResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => {
      request.abort();
      fail(new DOMException('Upload aborted', 'AbortError'));
    };

    request.open('PUT', url, true);
    request.withCredentials = true;
    request.setRequestHeader('Cache-Control', 'no-store');
    request.upload.addEventListener('progress', (event) => {
      options.onProgress?.({
        loaded: Math.min(event.loaded, total),
        total: event.lengthComputable ? event.total : total,
      });
    });
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        options.onProgress?.({ loaded: total, total });
      }
      finish({ ok: request.status >= 200 && request.status < 300, status: request.status });
    });
    request.addEventListener('error', () => fail(new Error('upload_transport_error')));
    request.addEventListener('abort', () => fail(new DOMException('Upload aborted', 'AbortError')));

    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    options.onProgress?.({ loaded: 0, total });
    request.send(body);
  });
}

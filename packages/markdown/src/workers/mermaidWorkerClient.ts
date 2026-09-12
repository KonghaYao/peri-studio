import { isMermaidEnabled } from '../optional/mermaid';

type Theme = 'light' | 'dark';

let worker: Worker | null = null;
let workerInitError: Error | null = null;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

const rpcMap = new Map<string, Pending>();
let maxConcurrency = 5;

export const MERMAID_WORKER_BUSY_CODE = 'WORKER_BUSY';
export const MERMAID_DISABLED_CODE = 'MERMAID_DISABLED';

export function setMermaidWorker(nextWorker: Worker) {
  worker = nextWorker;
  workerInitError = null;
  const current = nextWorker;

  worker.onmessage = (event: MessageEvent) => {
    if (worker !== current) return;
    const { id, ok, result, error } = event.data || {};
    const active = rpcMap.get(id);
    if (!active) return;
    if (ok === false || error) active.reject(new Error(error || 'Unknown error'));
    else active.resolve(result);
  };

  worker.onerror = (event: ErrorEvent) => {
    if (worker !== current || rpcMap.size === 0) return;
    for (const [, active] of rpcMap.entries()) active.reject(new Error(`Worker error: ${event.message}`));
    rpcMap.clear();
  };
}

function ensureWorker() {
  if (worker) return worker;
  workerInitError = new Error('Mermaid worker not configured');
  return null;
}

function callWorker<T>(action: 'canParse' | 'findPrefix', payload: { code: string; theme: Theme }, timeout = 1400): Promise<T> {
  if (!isMermaidEnabled()) {
    const error = new Error('Mermaid rendering disabled');
    (error as Error & { code?: string }).code = MERMAID_DISABLED_CODE;
    return Promise.reject(error);
  }
  if (workerInitError) return Promise.reject(workerInitError);
  const activeWorker = ensureWorker();
  if (!activeWorker) return Promise.reject(workerInitError);
  if (rpcMap.size >= maxConcurrency) {
    const error = new Error('Worker busy');
    (error as Error & { code?: string }).code = MERMAID_WORKER_BUSY_CODE;
    return Promise.reject(error);
  }

  return new Promise<T>((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (timeoutId != null) clearTimeout(timeoutId);
      rpcMap.delete(id);
    };

    rpcMap.set(id, {
      resolve: (value) => { cleanup(); resolve(value as T); },
      reject: (error) => { cleanup(); reject(error); },
    });

    try {
      activeWorker.postMessage({ id, action, payload });
    } catch (error) {
      rpcMap.delete(id);
      reject(error);
      return;
    }

    timeoutId = setTimeout(() => {
      rpcMap.get(id)?.reject(new Error('Worker call timed out'));
    }, timeout);
  });
}

export async function canParseOffthread(code: string, theme: Theme, timeout = 1400) {
  return await callWorker<boolean>('canParse', { code, theme }, timeout);
}

export async function findPrefixOffthread(code: string, theme: Theme, timeout = 1400) {
  return await callWorker<string | null>('findPrefix', { code, theme }, timeout);
}

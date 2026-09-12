import { enableMermaid } from '../optional/mermaid';
import { setMermaidWorker } from '../workers/mermaidWorkerClient';

let initialized = false;

/** 由 consumer（web / sandbox）注入 Worker 实例，避免 Vite 在 workspace 包内解析 worker 失败。 */
export function initMermaidWorker(worker: Worker) {
  if (initialized) return;
  enableMermaid();
  setMermaidWorker(worker);
  initialized = true;
}

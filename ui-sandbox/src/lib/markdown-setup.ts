import { initMermaidWorker } from '@peri/markdown';
import MermaidWorker from '@peri/markdown/worker?worker';

let ready = false;

export function setupMarkdownRuntime() {
  if (ready) return;
  initMermaidWorker(new MermaidWorker());
  ready = true;
}

import { createMemo, For, onMount, type Accessor } from 'solid-js';
import { MermaidBlock } from './MermaidBlock';
import type { CodeBlockViewComponent, MermaidBlockViewComponent } from '../types';
import { resolveParsedNodes, stabilizeNodes, type RenderableNode } from '../lib/node-helpers';
import { preprocessMarkdownSource } from '../lib/preprocess';
import { enableMermaid } from '../optional/mermaid';
import { setMermaidWorker } from '../workers/mermaidWorkerClient';
import type { MarkdownRenderContext } from './context';
import { NodeOutlet } from './NodeOutlet';

export interface MarkdownRendererProps {
  source: string | Accessor<string>;
  streaming?: boolean;
  class?: string;
  CodeBlockView: CodeBlockViewComponent;
  MermaidBlockView?: MermaidBlockViewComponent;
}

let mermaidWorkerReady = false;

function ensureMermaidWorker() {
  if (mermaidWorkerReady || typeof Worker === 'undefined') return;
  enableMermaid();
  setMermaidWorker(new Worker(new URL('../workers/mermaidParser.worker.ts', import.meta.url), { type: 'module' }));
  mermaidWorkerReady = true;
}

export function MarkdownRenderer(props: MarkdownRendererProps) {
  onMount(() => ensureMermaidWorker());

  const rawSource = () => preprocessMarkdownSource(typeof props.source === 'function' ? props.source() : props.source);
  const final = () => props.streaming !== true;
  let previousBlocks: Array<{ node: RenderableNode; signature: string }> = [];

  const context = createMemo<MarkdownRenderContext>(() => ({
    final: final(),
    CodeBlockView: props.CodeBlockView,
    MermaidBlockView: props.MermaidBlockView ?? MermaidBlock,
  }));

  const blocks = createMemo(() => {
    const nodes = resolveParsedNodes(rawSource(), {
      final: final(),
      parseOptions: { streamParse: 'auto' },
    });
    const incompleteTail = props.streaming === true && nodes.some((node) => Boolean((node as { loading?: boolean }).loading));
    const next = stabilizeNodes(nodes, previousBlocks, incompleteTail);
    previousBlocks = next;
    return next;
  });

  return (
    <div class={`markdown-body min-w-0 text-13 leading-normal text-content-primary ${props.class ?? ''}`} data-testid="markdown-body">
      <For each={blocks()}>
        {(model) => <NodeOutlet node={model.node} context={context()} indexKey={model.signature} />}
      </For>
    </div>
  );
}

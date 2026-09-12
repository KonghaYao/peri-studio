import { createEffect, createMemo, For, type Accessor } from 'solid-js';
import { MermaidBlock } from './MermaidBlock';
import type { CodeBlockViewComponent, MathExpressionViewComponent, MermaidBlockViewComponent } from '../types';
import { MathExpression } from './MathExpression';
import { useSmoothMarkdownStream } from '../hooks/useSmoothMarkdownStream';
import { resolveParsedNodes, stabilizeNodes, type RenderableNode } from '../lib/node-helpers';
import { preprocessMarkdownSource } from '../lib/preprocess';
import type { MarkdownRenderContext } from './context';
import { NodeOutlet } from './NodeOutlet';

export interface MarkdownRendererProps {
  source: string | Accessor<string>;
  /** 内容仍在写入：parser `final=false`，保留未闭合 fence/math 的 loading 态。 */
  streaming?: boolean;
  /** 启用 markstream 字符级平滑揭示（适合 Catalog Streaming demo）。 */
  smoothStreaming?: boolean;
  /** 流式阶段限制 live DOM 节点数；`final` 后展示全部。 */
  maxLiveNodes?: number;
  isDark?: boolean;
  class?: string;
  CodeBlockView: CodeBlockViewComponent;
  MermaidBlockView?: MermaidBlockViewComponent;
  MathExpressionView?: MathExpressionViewComponent;
}

export function MarkdownRenderer(props: MarkdownRendererProps) {
  const smooth = useSmoothMarkdownStream();
  const streaming = () => props.streaming === true;
  const smoothStreaming = () => props.smoothStreaming === true;
  const inputSource = () => preprocessMarkdownSource(typeof props.source === 'function' ? props.source() : props.source);

  createEffect(() => {
    const next = inputSource();
    if (!smoothStreaming()) {
      smooth.reset(next);
      if (!streaming()) smooth.finish({ flush: true });
      return;
    }
    const current = smooth.source();
    if (!next) smooth.reset('');
    else if (next === current) return;
    else if (next.startsWith(current)) smooth.enqueue(next.slice(current.length));
    else smooth.reset(next);
    if (!streaming()) smooth.finish({ flush: true });
  });

  const renderContent = createMemo(() => {
    if (!smoothStreaming()) return inputSource();
    const visible = smooth.visible();
    // 平滑揭示尚未产出首帧时，先展示已到达的源文本，避免长时间空白。
    return visible || inputSource();
  });

  const parserFinal = () => {
    if (streaming()) {
      if (smoothStreaming()) {
        return smooth.caughtUp() && smooth.final();
      }
      return false;
    }
    return true;
  };

  let previousBlocks: Array<{ node: RenderableNode; signature: string }> = [];

  const context = createMemo<MarkdownRenderContext>(() => ({
    final: parserFinal(),
    isDark: props.isDark,
    CodeBlockView: props.CodeBlockView,
    MermaidBlockView: props.MermaidBlockView ?? MermaidBlock,
    MathExpressionView: props.MathExpressionView ?? MathExpression,
  }));

  const blocks = createMemo(() => {
    const nodes = resolveParsedNodes(renderContent(), {
      final: parserFinal(),
      parseOptions: { streamParse: 'auto' },
    });
    const incompleteTail = !parserFinal() && nodes.some((node) => Boolean((node as { loading?: boolean }).loading));
    const next = stabilizeNodes(nodes, previousBlocks, incompleteTail);
    previousBlocks = next;
    return next;
  });

  const visibleBlocks = createMemo(() => {
    const all = blocks();
    const max = props.maxLiveNodes;
    if (!max || parserFinal() || all.length <= max) return all;
    return all.slice(-max);
  });

  return (
    <div class={`typeset typeset-chat min-w-0 text-13 text-content-primary ${props.class ?? ''}`} data-testid="markdown-body">
      <For each={visibleBlocks()}>
        {(model, index) => <NodeOutlet node={model.node} context={context()} indexKey={`${index()}-${model.signature}`} />}
      </For>
    </div>
  );
}

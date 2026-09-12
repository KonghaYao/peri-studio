import { MarkdownRenderer } from '@peri/markdown';
import type {
  CodeBlockViewComponent,
  MathExpressionViewComponent,
  MermaidBlockViewComponent,
} from '@peri/markdown';
import type { Accessor } from 'solid-js';
import { MarkdownCodeBlockView } from './MarkdownCodeBlockView';
import { MathExpression } from './MathExpression';
import { MermaidBlockView } from './MermaidBlockView';

export interface MarkdownBodyProps {
  source: string | Accessor<string>;
  /** 内容仍在写入：parser `final=false`，保留未闭合 fence/math 的 loading 态。 */
  streaming?: boolean;
  /** 启用 markstream 字符级平滑揭示（适合 Catalog Streaming demo）。 */
  smoothStreaming?: boolean;
  /** 流式阶段限制 live DOM 节点数；`final` 后展示全部。 */
  maxLiveNodes?: number;
  isDark?: boolean;
  class?: string;
  CodeBlockView?: CodeBlockViewComponent;
  MermaidBlockView?: MermaidBlockViewComponent;
  MathExpressionView?: MathExpressionViewComponent;
}

/**
 * T3 Markdown 渲染 seam：解析由 @peri/markdown 承担，块级呈现由 @peri/ui 默认视图注入。
 */
export function MarkdownBody(props: MarkdownBodyProps) {
  return (
    <MarkdownRenderer
      source={props.source}
      streaming={props.streaming}
      smoothStreaming={props.smoothStreaming}
      maxLiveNodes={props.maxLiveNodes}
      isDark={props.isDark}
      class={['markdown-body', props.class].filter(Boolean).join(' ')}
      CodeBlockView={props.CodeBlockView ?? MarkdownCodeBlockView}
      MermaidBlockView={props.MermaidBlockView ?? MermaidBlockView}
      MathExpressionView={props.MathExpressionView ?? MathExpression}
    />
  );
}

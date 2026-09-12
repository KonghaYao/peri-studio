import { MarkdownRenderer } from '@peri/markdown';
import type { Accessor } from 'solid-js';
import { MarkdownCodeBlockView } from './markdown/MarkdownCodeBlockView';
import { MermaidBlockView } from './markdown/MermaidBlockView';

export interface MarkdownProps {
  source: string | Accessor<string>;
  streaming?: boolean;
}

/**
 * 流式 Markdown 的唯一渲染 seam。
 *
 * 解析与节点渲染由 @peri/markdown（stream-markdown-parser）承担；
 * 代码块高亮仍由 web 侧 Shiki 注入。
 */
export function Markdown(props: MarkdownProps) {
  return (
    <MarkdownRenderer
      source={props.source}
      streaming={props.streaming}
      CodeBlockView={MarkdownCodeBlockView}
      MermaidBlockView={MermaidBlockView}
    />
  );
}

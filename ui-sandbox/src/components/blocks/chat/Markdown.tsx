import { MarkdownRenderer } from '@peri/markdown';
import type { Accessor } from 'solid-js';
import { MarkdownCodeBlockView } from './markdown/MarkdownCodeBlockView';
import { MermaidBlockView } from './markdown/MermaidBlockView';

export function Markdown(props: {
  source: string | Accessor<string>;
  class?: string;
  streaming?: boolean;
  smoothStreaming?: boolean;
}) {
  return (
    <MarkdownRenderer
      source={props.source}
      streaming={props.streaming}
      smoothStreaming={props.smoothStreaming}
      class={props.class}
      CodeBlockView={MarkdownCodeBlockView}
      MermaidBlockView={MermaidBlockView}
    />
  );
}

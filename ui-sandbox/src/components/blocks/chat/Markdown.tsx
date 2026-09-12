import { MarkdownRenderer } from '@peri/markdown';
import type { Accessor } from 'solid-js';
import { MarkdownCodeBlockView } from './markdown/MarkdownCodeBlockView';

export function Markdown(props: { source: string | Accessor<string>; class?: string; streaming?: boolean }) {
  return (
    <MarkdownRenderer
      source={props.source}
      streaming={props.streaming}
      class={props.class}
      CodeBlockView={MarkdownCodeBlockView}
    />
  );
}

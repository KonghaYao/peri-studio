import { createMemo, For, type JSX } from 'solid-js';
import { parseMarkdown } from '../lib/markdown.ts';
import { CopyButton } from '../../ui';

type InlineToken = { type: string; text?: string; href?: string; children?: InlineToken[] };
type BlockToken = { type: string; level?: number; language?: string; text?: string; children?: InlineToken[] | BlockToken[]; ordered?: boolean; items?: InlineToken[][] };

function Inline(props: { tokens: InlineToken[] }) {
  return <For each={props.tokens}>{(token): JSX.Element => {
    if (token.type === 'code') return <code class="md-inline-code py-2 px-5 border border-divider rounded-5 bg-surface-muted text-text-primary text-code">{token.text}</code>;
    if (token.type === 'strong') return <strong><Inline tokens={token.children || []} /></strong>;
    if (token.type === 'em') return <em><Inline tokens={token.children || []} /></em>;
    if (token.type === 'link') return <a href={token.href} target="_blank" rel="noopener noreferrer"><Inline tokens={token.children || []} /><span class="sr-only">(Opens in a new window)</span></a>;
    return <>{token.text}</>;
  }}</For>;
}

function CodeBlock(props: { language?: string; text: string }) {
  return <section class="md-code-block overflow-hidden my-12 border border-border-subtle rounded-11 bg-sidebar-bg">
    <div class="md-code-header flex min-h-34 items-center justify-between pr-8 pl-12 border-b border-divider text-text-secondary font-mono text-11 pointer-coarse:min-h-44"><span>{props.language || 'text'}</span><CopyButton class="min-h-30 border-0 rounded-7 bg-transparent text-text-secondary cursor-pointer font-sans text-11 hover:bg-hover hover:text-text-primary" text={props.text} label="Copy code" /></div>
    <pre class="ui-scrollbar max-h-520 m-0 p-13 px-14 overflow-auto bg-transparent text-text-primary font-mono text-12p5 leading-16"><code class="font-inherit bg-transparent text-inherit">{props.text}</code></pre>
  </section>;
}

function Heading(props: { level?: number; children: JSX.Element }) {
  if ((props.level || 1) <= 2) return <h2>{props.children}</h2>;
  if (props.level === 3) return <h3>{props.children}</h3>;
  return <h4>{props.children}</h4>;
}

function Blocks(props: { blocks: BlockToken[] }) {
  return <For each={props.blocks}>{(block): JSX.Element => {
    if (block.type === 'heading') return <Heading level={block.level}><Inline tokens={block.children as InlineToken[] || []} /></Heading>;
    if (block.type === 'code') return <CodeBlock language={block.language} text={block.text || ''} />;
    if (block.type === 'rule') return <hr />;
    if (block.type === 'quote') return <blockquote><Blocks blocks={block.children as BlockToken[] || []} /></blockquote>;
    if (block.type === 'list') {
      const items = <For each={block.items || []}>{(item) => <li><Inline tokens={item} /></li>}</For>;
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    return <p><Inline tokens={block.children as InlineToken[] || []} /></p>;
  }}</For>;
}

export function Markdown(props: { source: string }) {
  const blocks = createMemo(() => parseMarkdown(props.source) as BlockToken[]);
  return <div class="markdown-body min-w-0 text-text-primary"><Blocks blocks={blocks()} /></div>;
}

import { astToJSX, parser, RuleType, type MarkdownToJSX, type SolidOptions, type SolidOverrides } from 'markdown-to-jsx/solid';
import { createMemo, For, Show, splitProps, type Accessor, type JSX } from 'solid-js';
import { safeHref } from '../lib/markdown';
import { CodeBlock } from './markdown/CodeBlock';
import { MathExpression } from './markdown/Math';
import { SafeImage } from './markdown/SafeImage';
import { endsInsideFence, prepareMarkdownSource } from './markdown/source';
import { MarkdownTable } from './markdown/Table';

function SafeLink(props: JSX.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const href = safeHref(props.href);
  if (!href) return <span>{props.children} ({String(props.href || '')})</span>;
  if (href.startsWith('#')) return <a {...props} href={href} />;
  return <a {...props} href={href} target="_blank" rel="noopener noreferrer" />;
}

function InlineCode(props: JSX.HTMLAttributes<HTMLElement> & { resolveMath: (token: string) => string | undefined }) {
  const [local, rest] = splitProps(props, ['children', 'class', 'resolveMath']);
  const text = () => String(local.children ?? '');
  const expression = () => local.resolveMath(text());
  return expression()
    ? <MathExpression expression={expression()!} />
    : <code {...rest} class={`${local.class || ''} md-inline-code rounded-5 border border-divider bg-surface-muted px-5 py-2 text-[.88em] text-text-primary`}>{local.children}</code>;
}

export interface MarkdownProps {
  source: string | Accessor<string>;
  streaming?: boolean;
  overrides?: SolidOverrides;
}

interface MarkdownBlockModel {
  node: MarkdownToJSX.ASTNode;
  signature: string;
}

function MarkdownAstBlock(props: { model: MarkdownBlockModel; options: SolidOptions }) {
  const rendered = createMemo(() => astToJSX([props.model.node], props.options));
  return <>{rendered()}</>;
}

/**
 * 流式 Markdown 的唯一渲染 seam。
 *
 * 这里集中解析器与安全策略，富内容组件只接收已经收窄的输入；调用方只声明
 * 当前内容是否仍在写入，避免完成时从纯文本整体切换为 Markdown。
 */
export function Markdown(props: MarkdownProps) {
  const rawSource = () => typeof props.source === 'function' ? props.source() : props.source;
  const prepared = createMemo(() => prepareMarkdownSource(rawSource()));
  const source = () => prepared().source;
  const incomplete = createMemo(() => props.streaming === true && endsInsideFence(source()));
  const resolveMath = (token: string) => prepared().inlineMath.get(token);
  const options = createMemo<SolidOptions>(() => ({
    disableParsingRawHTML: true,
    enforceAtxHeadings: true,
    optimizeForStreaming: props.streaming === true,
    overrides: {
      ...props.overrides,
      a: { component: SafeLink },
      code: { component: (componentProps: JSX.HTMLAttributes<HTMLElement>) => <InlineCode {...componentProps} resolveMath={resolveMath} /> },
      img: { component: SafeImage },
      pre: { component: (componentProps: JSX.HTMLAttributes<HTMLPreElement>) => <CodeBlock {...componentProps} streaming={props.streaming} incomplete={incomplete()} /> },
      table: { component: MarkdownTable },
    },
    tagfilter: true,
    wrapper: null,
  }));
  let previousBlocks: MarkdownBlockModel[] = [];
  const document = createMemo(() => {
    const nodes = parser(source(), options());
    const references = nodes.find((node) => node.type === RuleType.refCollection);
    const contentNodes = nodes.filter((node) => node.type !== RuleType.refCollection);
    const blocks = contentNodes.map((node, index) => {
      const streamEdge = incomplete() && index === contentNodes.length - 1 ? '\u0000incomplete' : '';
      const signature = JSON.stringify(node) + streamEdge;
      const previous = previousBlocks[index];
      return previous?.signature === signature ? previous : { node, signature };
    });
    previousBlocks = blocks;
    return { blocks, references };
  });
  const footnotes = createMemo(() => document().references ? astToJSX([document().references!], options()) : null);

  return <div class="markdown-body min-w-0 text-text-primary
    [&>*:first-child]:mt-0 [&>*:last-child]:mb-0
    [&_p]:my-0 [&_p]:mb-10
    [&_h1]:mb-8 [&_h1]:mt-22 [&_h1]:text-20 [&_h1]:font-650 [&_h1]:tracking-[-.025em]
    [&_h2]:mb-7 [&_h2]:mt-20 [&_h2]:text-17 [&_h2]:font-650 [&_h2]:leading-125 [&_h2]:tracking-[-.018em]
    [&_h3]:mb-7 [&_h3]:mt-18 [&_h3]:text-15 [&_h3]:font-650 [&_h3]:leading-125
    [&_h4]:mb-7 [&_h4]:mt-18 [&_h4]:text-14 [&_h4]:font-650
    [&_h5]:mb-6 [&_h5]:mt-16 [&_h5]:font-650 [&_h6]:mb-6 [&_h6]:mt-16 [&_h6]:font-650 [&_h6]:text-text-secondary
    [&_ul]:my-7 [&_ul]:mb-12 [&_ul]:list-disc [&_ul]:pl-22
    [&_ol]:my-7 [&_ol]:mb-12 [&_ol]:list-decimal [&_ol]:pl-22
    [&_li]:my-3 [&_li]:pl-2 [&_li>ul]:mb-0 [&_li>ol]:mb-0
    [&_li:has(>input[type=checkbox])]:list-none [&_li:has(>input[type=checkbox])]:pl-0
    [&_input[type=checkbox]]:mr-8 [&_input[type=checkbox]]:h-14 [&_input[type=checkbox]]:w-14 [&_input[type=checkbox]]:accent-text-primary
    [&_blockquote]:my-10 [&_blockquote]:border-l-[3px] [&_blockquote]:border-border-strong [&_blockquote]:py-2 [&_blockquote]:pl-12 [&_blockquote]:text-text-secondary
    [&_hr]:my-18 [&_hr]:h-px [&_hr]:border-0 [&_hr]:bg-divider
    [&_a]:text-link [&_a]:underline [&_a]:decoration-link-decoration [&_a]:underline-offset-3 [&_a:hover]:decoration-current
    [&_th]:border-b [&_th]:border-divider [&_th]:bg-sidebar-bg [&_th]:px-12 [&_th]:py-8 [&_th]:font-650
    [&_td]:border-b [&_td]:border-divider [&_td]:px-12 [&_td]:py-8 [&_tbody_tr:last-child_td]:border-b-0
    [&_del]:text-text-tertiary [&_footer]:mt-16 [&_footer]:border-t [&_footer]:border-divider [&_footer]:pt-10 [&_footer]:text-12 [&_footer]:text-text-secondary
    [&_sup]:text-10 [&_sup_a]:no-underline">
    <For each={document().blocks}>{(model) => <MarkdownAstBlock model={model} options={options()} />}</For>
    <Show when={document().references}>{footnotes()}</Show>
  </div>;
}

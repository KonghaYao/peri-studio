import { astToJSX, parser, RuleType, type MarkdownToJSX, type SolidOptions, type SolidOverrides } from 'markdown-to-jsx/solid';
import { createMemo, For, Show, splitProps, type Accessor, type JSX } from 'solid-js';
import { safeHref } from '../../panel/lib/markdown';
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
    : <code {...rest} class={`md-inline-code rounded-sm border border-border-subtle bg-surface-muted px-1 py-0.5 text-[.88em] text-content-primary ${local.class || ''}`}>{local.children}</code>;
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

  return <div class="markdown-body min-w-0 text-13 leading-normal text-content-primary
    [&>*:first-child]:mt-0 [&>*:last-child]:mb-0
    [&_p]:my-0 [&_p]:mb-3
    [&_h1]:mb-2.5 [&_h1]:mt-7 [&_h1]:text-18 [&_h1]:font-semibold [&_h1]:tracking-tight
    [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-16 [&_h2]:font-semibold
    [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-15 [&_h3]:font-semibold
    [&_h4]:mb-1.5 [&_h4]:mt-5 [&_h4]:text-14 [&_h4]:font-semibold
    [&_h5]:mb-1.5 [&_h5]:mt-4 [&_h5]:font-semibold [&_h6]:mb-1.5 [&_h6]:mt-4 [&_h6]:font-semibold [&_h6]:text-content-secondary
    [&_ul]:mt-2 [&_ul]:mb-3.5 [&_ul]:list-disc [&_ul]:pl-5.5
    [&_ol]:mt-2 [&_ol]:mb-3.5 [&_ol]:list-decimal [&_ol]:pl-5.5
    [&_li]:my-1 [&_li>ul]:mt-1 [&_li>ul]:mb-0 [&_li>ol]:mt-1 [&_li>ol]:mb-0
    [&_li:has(>input[type=checkbox])]:list-none [&_li:has(>input[type=checkbox])]:pl-0
    [&_input[type=checkbox]]:mr-2 [&_input[type=checkbox]]:accent-accent-solid
    [&_blockquote]:my-3.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:py-0.5 [&_blockquote]:pl-3.5 [&_blockquote]:text-content-secondary [&_blockquote_p:last-child]:mb-0
    [&_hr]:my-6 [&_hr]:h-px [&_hr]:border-0 [&_hr]:bg-border-subtle
    [&_a]:text-content-link [&_a]:underline [&_a]:underline-offset-2
    [&_th]:border-b [&_th]:border-border-subtle [&_th]:bg-surface-muted [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold
    [&_td]:border-b [&_td]:border-border-subtle [&_td]:px-3 [&_td]:py-2 [&_tbody_tr:last-child_td]:border-b-0
    [&_del]:text-content-muted [&_footer]:mt-5 [&_footer]:border-t [&_footer]:border-border-subtle [&_footer]:pt-3 [&_footer]:text-12 [&_footer]:text-content-secondary
    [&_sup]:text-10 [&_sup_a]:no-underline [&_.md-math--block]:text-center">
    <For each={document().blocks}>{(model) => <MarkdownAstBlock model={model} options={options()} />}</For>
    <Show when={document().references}>{footnotes()}</Show>
  </div>;
}

import { astToJSX, parser, RuleType, type MarkdownToJSX, type SolidOptions, type SolidOverrides } from 'markdown-to-jsx/solid';
import { createMemo, For, Show, splitProps, type Accessor, type JSX } from 'solid-js';
import { MarkdownCodeBlock } from './markdown/CodeBlock';
import { MathExpression } from './markdown/Math';
import { SafeImage } from './markdown/SafeImage';
import { endsInsideFence, prepareMarkdownSource } from './markdown/source';
import { safeHref } from './markdown/safe';
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
    : (
      <code {...rest} class={`rounded-sm border border-border-subtle bg-surface-muted px-4 py-2 text-11p5 text-content-primary ${local.class || ''}`}>
        {local.children}
      </code>
    );
}

interface MarkdownBlockModel {
  node: MarkdownToJSX.ASTNode;
  signature: string;
}

function MarkdownAstBlock(props: { model: MarkdownBlockModel; options: SolidOptions }) {
  const rendered = createMemo(() => astToJSX([props.model.node], props.options));
  return <>{rendered()}</>;
}

export function Markdown(props: { source: string | Accessor<string>; class?: string; streaming?: boolean; overrides?: SolidOverrides }) {
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
      pre: { component: (componentProps: JSX.HTMLAttributes<HTMLPreElement>) => <MarkdownCodeBlock {...componentProps} streaming={props.streaming} incomplete={incomplete()} /> },
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

  return (
    <div class={`markdown-body min-w-0 text-13 leading-normal text-content-primary ${props.class ?? ''}`}>
      <For each={document().blocks}>{(model) => <MarkdownAstBlock model={model} options={options()} />}</For>
      <Show when={document().references}>{footnotes()}</Show>
    </div>
  );
}

import MarkdownToJsx from 'markdown-to-jsx/solid';
import { createMemo, splitProps, type JSX } from 'solid-js';
import { CodeBlock } from './markdown/CodeBlock';
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

export function Markdown(props: { source: string; class?: string; streaming?: boolean }) {
  const prepared = createMemo(() => prepareMarkdownSource(props.source));
  const source = () => prepared().source;
  const incomplete = createMemo(() => props.streaming === true && endsInsideFence(source()));
  const resolveMath = (token: string) => prepared().inlineMath.get(token);

  return (
    <div class={`markdown-body min-w-0 text-13 leading-normal text-content-primary ${props.class ?? ''}`}>
      <MarkdownToJsx
        options={{
          disableParsingRawHTML: true,
          enforceAtxHeadings: true,
          wrapper: null,
          overrides: {
            a: { component: SafeLink },
            code: { component: (p: JSX.HTMLAttributes<HTMLElement>) => <InlineCode {...p} resolveMath={resolveMath} /> },
            img: { component: SafeImage },
            pre: { component: (p: JSX.HTMLAttributes<HTMLPreElement>) => <CodeBlock {...p} streaming={props.streaming} incomplete={incomplete()} /> },
            table: { component: MarkdownTable },
          },
        }}
      >
        {source()}
      </MarkdownToJsx>
    </div>
  );
}

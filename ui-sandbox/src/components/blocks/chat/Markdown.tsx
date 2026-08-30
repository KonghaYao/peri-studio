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
      <code {...rest} class={`rounded-sm border border-border-subtle bg-surface-muted px-1 py-0.5 text-[.88em] text-content-primary ${local.class || ''}`}>
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
    <div
      class={`markdown-body min-w-0 text-13 leading-normal text-content-primary
        [&>*:first-child]:mt-0 [&>*:last-child]:mb-0
        [&_p]:my-0 [&_p]:mb-3
        [&_h1]:mb-2.5 [&_h1]:mt-7 [&_h1]:text-18 [&_h1]:font-semibold [&_h1]:tracking-tight
        [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-16 [&_h2]:font-semibold
        [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-15 [&_h3]:font-semibold
        [&_h4]:mb-1.5 [&_h4]:mt-5 [&_h4]:text-14 [&_h4]:font-semibold
        [&_ul]:mt-2 [&_ul]:mb-3.5 [&_ul]:list-disc [&_ul]:pl-5.5
        [&_ol]:mt-2 [&_ol]:mb-3.5 [&_ol]:list-decimal [&_ol]:pl-5.5
        [&_li]:my-1
        [&_li:has(>input[type=checkbox])]:list-none [&_li:has(>input[type=checkbox])]:pl-0
        [&_input[type=checkbox]]:mr-2 [&_input[type=checkbox]]:accent-accent-solid
        [&_blockquote]:my-3.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:py-0.5 [&_blockquote]:pl-3.5 [&_blockquote]:text-content-secondary [&_blockquote_p:last-child]:mb-0
        [&_hr]:my-6 [&_hr]:h-px [&_hr]:border-0 [&_hr]:bg-border-subtle
        [&_a]:text-content-link [&_a]:underline [&_a]:underline-offset-2
        [&_th]:border-b [&_th]:border-border-subtle [&_th]:bg-surface-muted [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold
        [&_td]:border-b [&_td]:border-border-subtle [&_td]:px-3 [&_td]:py-2 [&_tbody_tr:last-child_td]:border-b-0
        [&_del]:text-content-muted [&_footer]:mt-5 [&_footer]:border-t [&_footer]:border-border-subtle [&_footer]:pt-3 [&_footer]:text-12 [&_footer]:text-content-secondary
        [&_.md-math--block]:text-center
        ${props.class ?? ''}`}
    >
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

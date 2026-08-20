import MarkdownRenderer, { type SolidOptions } from 'markdown-to-jsx/solid';
import type { JSX } from 'solid-js';
import { safeHref } from '../lib/markdown';
import { CopyButton } from '../../components/ui';

function SafeLink(props: JSX.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const href = safeHref(props.href);
  if (!href) return <span>{props.children} ({String(props.href || '')})</span>;
  return <a {...props} href={href} target="_blank" rel="noopener noreferrer" />;
}

function Code(props: JSX.HTMLAttributes<HTMLElement>) {
  return <code {...props} class="md-inline-code border border-divider rounded-5 bg-surface-muted px-5 py-2 text-[.88em] text-text-primary" />;
}

function Pre(props: JSX.HTMLAttributes<HTMLPreElement>) {
  const text = String((props.children as { props?: { children?: unknown } })?.props?.children ?? props.children ?? '').replace(/\n$/, '');
  return <div class="md-code-block my-12 overflow-hidden border border-border-subtle rounded-11 bg-sidebar-bg"><CopyButton text={text} label="Copy code" class="pointer-coarse:min-h-44" /><pre {...props} class="max-h-520 m-0 overflow-auto bg-transparent px-14 py-13 text-text-primary font-mono text-12p5 leading-16 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit [&_code]:font-inherit" /></div>;
}

const options: SolidOptions = {
  disableParsingRawHTML: true,
  enforceAtxHeadings: true,
  overrides: {
    a: { component: SafeLink },
    code: { component: Code },
    pre: { component: Pre },
  },
  tagfilter: true,
  wrapper: null,
};

/**
 * 流式 Markdown 的唯一渲染 seam。
 *
 * parser 负责 CommonMark/GFM、安全 URL 与未闭合流式语法；调用方只需声明
 * 当前内容是否仍在流式写入，避免消息完成时从纯文本整体切换为 Markdown。
 */
export function Markdown(props: { source: string; streaming?: boolean }) {
  const streamingOptions = (): SolidOptions => ({
    ...options,
    optimizeForStreaming: props.streaming === true,
  });

  return <div class="markdown-body min-w-0 text-text-primary [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:mb-12 [&_p]:mt-0 [&_h2]:mt-22 [&_h2]:mb-9 [&_h2]:text-[19px] [&_h2]:leading-125 [&_h2]:tracking-[-.018em] [&_h3]:mt-22 [&_h3]:mb-9 [&_h3]:text-17 [&_h3]:leading-125 [&_h3]:tracking-[-.018em] [&_h4]:mt-22 [&_h4]:mb-9 [&_h4]:text-15 [&_h4]:leading-125 [&_h4]:tracking-[-.018em] [&_ul]:my-8 [&_ul]:mb-14 [&_ul]:list-disc [&_ul]:pl-24 [&_ol]:my-8 [&_ol]:mb-14 [&_ol]:list-decimal [&_ol]:pl-24 [&_li]:my-4 [&_li]:pl-2 [&_li>ul]:mb-0 [&_li>ol]:mb-0 [&_blockquote]:my-12 [&_blockquote]:border-l-[3px] [&_blockquote]:border-border-strong [&_blockquote]:py-2 [&_blockquote]:pl-14 [&_blockquote]:text-text-secondary [&_hr]:my-20 [&_hr]:h-px [&_hr]:border-0 [&_hr]:bg-divider [&_a]:text-link [&_a]:underline [&_a]:decoration-link-decoration [&_a]:underline-offset-3 [&_a:hover]:decoration-current">
    <MarkdownRenderer options={streamingOptions()}>{() => props.source}</MarkdownRenderer>
  </div>;
}

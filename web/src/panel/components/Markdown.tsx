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
  return <code {...props} class="md-inline-code" />;
}

function Pre(props: JSX.HTMLAttributes<HTMLPreElement>) {
  const text = String((props.children as { props?: { children?: unknown } })?.props?.children ?? props.children ?? '').replace(/\n$/, '');
  return <div class="md-code-block"><CopyButton text={text} label="Copy code" /><pre {...props} /></div>;
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

  return <div class="markdown-body min-w-0 text-text-primary">
    <MarkdownRenderer options={streamingOptions()}>{() => props.source}</MarkdownRenderer>
  </div>;
}

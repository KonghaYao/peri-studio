import MarkdownRenderer, { type SolidOptions } from 'markdown-to-jsx/solid';

const options: SolidOptions = {
  disableParsingRawHTML: true,
  enforceAtxHeadings: true,
  overrides: {
    code: { props: { class: 'md-inline-code' } },
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

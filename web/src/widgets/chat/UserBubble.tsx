import type { JSX } from 'solid-js';

/** 用户消息气泡：右对齐、浅底描边，正文不做 Markdown 解析。 */
export function UserBubble(props: { children: JSX.Element }) {
  return (
    <div class="flex w-full min-w-0 justify-end">
      <div class="min-w-0 max-w-(--chat-bubble-max) rounded-xl border-x border-b border-border-subtle bg-surface-overlay px-12 py-8 text-13 leading-normal text-content-primary">
        {props.children}
      </div>
    </div>
  );
}

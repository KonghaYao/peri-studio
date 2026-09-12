import type { Component, JSX } from 'solid-js';
import { splitProps } from 'solid-js';
import { cn } from '../lib/cn';

/** 用户消息气泡：右对齐、浅底描边，正文不做 Markdown 解析。 */
export const UserBubble: Component<{ class?: string; children: JSX.Element }> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <div class={cn('flex w-full min-w-0 justify-end', local.class)} {...rest}>
      <div class="min-w-0 max-w-(--chat-bubble-max) rounded-2xl border border-border-subtle bg-surface-overlay px-16 py-12 text-13 leading-normal text-content-primary">
        {local.children}
      </div>
    </div>
  );
};

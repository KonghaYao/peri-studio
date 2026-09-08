import type { JSX } from 'solid-js';

export function UserBubble(props: { children: JSX.Element }) {
  return (
    <div class="flex w-full min-w-0 justify-end">
      <div class="min-w-0 max-w-(--chat-bubble-max) rounded-xl border-x border-b border-border-subtle bg-surface-overlay px-3 py-2 text-13 leading-normal text-content-primary">
        {props.children}
      </div>
    </div>
  );
}

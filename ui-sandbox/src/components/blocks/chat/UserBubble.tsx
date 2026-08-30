import type { JSX } from 'solid-js';

export function UserBubble(props: { children: JSX.Element }) {
  return (
    <div class="flex justify-end">
      <div class="max-w-[72%] rounded-xl border-x border-b border-border-subtle bg-surface-overlay px-3 py-2 text-13 leading-normal text-content-primary">
        {props.children}
      </div>
    </div>
  );
}

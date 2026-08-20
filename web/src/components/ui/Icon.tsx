import type { JSX } from 'solid-js';

export interface IconProps {
  children: JSX.Element;
  size?: 'small' | 'default';
  class?: string;
}

/** Shared outline-icon canvas; feature code supplies geometry only. */
export function Icon(props: IconProps) {
  return (
    <svg
      class={`block h-18 w-18 shrink-0 overflow-visible ${props.size === 'small' ? 'h-14 w-14' : ''} ${props.class ?? ''}`.trim()}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
}

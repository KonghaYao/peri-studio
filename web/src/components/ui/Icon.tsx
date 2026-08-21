import type { JSX } from 'solid-js';

export interface IconProps {
  children: JSX.Element;
  size?: 'small' | 'default';
  class?: string;
}

/** 共享描边图标画布，业务组件只提供图形路径。 */
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

export function CopyIcon() {
  return <Icon><rect x="7" y="6" width="9" height="10" rx="2" /><path d="M13 6V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1" /></Icon>;
}

export function CheckIcon() {
  return <Icon><path d="m4 10 4 4 8-8" /></Icon>;
}

export function ErrorIcon() {
  return <Icon><circle cx="10" cy="10" r="7" /><path d="m7.5 7.5 5 5m0-5-5 5" /></Icon>;
}

export function DownloadIcon() {
  return <Icon><path d="M10 3v9m-4-4 4 4 4-4M4 16h12" /></Icon>;
}

export function ExpandIcon() {
  return <Icon><path d="M8 4H4v4m8-4h4v4M8 16H4v-4m8 4h4v-4" /></Icon>;
}

export function RefreshIcon() {
  return <Icon><path d="M15.5 7A6 6 0 0 0 5 5.5L3.5 7M4.5 13A6 6 0 0 0 15 14.5l1.5-1.5" /><path d="M3.5 3.5V7h3.5M16.5 16.5V13H13" /></Icon>;
}

export function CodeIcon() {
  return <Icon><path d="m7.5 5-5 5 5 5M12.5 5l5 5-5 5" /></Icon>;
}

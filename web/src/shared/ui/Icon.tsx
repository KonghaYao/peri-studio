import type { JSX } from 'solid-js';
import { Check, CircleX, Code2, Copy, Download, Expand, RefreshCw } from 'lucide-solid';

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
  return <Copy size={18} strokeWidth={1.7} aria-hidden="true" />;
}

export function CheckIcon() {
  return <Check size={18} strokeWidth={1.7} aria-hidden="true" />;
}

export function ErrorIcon() {
  return <CircleX size={18} strokeWidth={1.7} aria-hidden="true" />;
}

export function DownloadIcon() {
  return <Download size={18} strokeWidth={1.7} aria-hidden="true" />;
}

export function ExpandIcon() {
  return <Expand size={18} strokeWidth={1.7} aria-hidden="true" />;
}

export function RefreshIcon() {
  return <RefreshCw size={18} strokeWidth={1.7} aria-hidden="true" />;
}

export function CodeIcon() {
  return <Code2 size={18} strokeWidth={1.7} aria-hidden="true" />;
}

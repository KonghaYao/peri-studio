import { splitProps, type JSX } from 'solid-js';

export type StatusTone = 'idle' | 'ok' | 'warn' | 'err';

type Props = JSX.HTMLAttributes<HTMLDivElement> & {
  tone?: StatusTone;
  live?: boolean;
  labelHidden?: boolean;
};

const DOT_TONE_CLASS: Record<StatusTone, string> = {
  idle: 'bg-text-faint',
  ok: 'bg-success',
  warn: 'bg-warning',
  err: 'bg-danger',
};

/** Compact semantic status used by navigation and connection surfaces. */
export function Status(props: Props) {
  const [local, div] = splitProps(props, ['tone', 'live', 'labelHidden', 'class', 'children']);
  return <div {...div} role="status" aria-live={local.live ? 'polite' : undefined} class={`flex min-w-0 items-center gap-6 text-11 text-text-muted ${local.class ?? ''}`}><span class={`ui-status__dot h-7 w-7 shrink-0 rounded-full ${DOT_TONE_CLASS[local.tone ?? 'idle']}`} aria-hidden="true" /><span class={`ui-status__label overflow-hidden text-ellipsis whitespace-nowrap ${local.labelHidden ? 'sr-only' : ''}`}>{local.children}</span></div>;
}

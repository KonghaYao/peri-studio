import { splitProps, type JSX } from 'solid-js';

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'err';

const TONE_CLASS: Record<BadgeTone, string> = {
  ok: 'bg-success-soft text-success',
  warn: 'bg-warning-soft text-warning',
  err: 'bg-danger-soft text-danger',
  neutral: 'bg-surface-muted text-text-secondary',
};

export function Badge(props: JSX.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  const [local, span] = splitProps(props, ['tone', 'class', 'children']);
  return <span {...span} class={`inline-flex h-20 items-center rounded-full px-7 text-11 font-medium ${TONE_CLASS[local.tone ?? 'neutral']} ${local.class || ''}`.trim()}>{local.children}</span>;
}

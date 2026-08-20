import { Show, splitProps, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';

export type InlineNoticeTone = 'info' | 'success' | 'warning' | 'danger';

type InlineNoticeProps = JSX.HTMLAttributes<HTMLElement> & {
  tone?: InlineNoticeTone;
  title?: JSX.Element;
  live?: boolean;
  role?: 'alert' | 'status' | 'note';
};

const TONE_CLASS: Record<InlineNoticeTone, string> = {
  info: 'border-border-subtle bg-surface-muted text-text-secondary',
  success: 'border-success bg-success-soft',
  warning: 'border-warning-border bg-warning-soft',
  danger: 'border-danger-border bg-danger-soft text-danger',
};

/** Compact feedback surface for messages that remain within a feature flow. */
export function InlineNotice(props: InlineNoticeProps) {
  const [local, element] = splitProps(props, ['class', 'tone', 'title', 'live', 'role', 'children']);
  const tone = () => local.tone ?? 'info';
  const role = () => local.role ?? (tone() === 'danger' ? 'alert' : local.live ? 'status' : 'note');
  return <section {...element} role={role()} aria-live={local.live && role() !== 'alert' ? 'polite' : undefined} class={cn('flex flex-col gap-3 rounded-10 border px-12 py-10 text-12 leading-145 [&>div>:first-child]:mt-0 [&>div>:last-child]:mb-0', TONE_CLASS[tone()], local.class)}>
    <Show when={local.title}><strong class={tone() === 'danger' ? 'text-13 font-semibold text-danger' : 'text-13 font-semibold text-text-primary'}>{local.title}</strong></Show>
    <div>{local.children}</div>
  </section>;
}

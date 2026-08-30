import { AlertCircle, CheckCircle, Info, XCircle } from 'lucide-solid';
import { Show, splitProps, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '../lib/cn';

export type InlineNoticeTone = 'info' | 'success' | 'warning' | 'danger';

type InlineNoticeProps = JSX.HTMLAttributes<HTMLElement> & {
  tone?: InlineNoticeTone;
  title?: JSX.Element;
  live?: boolean;
  role?: 'alert' | 'status' | 'note';
};

const toneClasses: Record<InlineNoticeTone, { box: string; icon: string }> = {
  info: { box: 'border-border-subtle', icon: 'text-link' },
  success: { box: 'border-[color-mix(in_srgb,var(--success)_35%,var(--border-subtle))]', icon: 'text-success' },
  warning: { box: 'border-warning-border', icon: 'text-warning' },
  danger: { box: 'border-danger-border', icon: 'text-danger' },
};

const icons: Record<InlineNoticeTone, typeof Info> = {
  info: Info,
  success: CheckCircle,
  warning: AlertCircle,
  danger: XCircle,
};

/** Compact feedback surface for messages that remain within a feature flow. */
export function InlineNotice(props: InlineNoticeProps) {
  const [local, element] = splitProps(props, ['class', 'tone', 'title', 'live', 'role', 'children']);
  const tone = () => local.tone ?? 'info';
  const role = () => local.role ?? (tone() === 'danger' ? 'alert' : local.live ? 'status' : 'note');
  return (
    <section
      {...element}
      role={role()}
      aria-live={local.live && role() !== 'alert' ? 'polite' : undefined}
      class={cn('flex gap-10 rounded-8 border bg-surface px-12 py-10', toneClasses[tone()].box, local.class)}
    >
      <span class={cn('mt-px flex-none', toneClasses[tone()].icon)} aria-hidden="true">
        <Dynamic component={icons[tone()]} size={15} strokeWidth={2} />
      </span>
      <div class="min-w-0 text-13 leading-normal text-text-primary">
        <Show when={local.title}><div class="mb-2 font-medium">{local.title}</div></Show>
        <div class="text-text-secondary">{local.children}</div>
      </div>
    </section>
  );
}

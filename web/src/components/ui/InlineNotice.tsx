import { Show, splitProps, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';

export type InlineNoticeTone = 'info' | 'success' | 'warning' | 'danger';

type InlineNoticeProps = JSX.HTMLAttributes<HTMLElement> & {
  tone?: InlineNoticeTone;
  title?: JSX.Element;
  live?: boolean;
  role?: 'alert' | 'status' | 'note';
};

/** Compact feedback surface for messages that remain within a feature flow. */
export function InlineNotice(props: InlineNoticeProps) {
  const [local, element] = splitProps(props, ['class', 'tone', 'title', 'live', 'role', 'children']);
  const role = () => local.role ?? (local.tone === 'danger' ? 'alert' : local.live ? 'status' : 'note');
  return <section {...element} role={role()} aria-live={local.live && role() !== 'alert' ? 'polite' : undefined} class={cn('ui-inline-notice', `ui-inline-notice--${local.tone ?? 'info'}`, local.class)}>
    <Show when={local.title}><strong class="ui-inline-notice__title">{local.title}</strong></Show>
    <div class="ui-inline-notice__body">{local.children}</div>
  </section>;
}

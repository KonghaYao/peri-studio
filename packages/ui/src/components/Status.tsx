import { splitProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import type { BadgeTone } from './Badge';

export type StatusTone = BadgeTone | 'idle';

type ResolvedStatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const LEGACY_TONE: Record<'idle' | 'ok' | 'warn' | 'err', ResolvedStatusTone> = {
  idle: 'neutral',
  ok: 'success',
  warn: 'warning',
  err: 'danger',
};

const dotClasses: Record<ResolvedStatusTone, string> = {
  neutral: 'bg-text-faint',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-accent',
};

function resolveTone(tone: StatusTone | undefined): ResolvedStatusTone {
  if (!tone) return 'neutral';
  if (tone === 'idle' || tone === 'ok' || tone === 'warn' || tone === 'err') return LEGACY_TONE[tone];
  return tone;
}

type Props = JSX.HTMLAttributes<HTMLDivElement> & {
  tone?: StatusTone;
  live?: boolean;
  labelHidden?: boolean;
};

/** Compact semantic status used by navigation and connection surfaces. */
export function Status(props: Props) {
  const [local, div] = splitProps(props, ['tone', 'live', 'labelHidden', 'class', 'children']);
  const tone = () => resolveTone(local.tone);
  return (
    <div
      {...div}
      role="status"
      aria-live={local.live ? 'polite' : undefined}
      class={cn('inline-flex min-w-0 items-center gap-6 text-12 text-text-secondary', local.class)}
    >
      <span class="relative flex size-8 shrink-0">
        {local.live && (
          <span
            class={cn(
              'absolute inline-flex size-full animate-ping rounded-full opacity-60',
              dotClasses[tone()],
            )}
            aria-hidden="true"
          />
        )}
        <span
          class={cn('ui-status__dot relative inline-flex size-full rounded-full', dotClasses[tone()])}
          aria-hidden="true"
        />
      </span>
      <span
        class={cn(
          'ui-status__label overflow-hidden text-ellipsis whitespace-nowrap',
          local.labelHidden ? 'sr-only' : '',
        )}
      >
        {local.children}
      </span>
    </div>
  );
}

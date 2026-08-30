import { splitProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';

/* Badge 规则（对齐 sandbox T2）：文字永远是中性灰，颜色由状态点承载。 */
export type BadgeTone =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'ok'
  | 'warn'
  | 'err';

type ResolvedBadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const LEGACY_TONE: Record<'ok' | 'warn' | 'err', ResolvedBadgeTone> = {
  ok: 'success',
  warn: 'warning',
  err: 'danger',
};

const dotClasses: Record<ResolvedBadgeTone, string> = {
  neutral: 'bg-text-faint',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-accent',
};

function resolveTone(tone: BadgeTone | undefined): ResolvedBadgeTone {
  if (!tone || tone === 'neutral') return 'neutral';
  if (tone === 'ok' || tone === 'warn' || tone === 'err') return LEGACY_TONE[tone];
  return tone;
}

export function Badge(props: JSX.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  const [local, span] = splitProps(props, ['tone', 'class', 'children']);
  const tone = () => resolveTone(local.tone);
  return (
    <span
      {...span}
      data-slot="badge"
      class={cn(
        'inline-flex h-20 items-center gap-6 rounded-full border border-border-strong bg-surface px-8',
        'text-11 font-medium text-text-secondary',
        local.class,
      )}
    >
      <span
        class={cn('ui-badge__dot size-6 flex-none rounded-full', dotClasses[tone()])}
        aria-hidden="true"
      />
      {local.children}
    </span>
  );
}

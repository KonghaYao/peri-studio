import { cva } from 'class-variance-authority';
import { Show, splitProps, type JSX } from 'solid-js';
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

export type BadgeStatus = 'success' | 'processing' | 'default' | 'error' | 'warning';

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

const statusToneMap: Record<BadgeStatus, ResolvedBadgeTone> = {
  success: 'success',
  processing: 'info',
  default: 'neutral',
  error: 'danger',
  warning: 'warning',
};

const countVariants = cva(
  'z-1 flex items-center justify-center rounded-full border-2 border-surface font-medium text-white',
  {
    variants: {
      size: {
        sm: 'min-w-16 h-16 px-4 text-10',
        md: 'min-w-18 h-18 px-4 text-11',
      },
      dot: {
        true: 'size-8 min-w-8 p-0',
        false: '',
      },
    },
    defaultVariants: {
      size: 'md',
      dot: false,
    },
  },
);

function resolveTone(tone: BadgeTone | undefined): ResolvedBadgeTone {
  if (!tone || tone === 'neutral') return 'neutral';
  if (tone === 'ok' || tone === 'warn' || tone === 'err') return LEGACY_TONE[tone];
  return tone;
}

function formatCount(count: number, overflowCount?: number) {
  const limit = overflowCount ?? 99;
  if (count > limit) return `${limit}+`;
  return String(count);
}

type BadgeProps = JSX.HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  /** Ant Design 兼容：角标数字 */
  count?: number;
  overflowCount?: number;
  showZero?: boolean;
  dot?: boolean;
  status?: BadgeStatus;
  text?: JSX.Element;
  offset?: [number, number];
  size?: 'sm' | 'md';
};

export function Badge(props: BadgeProps) {
  const [local, span] = splitProps(props, [
    'tone',
    'class',
    'children',
    'count',
    'overflowCount',
    'showZero',
    'dot',
    'status',
    'text',
    'offset',
    'size',
  ]);

  const hasCount = () => local.count !== undefined || local.dot;
  const tone = () => {
    if (local.status) return statusToneMap[local.status];
    return resolveTone(local.tone);
  };
  const showCount = () => {
    if (local.dot) return true;
    if (local.count === undefined) return false;
    if (local.count === 0 && !local.showZero) return false;
    return true;
  };

  if (hasCount() && local.children) {
    const offset = local.offset ?? [0, 0];
    const indicatorStyle = {
      position: 'absolute',
      top: '0',
      right: '0',
      transform: `translate(calc(50% + ${offset[0]}px), calc(-50% + ${offset[1]}px))`,
    } as const;
    return (
      <span data-slot="badge" class={cn('relative inline-block leading-none', local.class)} {...span}>
        {local.children}
        <Show when={showCount()}>
          <span
            data-slot="badge-count"
            class={cn(
              countVariants({ size: local.size, dot: local.dot }),
              dotClasses[tone()] === 'bg-text-faint' ? 'bg-danger' : dotClasses[tone()],
            )}
            style={indicatorStyle}
          >
            <Show when={!local.dot}>{formatCount(local.count ?? 0, local.overflowCount)}</Show>
          </span>
        </Show>
      </span>
    );
  }

  if (local.status && local.text) {
    return (
      <span
        data-slot="badge-status"
        class={cn('inline-flex items-center gap-6 text-12 text-content-secondary', local.class)}
        {...span}
      >
        <span class={cn('size-8 rounded-full', dotClasses[tone()])} aria-hidden="true" />
        {local.text}
      </span>
    );
  }

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

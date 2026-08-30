import { Popover as KPopover } from '@kobalte/core/popover';
import { createMemo, createSignal, For } from 'solid-js';
import { cn } from '@/lib/cn';

function formatCount(value: number) {
  return value.toLocaleString('en-US');
}

type UsageState = 'normal' | 'warning' | 'critical';

const SEGMENTS = [
  { key: 'input', label: 'Input', tone: 'bg-content-muted' },
  { key: 'output', label: 'Output', tone: 'bg-content-primary' },
  { key: 'cached', label: 'Cached', tone: 'bg-border-strong' },
] as const;

function usageState(ratio: number): UsageState {
  if (ratio >= 0.9) return 'critical';
  if (ratio >= 0.7) return 'warning';
  return 'normal';
}

const RING_COLOR: Record<UsageState, string> = {
  normal: 'var(--feedback-success-solid)',
  warning: 'var(--feedback-warning-strong)',
  critical: 'var(--feedback-danger-solid)',
};

const STATE_LABEL: Record<UsageState, string> = {
  normal: 'Healthy',
  warning: 'Almost full',
  critical: 'Near limit',
};

/** Composer 圆环：颜色表达上下文余量；hover / 点击看分段明细。 */
export function TokenUsageMeter(props: {
  input: number;
  output: number;
  cached: number;
  /** 上下文上限，用于余量着色。 */
  limit?: number;
}) {
  const [hovering, setHovering] = createSignal(false);
  const [pinned, setPinned] = createSignal(false);
  const open = () => hovering() || pinned();
  const limit = () => props.limit ?? 200_000;
  const used = () => props.input + props.output + props.cached;
  const ratio = () => limit() > 0 ? Math.min(1, used() / limit()) : 0;
  const state = createMemo(() => usageState(ratio()));
  const remaining = () => Math.max(0, limit() - used());
  const breakdown = () => `Input ${formatCount(props.input)} · Output ${formatCount(props.output)} · Cached ${formatCount(props.cached)}`;
  const ring = createMemo(() => {
    const deg = ratio() * 360;
    const color = RING_COLOR[state()];
    if (deg <= 0 && state() === 'normal') {
      return `conic-gradient(${color} 0deg 360deg)`;
    }
    if (deg <= 0) return 'conic-gradient(var(--border-subtle) 0deg 360deg)';
    return `conic-gradient(
      ${color} 0deg ${deg}deg,
      var(--border-subtle) ${deg}deg 360deg
    )`;
  });
  const values = () => ({
    input: props.input,
    output: props.output,
    cached: props.cached,
  });

  return (
    <KPopover open={open()} onOpenChange={(next) => { if (!next) setPinned(false); }}>
      <KPopover.Trigger
        as="button"
        type="button"
        aria-label={`Context usage ${Math.round(ratio() * 100)}% · ${STATE_LABEL[state()]} · ${breakdown()}`}
        class={cn(
          'inline-flex size-(--control-height-sm) shrink-0 cursor-pointer items-center justify-center rounded-md',
          'text-content-secondary transition-colors duration-(--duration-fast)',
          'hover:bg-interaction-hover hover:text-content-primary',
          'focus-visible:shadow-(--shadow-focus-ring) focus-visible:outline-none',
          open() ? 'bg-interaction-hover text-content-primary' : 'opacity-70 hover:opacity-100',
        )}
        onPointerEnter={() => setHovering(true)}
        onPointerLeave={() => setHovering(false)}
        onClick={() => setPinned((value) => !value)}
      >
        <span
          class="rounded-full"
          style={{
            width: '14px',
            height: '14px',
            background: ring(),
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px))',
            '-webkit-mask': 'radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px))',
          }}
          aria-hidden="true"
        />
      </KPopover.Trigger>
      <KPopover.Portal>
        <KPopover.Content
          class="z-(--z-overlay) w-(--container-token-usage) rounded-md border border-border-subtle bg-surface-overlay p-2.5 shadow-overlay outline-none"
          onPointerEnter={() => setHovering(true)}
          onPointerLeave={() => setHovering(false)}
        >
          <div class="flex items-center justify-between gap-2">
            <p class="text-10 font-medium tracking-caps uppercase text-content-faint">Context usage</p>
            <span
              class={cn(
                'text-10 font-medium',
                state() === 'critical' && 'text-danger-solid',
                state() === 'warning' && 'text-warning-strong',
                state() === 'normal' && 'text-success-solid',
              )}
            >
              {STATE_LABEL[state()]}
            </span>
          </div>
          <div class="mt-2 flex items-baseline justify-between gap-2 text-12">
            <span class="text-content-muted">Used</span>
            <span class="font-mono tabular-nums text-content-primary">
              {formatCount(used())}
              <span class="text-content-faint"> / {formatCount(limit())}</span>
            </span>
          </div>
          <div class="mt-1 h-1 overflow-hidden rounded-full bg-border-subtle">
            <div
              class={cn(
                'token-usage-meter__fill h-full rounded-full',
                state() === 'critical' && 'bg-danger-solid',
                state() === 'warning' && 'bg-warning-strong',
                state() === 'normal' && 'bg-success-solid',
              )}
              style={{ width: `${Math.round(ratio() * 100)}%` }}
            />
          </div>
          <p class="mt-1 text-10 text-content-faint">{formatCount(remaining())} remaining</p>
          <dl class="mt-3 flex flex-col gap-1.5 border-t border-border-subtle pt-2">
            <p class="text-10 text-content-faint">Latest request</p>
            <For each={SEGMENTS}>
              {(segment) => (
                <div class="flex items-center gap-2 text-12">
                  <span class={cn('size-2 shrink-0 rounded-full', segment.tone)} aria-hidden="true" />
                  <dt class="flex-1 text-content-muted">{segment.label}</dt>
                  <dd class="font-mono text-11 tabular-nums text-content-primary">
                    {formatCount(values()[segment.key])}
                  </dd>
                </div>
              )}
            </For>
          </dl>
        </KPopover.Content>
      </KPopover.Portal>
    </KPopover>
  );
}

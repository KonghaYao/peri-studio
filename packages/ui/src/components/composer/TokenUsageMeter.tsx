import { Popover as KPopover } from '@kobalte/core/popover';
import { createMemo, createSignal, For, splitProps, type Component } from 'solid-js';
import { cn } from '../../lib/cn';

export type TokenUsageSnapshot = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
};

type TokenUsageMeterBaseProps = {
  limit?: number;
  contextWindow?: number | null;
  class?: string;
  'data-testid'?: string;
};

export type TokenUsageMeterProps = TokenUsageMeterBaseProps & (
  | { input: number; output: number; cached: number; usage?: never }
  | { usage: TokenUsageSnapshot; input?: never; output?: never; cached?: never }
);

function tokenValue(value: number | null | undefined): number {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

function formatCount(value: number) {
  return value.toLocaleString('en-US');
}

function formatTokenUsageLabel(input: number, output: number, cached: number) {
  return `Input ${formatCount(input)} · Output ${formatCount(output)} · Cached ${formatCount(cached)}`;
}

type UsageState = 'normal' | 'warning' | 'critical';

const SEGMENTS = [
  { key: 'input' as const, label: 'Input', tone: 'bg-content-muted' },
  { key: 'output' as const, label: 'Output', tone: 'bg-content-primary' },
  { key: 'cached' as const, label: 'Cached', tone: 'bg-border-strong' },
];

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

function resolveCounts(props: TokenUsageMeterProps) {
  if (props.usage) {
    return {
      input: tokenValue(props.usage.inputTokens),
      output: tokenValue(props.usage.outputTokens),
      cached: tokenValue(props.usage.cacheReadTokens),
    };
  }
  return {
    input: props.input ?? 0,
    output: props.output ?? 0,
    cached: props.cached ?? 0,
  };
}

/** 从 token 快照生成无障碍/标题文案。 */
export function tokenUsageLabel(usage: TokenUsageSnapshot): string {
  return formatTokenUsageLabel(
    tokenValue(usage.inputTokens),
    tokenValue(usage.outputTokens),
    tokenValue(usage.cacheReadTokens),
  );
}

/** Composer 圆环：颜色表达上下文余量；hover / 点击看分段明细。 */
export const TokenUsageMeter: Component<TokenUsageMeterProps> = (props) => {
  const [local] = splitProps(props, [
    'input',
    'output',
    'cached',
    'usage',
    'limit',
    'contextWindow',
    'class',
    'data-testid',
  ]);
  const [hovering, setHovering] = createSignal(false);
  const [pinned, setPinned] = createSignal(false);
  const open = () => hovering() || pinned();
  const counts = createMemo(() => resolveCounts(local as TokenUsageMeterProps));
  const input = () => counts().input;
  const output = () => counts().output;
  const cached = () => counts().cached;
  const limit = () => local.limit ?? local.contextWindow ?? 200_000;
  const used = () => input() + output() + cached();
  const ratio = () => limit() > 0 ? Math.min(1, used() / limit()) : 0;
  const state = createMemo(() => usageState(ratio()));
  const remaining = () => Math.max(0, limit() - used());
  const breakdown = () => formatTokenUsageLabel(input(), output(), cached());
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

  return (
    <KPopover open={open()} onOpenChange={(next) => { if (!next) setPinned(false); }}>
      <KPopover.Trigger
        as="button"
        type="button"
        data-testid={local['data-testid']}
        aria-label={`Context usage ${Math.round(ratio() * 100)}% · ${STATE_LABEL[state()]} · ${breakdown()}`}
        class={cn(
          'ui-token-usage-trigger inline-flex size-(--control-height-sm) shrink-0 cursor-pointer items-center justify-center rounded-md',
          'text-content-secondary transition-colors duration-(--duration-fast)',
          'hover:bg-interaction-hover hover:text-content-primary',
          'focus-visible:shadow-(--shadow-focus-ring) focus-visible:outline-none',
          open() ? 'bg-interaction-hover text-content-primary' : 'opacity-70 hover:opacity-100',
          local.class,
        )}
        onPointerEnter={() => setHovering(true)}
        onPointerLeave={() => setHovering(false)}
        onClick={() => setPinned((value) => !value)}
      >
        <span
          class="token-usage-meter__ring"
          style={{ background: ring() }}
          aria-hidden="true"
        />
      </KPopover.Trigger>
      <KPopover.Portal>
        <KPopover.Content
          class="z-(--z-overlay) w-(--container-token-usage) rounded-md border border-border-subtle bg-surface-overlay p-10 shadow-overlay outline-none"
          onPointerEnter={() => setHovering(true)}
          onPointerLeave={() => setHovering(false)}
        >
          <div class="flex items-center justify-between gap-8">
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
          <div class="mt-8 flex items-baseline justify-between gap-8 text-12">
            <span class="text-content-muted">Used</span>
            <span class="font-mono tabular-nums text-content-primary">
              {formatCount(used())}
              <span class="text-content-faint"> / {formatCount(limit())}</span>
            </span>
          </div>
          <div class="mt-4 h-4 overflow-hidden rounded-full bg-border-subtle">
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
          <p class="mt-4 text-10 text-content-faint">{formatCount(remaining())} remaining</p>
          <dl class="mt-12 flex flex-col gap-6 border-t border-border-subtle pt-8">
            <p class="text-10 text-content-faint">Latest request</p>
            <For each={SEGMENTS}>
              {(segment) => (
                <div class="flex items-center gap-8 text-12">
                  <span class={cn('size-8 shrink-0 rounded-full', segment.tone)} aria-hidden="true" />
                  <dt class="flex-1 text-content-muted">{segment.label}</dt>
                  <dd class="font-mono text-11 tabular-nums text-content-primary">
                    {formatCount(segment.key === 'input' ? input() : segment.key === 'output' ? output() : cached())}
                  </dd>
                </div>
              )}
            </For>
          </dl>
        </KPopover.Content>
      </KPopover.Portal>
    </KPopover>
  );
};

import type { AgentInfo } from '@/entities/chat/control-view';

type TokenUsage = NonNullable<AgentInfo['latestUsage']>;

function tokenValue(value: number | null): number {
  return value !== null && Number.isFinite(value) && value > 0 ? value : 0;
}

export function tokenUsageLabel(usage: TokenUsage): string {
  const input = tokenValue(usage.inputTokens);
  const output = tokenValue(usage.outputTokens);
  const cached = tokenValue(usage.cacheReadTokens);
  return `Input ${input.toLocaleString('en-US')} · Output ${output.toLocaleString('en-US')} · Cached ${cached.toLocaleString('en-US')}`;
}

export function TokenUsageMeter(props: { usage: TokenUsage }) {
  const input = () => tokenValue(props.usage.inputTokens);
  const output = () => tokenValue(props.usage.outputTokens);
  const cached = () => tokenValue(props.usage.cacheReadTokens);
  const total = () => input() + output() + cached();
  const share = (value: number) => total() > 0 ? `${value / total() * 100}%` : '0%';
  const label = () => tokenUsageLabel(props.usage);

  return <div class="composer-usage flex h-10 w-48 min-w-0 items-center opacity-45 transition-opacity duration-120 hover:opacity-75 max-middle:ml-auto max-tight:hidden" role="img" aria-label={label()} title={`Latest request · ${label()}`}>
    <span class="composer-usage__track flex h-4 w-48 overflow-hidden rounded-full bg-divider" aria-hidden="true">
      <span class="composer-usage__segment h-full bg-text-muted" style={{ width: share(input()) }} />
      <span class="composer-usage__segment h-full bg-text-primary" style={{ width: share(output()) }} />
      <span class="composer-usage__segment h-full bg-border-strong" style={{ width: share(cached()) }} />
    </span>
  </div>;
}

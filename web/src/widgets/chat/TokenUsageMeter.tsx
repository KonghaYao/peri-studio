import {
  TokenUsageMeter as TokenUsageMeterBase,
  tokenUsageLabel,
  type TokenUsageMeterProps,
  type TokenUsageSnapshot,
} from '@peri/ui';

/** Composer token 用量圆环（生产默认 test id）。 */
export function TokenUsageMeter(props: TokenUsageMeterProps) {
  return <TokenUsageMeterBase data-testid="composer-usage" {...props} />;
}

export { tokenUsageLabel, type TokenUsageMeterProps, type TokenUsageSnapshot };

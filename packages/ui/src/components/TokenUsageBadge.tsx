import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import { formatTokenUsageLabel } from './monitor/format';
import { Badge } from './Badge';

export type TokenUsageBadgeProps = {
  inputUsage: number;
  outputUsage: number;
  totalUsage: number;
  inline?: boolean;
  rightIcon?: JSX.Element;
  class?: string;
  'data-testid'?: string;
};

/** T2 · 表格行 token 摘要徽章；与 Composer `TokenUsageMeter` 互补。 */
export const TokenUsageBadge: Component<TokenUsageBadgeProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'inputUsage',
    'outputUsage',
    'totalUsage',
    'inline',
    'rightIcon',
    'class',
  ]);

  const hidden = () => local.inputUsage === 0 && local.outputUsage === 0 && local.totalUsage === 0;
  const label = () => formatTokenUsageLabel(local.inputUsage, local.outputUsage, local.totalUsage);

  return (
    <Show when={!hidden()}>
      <Show
        when={local.inline}
        fallback={(
          <Badge {...rest} class={cn('gap-4 font-mono text-11', local.class)}>
            <span>{label()}</span>
            <Show when={local.rightIcon}>{local.rightIcon}</Show>
          </Badge>
        )}
      >
        <span {...rest} class={cn('inline-flex items-center gap-4 font-mono text-11 text-content-secondary', local.class)}>
          {label()}
          <Show when={local.rightIcon}>{local.rightIcon}</Show>
        </span>
      </Show>
    </Show>
  );
};

import { Show, splitProps, type Component } from 'solid-js';
import { cn } from '../lib/cn';
import { Tooltip, TooltipContent, TooltipTrigger } from './Tooltip';

export type TruncatedIdCellProps = {
  value: string;
  class?: string;
  /** 为 true 时用 Tooltip 展示全值；默认 native title。 */
  tooltip?: boolean;
  'data-testid'?: string;
};

const cellClass = (className?: string) => cn(
  'inline-block min-w-0 max-w-full truncate rounded py-2 text-12 text-content-primary',
  className,
);

/** T2 · 表格 id/name 单行省略，hover 展示完整值。 */
export const TruncatedIdCell: Component<TruncatedIdCellProps> = (props) => {
  const [local, rest] = splitProps(props, ['value', 'class', 'tooltip']);

  return (
    <Show
      when={local.tooltip}
      fallback={(
        <span {...rest} title={local.value} class={cellClass(local.class)}>
          {local.value}
        </span>
      )}
    >
      <Tooltip>
        <TooltipTrigger as="span" {...rest} class={cellClass(local.class)}>
          {local.value}
        </TooltipTrigger>
        <TooltipContent>{local.value}</TooltipContent>
      </Tooltip>
    </Show>
  );
};

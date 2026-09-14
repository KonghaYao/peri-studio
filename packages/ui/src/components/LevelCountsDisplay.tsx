import { createMemo, For, Show, splitProps, type Component } from 'solid-js';
import { cn } from '../lib/cn';
import { formatLevelCountNumber, type LevelCountEntry } from '../lib/monitor-level-symbols';
import { Separator } from './Separator';
import { Skeleton } from './Skeleton';

export type LevelCount = LevelCountEntry;

export type LevelCountsDisplayProps = {
  counts: LevelCount[];
  isLoading?: boolean;
  class?: string;
  'data-testid'?: string;
};

/** T2 · 非零 observation level 计数横排（emoji + 数值）。 */
export const LevelCountsDisplay: Component<LevelCountsDisplayProps> = (props) => {
  const [local, rest] = splitProps(props, ['counts', 'isLoading', 'class']);
  const visibleCounts = createMemo(() => local.counts.filter((item) => item.count > 0));

  return (
    <Show
      when={!local.isLoading}
      fallback={
        <div class={cn('flex min-h-24 items-center', local.class)} {...rest}>
          <Skeleton class="h-16 w-1/2" />
        </div>
      }
    >
      <div
        {...rest}
        class={cn(
          'flex min-h-24 flex-row items-center gap-8 overflow-x-auto whitespace-nowrap',
          local.class,
        )}
      >
        <For each={visibleCounts()}>
          {(item, index) => (
            <>
              <div class="flex min-w-max flex-row gap-8">
                <span class="text-12 tabular-nums text-content-primary">
                  {item.symbol}{' '}
                  {item.customNumberFormatter
                    ? item.customNumberFormatter(item.count)
                    : formatLevelCountNumber(item.count)}
                </span>
              </div>
              <Show when={index() < visibleCounts().length - 1}>
                <Separator orientation="vertical" class="h-20" />
              </Show>
            </>
          )}
        </For>
      </div>
    </Show>
  );
};

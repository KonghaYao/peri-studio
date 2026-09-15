import { For, splitProps, type Component } from 'solid-js';
import { cn } from '../../lib/cn';
import type { ChartLegendProps } from './chart-types';

/** Chart series legend with bar/line swatches. */
export const ChartLegend: Component<ChartLegendProps> = (props) => {
  const [local, rest] = splitProps(props, ['items', 'class']);
  return (
    <div
      data-slot="chart-legend"
      class={cn('ui-chart-legend mt-8 flex flex-wrap gap-16 text-12 text-content-muted', local.class)}
      {...rest}
    >
      <For each={local.items}>
        {(item) => (
          <span class="inline-flex items-center gap-6">
            <span
              class={cn(
                item.shape === 'line' ? 'h-2 w-12 rounded-full' : 'h-8 w-8 rounded-sm',
              )}
              style={{ background: item.color }}
            />
            {item.label}
          </span>
        )}
      </For>
    </div>
  );
};

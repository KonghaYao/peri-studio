import { For, splitProps, type Component } from 'solid-js';
import { cn } from '../../lib/cn';
import { CHART_WIDTH, DEFAULT_CHART_HEIGHT, describeArc } from './chart-scale';
import { ChartPlot } from './ChartPlot';
import type { ChartDonutProps } from './chart-types';

/** Donut chart with segment legend. */
export const ChartDonut: Component<ChartDonutProps> = (props) => {
  const [local, rest] = splitProps(props, ['segments', 'height', 'width', 'class']);

  const height = () => local.height ?? DEFAULT_CHART_HEIGHT;
  const width = () => local.width ?? CHART_WIDTH;
  const cx = () => width() / 2;
  const cy = () => height() / 2;
  const outer = 88;
  const inner = 56;
  const total = () => local.segments.reduce((sum, segment) => sum + segment.value, 0);
  const arcs = () => {
    let cursor = 0;
    return local.segments.map((segment) => {
      const start = (cursor / Math.max(total(), 1)) * 360;
      cursor += segment.value;
      const end = (cursor / Math.max(total(), 1)) * 360;
      return { ...segment, start, end };
    });
  };

  return (
    <div
      data-slot="chart-donut"
      class={cn(
        'ui-chart-donut flex flex-col items-center gap-16 sm:flex-row sm:items-center sm:justify-center',
        local.class,
      )}
      {...rest}
    >
      <ChartPlot height={height()} width={width()} class="h-224 w-full max-w-xs overflow-hidden">
        <For each={arcs()}>
          {(arc) => (
            <path
              class="ui-chart-donut-segment"
              d={describeArc(cx(), cy(), outer, inner, arc.start, Math.max(arc.end - 0.4, arc.start))}
              fill={arc.color}
              fill-opacity={arc.opacity ?? 0.9}
            />
          )}
        </For>
      </ChartPlot>
      <ul class="flex flex-wrap justify-center gap-12 text-12 text-content-secondary">
        <For each={local.segments}>
          {(segment) => (
            <li class="inline-flex items-center gap-6">
              <span
                class="h-8 w-8 rounded-full"
                style={{ background: segment.color, opacity: segment.opacity ?? 0.9 }}
              />
              {segment.label}
            </li>
          )}
        </For>
      </ul>
    </div>
  );
};

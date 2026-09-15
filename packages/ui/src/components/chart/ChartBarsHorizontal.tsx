import { For, splitProps, type Component } from 'solid-js';
import { cn } from '../../lib/cn';
import { axisTicks, CHART_WIDTH, DEFAULT_CHART_HEIGHT, HORIZONTAL_BAR_CHART_MARGIN, linearScale, niceMax } from './chart-scale';
import { ChartLegend } from './ChartLegend';
import { ChartPlot } from './ChartPlot';
import type { ChartBarsHorizontalProps } from './chart-types';

/** Horizontal grouped bar chart with shared x-axis. */
export const ChartBarsHorizontal: Component<ChartBarsHorizontalProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'labels',
    'series',
    'height',
    'width',
    'formatX',
    'class',
  ]);

  const height = () => local.height ?? DEFAULT_CHART_HEIGHT;
  const width = () => local.width ?? CHART_WIDTH;
  const margin = () => HORIZONTAL_BAR_CHART_MARGIN;
  const innerWidth = () => width() - margin().left - margin().right;
  const innerHeight = () => height() - margin().top - margin().bottom;
  const maxValue = () => niceMax(Math.max(0, ...local.series.flatMap((serie) => serie.values)));
  const xScale = () => linearScale(0, maxValue(), margin().left, margin().left + innerWidth());
  const xTicks = () => axisTicks(0, maxValue());
  const rowHeight = () => innerHeight() / Math.max(local.labels.length, 1);
  const barHeight = () => Math.min(14, rowHeight() * 0.35);
  const formatX = (value: number) => local.formatX?.(value) ?? String(Math.round(value));

  return (
    <div data-slot="chart-bars-horizontal" class={cn('ui-chart-bars-horizontal', local.class)} {...rest}>
      <ChartPlot height={height()} width={width()}>
        <For each={xTicks()}>
          {(tick) => (
            <>
              <line
                class="ui-chart-grid-line"
                x1={xScale()(tick)}
                x2={xScale()(tick)}
                y1={margin().top}
                y2={margin().top + innerHeight()}
              />
              <text
                class="ui-chart-axis-label"
                x={xScale()(tick)}
                y={height() - 8}
                text-anchor="middle"
              >
                {formatX(tick)}
              </text>
            </>
          )}
        </For>
        <For each={local.labels}>
          {(label, rowIndex) => {
            const yCenter = () => margin().top + rowIndex() * rowHeight() + rowHeight() / 2;
            return (
              <>
                <text
                  class="ui-chart-axis-label"
                  x={margin().left - 8}
                  y={yCenter()}
                  text-anchor="end"
                  dominant-baseline="middle"
                >
                  {label.length > 18 ? `${label.slice(0, 16)}…` : label}
                </text>
                <For each={local.series}>
                  {(serie, serieIndex) => {
                    const value = () => serie.values[rowIndex()] ?? 0;
                    const offset = () =>
                      (serieIndex() - (local.series.length - 1) / 2) * barHeight();
                    return (
                      <rect
                        class="ui-chart-bar"
                        x={margin().left}
                        y={yCenter() + offset() - barHeight() / 2}
                        width={Math.max(xScale()(value()) - margin().left, 0)}
                        height={barHeight()}
                        fill={serie.color}
                        rx="3"
                      />
                    );
                  }}
                </For>
              </>
            );
          }}
        </For>
      </ChartPlot>
      <ChartLegend
        items={local.series.map((serie) => ({
          label: serie.name,
          color: serie.color,
          shape: 'bar' as const,
        }))}
      />
    </div>
  );
};

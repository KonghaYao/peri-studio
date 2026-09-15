import { For, Show, splitProps, type Component } from 'solid-js';
import { cn } from '../../lib/cn';
import {
  axisDomainFromLayers,
  buildAxisScale,
  ChartCartesianContext,
  polylinePoints,
  usePlotLayout,
  type RegisteredBarLayer,
  type RegisteredLineLayer,
} from './chart-context';
import { formatChartCompact } from './chart-format';
import { ChartLegend } from './ChartLegend';
import { ChartPlot } from './ChartPlot';
import type { ChartCartesianProps, ChartLegendItem } from './chart-types';
import { bandSlot, CHART_WIDTH, DEFAULT_CHART_MARGIN } from './chart-scale';

function defaultFormatX(label: string) {
  return label;
}

/** Cartesian chart shell: shared axes, grid, and registered bar/line layers. */
export const ChartCartesian: Component<ChartCartesianProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'labels',
    'height',
    'width',
    'margin',
    'formatX',
    'class',
    'children',
  ]);

  const height = () => local.height ?? 256;
  const width = () => local.width ?? CHART_WIDTH;
  const margin = () => local.margin ?? DEFAULT_CHART_MARGIN;
  const formatX = () => local.formatX ?? defaultFormatX;

  const layers = {
    bars: [] as RegisteredBarLayer[],
    lines: [] as RegisteredLineLayer[],
  };

  const ctx = {
    labels: () => local.labels,
    height,
    width,
    margin,
    formatX,
    registerBars: (layer: RegisteredBarLayer) => {
      layers.bars.push(layer);
    },
    registerLines: (layer: RegisteredLineLayer) => {
      layers.lines.push(layer);
    },
    barLayers: () => layers.bars,
    lineLayers: () => layers.lines,
  };

  const layout = usePlotLayout(height, margin, width);

  const leftLayers = () => [
    ...layers.bars.filter((layer) => layer.axis === 'left'),
    ...layers.lines.filter((layer) => layer.axis === 'left'),
  ];
  const rightLayers = () => [
    ...layers.bars.filter((layer) => layer.axis === 'right'),
    ...layers.lines.filter((layer) => layer.axis === 'right'),
  ];

  const leftAxis = () =>
    buildAxisScale(axisDomainFromLayers(leftLayers()), layout.plotBottom(), margin().top);
  const rightAxis = () =>
    buildAxisScale(axisDomainFromLayers(rightLayers()), layout.plotBottom(), margin().top);

  const leftFormatY = () => {
    const layer = layers.lines.find((entry) => entry.axis === 'left' && entry.formatY);
    return layer?.formatY ?? ((value: number) => String(Math.round(value)));
  };

  const rightFormatY = () => {
    const layer = layers.lines.find((entry) => entry.axis === 'right' && entry.formatY);
    return layer?.formatY ?? formatChartCompact;
  };

  const legendItems = (): ChartLegendItem[] => {
    const items: ChartLegendItem[] = [];
    for (const layer of layers.bars) {
      for (const serie of layer.series) {
        if (serie.name) {
          items.push({ label: serie.name, color: serie.color, shape: 'bar' });
        }
      }
    }
    for (const layer of layers.lines) {
      for (const serie of layer.series) {
        if (serie.name) {
          items.push({ label: serie.name, color: serie.color, shape: 'line' });
        }
      }
    }
    return items;
  };

  return (
    <ChartCartesianContext.Provider value={ctx}>
      {local.children}
      <div data-slot="chart-cartesian" class={cn('ui-chart-cartesian', local.class)} {...rest}>
        <ChartPlot height={height()} width={width()}>
          <For each={leftAxis().ticks}>
            {(tick) => (
              <line
                class="ui-chart-grid-line"
                x1={margin().left}
                x2={width() - margin().right}
                y1={leftAxis().scale(tick)}
                y2={leftAxis().scale(tick)}
              />
            )}
          </For>
          <For each={leftAxis().ticks}>
            {(tick) => (
              <text
                class="ui-chart-axis-label"
                x={margin().left - 6}
                y={leftAxis().scale(tick)}
                text-anchor="end"
                dominant-baseline="middle"
              >
                {leftFormatY()(tick)}
              </text>
            )}
          </For>
          <Show when={rightLayers().length > 0}>
            <For each={rightAxis().ticks}>
              {(tick) => (
                <text
                  class="ui-chart-axis-label"
                  x={width() - 8}
                  y={rightAxis().scale(tick)}
                  text-anchor="end"
                  dominant-baseline="middle"
                >
                  {rightFormatY()(tick)}
                </text>
              )}
            </For>
          </Show>
          <For each={local.labels}>
            {(label, labelIndex) => (
              <text
                class="ui-chart-axis-label"
                x={layout.xCenterAt(labelIndex(), local.labels.length)}
                y={height() - 10}
                text-anchor="middle"
              >
                {formatX()(label)}
              </text>
            )}
          </For>
          <For each={layers.bars}>
            {(layer) => {
              const yScale = () =>
                layer.axis === 'right' ? rightAxis().scale : leftAxis().scale;
              return (
                <For each={local.labels}>
                  {(_, labelIndex) => {
                    const slot = () =>
                      bandSlot(labelIndex(), local.labels.length, layout.innerWidth());
                    const groupWidth = () => slot().width / Math.max(layer.series.length, 1);
                    return (
                      <For each={layer.series}>
                        {(serie, serieIndex) => {
                          const value = () => serie.values[labelIndex()] ?? 0;
                          const barX = () =>
                            margin().left + slot().x + serieIndex() * groupWidth();
                          const barTop = () => yScale()(value());
                          const barHeight = () =>
                            Math.max(layout.plotBottom() - barTop(), 0);
                          return (
                            <rect
                              class="ui-chart-bar"
                              x={barX()}
                              y={barTop()}
                              width={Math.max(groupWidth() * 0.9, 1)}
                              height={barHeight()}
                              fill={serie.color}
                              fill-opacity={serie.opacity ?? 0.85}
                              rx="2"
                            />
                          );
                        }}
                      </For>
                    );
                  }}
                </For>
              );
            }}
          </For>
          <For each={layers.lines}>
            {(layer) => {
              const yScale = () =>
                layer.axis === 'right' ? rightAxis().scale : leftAxis().scale;
              const xAt = (index: number) => layout.xCenterAt(index, local.labels.length);
              return (
                <For each={layer.series}>
                  {(serie) => (
                    <polyline
                      class="ui-chart-line"
                      fill="none"
                      stroke={serie.color}
                      stroke-width="2"
                      points={polylinePoints(serie.values, xAt, yScale())}
                    />
                  )}
                </For>
              );
            }}
          </For>
        </ChartPlot>
        <Show when={legendItems().length > 0}>
          <ChartLegend items={legendItems()} />
        </Show>
      </div>
    </ChartCartesianContext.Provider>
  );
};

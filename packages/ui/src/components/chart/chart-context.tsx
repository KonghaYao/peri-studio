import { createContext, useContext, type Accessor } from 'solid-js';
import type { ChartAxisSide, ChartBarSeries, ChartLineSeries } from './chart-types';
import {
  axisTicks,
  bandSlot,
  CHART_WIDTH,
  DEFAULT_CHART_MARGIN,
  linearScale,
  niceMax,
  polylinePoints,
  type ChartMargin,
} from './chart-scale';

export type RegisteredBarLayer = {
  axis: ChartAxisSide;
  series: ChartBarSeries[];
  domain?: [number, number];
};

export type RegisteredLineLayer = {
  axis: ChartAxisSide;
  series: ChartLineSeries[];
  domain?: [number, number];
  formatY?: (value: number) => string;
};

export type ChartCartesianContextValue = {
  labels: Accessor<string[]>;
  height: Accessor<number>;
  width: Accessor<number>;
  margin: Accessor<ChartMargin>;
  formatX: Accessor<(label: string) => string>;
  registerBars: (layer: RegisteredBarLayer) => void;
  registerLines: (layer: RegisteredLineLayer) => void;
  barLayers: Accessor<RegisteredBarLayer[]>;
  lineLayers: Accessor<RegisteredLineLayer[]>;
};

export const ChartCartesianContext = createContext<ChartCartesianContextValue>();

export function useChartCartesianContext() {
  const ctx = useContext(ChartCartesianContext);
  if (!ctx) {
    throw new Error('Chart series must be rendered inside Chart.Cartesian');
  }
  return ctx;
}

export function usePlotLayout(
  height: Accessor<number>,
  margin: Accessor<ChartMargin>,
  width: Accessor<number>,
) {
  const innerWidth = () => width() - margin().left - margin().right;
  const innerHeight = () => height() - margin().top - margin().bottom;
  const plotBottom = () => margin().top + innerHeight();
  const xCenterAt = (index: number, count: number) => {
    const slot = bandSlot(index, count, innerWidth());
    return margin().left + slot.x + slot.width / 2;
  };
  return { innerWidth, innerHeight, plotBottom, xCenterAt };
}

export function axisDomainFromLayers(
  layers: Array<{ series: Array<{ values: number[] }>; domain?: [number, number] }>,
): [number, number] {
  const explicit = layers.find((layer) => layer.domain)?.domain;
  if (explicit) return explicit;
  const maxValue = Math.max(0, ...layers.flatMap((layer) => layer.series.flatMap((s) => s.values)));
  return [0, niceMax(maxValue)];
}

export function buildAxisScale(
  domain: [number, number],
  plotBottom: number,
  marginTop: number,
) {
  const scale = linearScale(domain[0], domain[1], plotBottom, marginTop);
  const ticks = axisTicks(domain[0], domain[1]);
  return { scale, ticks, domain };
}

export { CHART_WIDTH, DEFAULT_CHART_MARGIN, polylinePoints };

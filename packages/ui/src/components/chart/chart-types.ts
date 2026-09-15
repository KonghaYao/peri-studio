import type { JSX } from 'solid-js';
import type { ChartMargin } from './chart-scale';

export type ChartAxisSide = 'left' | 'right';

export type ChartBarSeries = {
  key?: string;
  name?: string;
  color: string;
  values: number[];
  opacity?: number;
};

export type ChartLineSeries = {
  name?: string;
  color: string;
  values: number[];
};

export type ChartLegendItem = {
  label: string;
  color: string;
  shape?: 'bar' | 'line';
};

export type ChartDonutSegment = {
  label: string;
  value: number;
  color: string;
  opacity?: number;
};

export type ChartCartesianProps = {
  labels: string[];
  height?: number;
  width?: number;
  margin?: ChartMargin;
  formatX?: (label: string) => string;
  class?: string;
  children?: JSX.Element;
};

export type ChartBarsProps = {
  axis?: ChartAxisSide;
  series: ChartBarSeries[];
  domain?: [number, number];
};

export type ChartLineProps = {
  axis?: ChartAxisSide;
  series: ChartLineSeries[];
  domain?: [number, number];
  formatY?: (value: number) => string;
};

export type ChartBarsHorizontalProps = {
  labels: string[];
  series: Array<{ name: string; color: string; values: number[] }>;
  height?: number;
  width?: number;
  formatX?: (value: number) => string;
  class?: string;
};

export type ChartDonutProps = {
  segments: ChartDonutSegment[];
  height?: number;
  width?: number;
  class?: string;
};

export type ChartLegendProps = {
  items: ChartLegendItem[];
  class?: string;
};

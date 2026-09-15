import { type Component } from 'solid-js';
import { useChartCartesianContext } from './chart-context';
import type { ChartLineProps } from './chart-types';

/** Registers line series inside Chart.Cartesian (rendered by parent). */
export const ChartLine: Component<ChartLineProps> = (props) => {
  const ctx = useChartCartesianContext();
  ctx.registerLines({
    axis: props.axis ?? 'left',
    series: props.series,
    domain: props.domain,
    formatY: props.formatY,
  });
  return null;
};

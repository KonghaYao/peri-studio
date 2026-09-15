import { type Component } from 'solid-js';
import { useChartCartesianContext } from './chart-context';
import type { ChartBarsProps } from './chart-types';

/** Registers vertical bar series inside Chart.Cartesian (rendered by parent). */
export const ChartBars: Component<ChartBarsProps> = (props) => {
  const ctx = useChartCartesianContext();
  ctx.registerBars({
    axis: props.axis ?? 'left',
    series: props.series,
    domain: props.domain,
  });
  return null;
};

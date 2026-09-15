import { ChartBars } from './ChartBars';
import { ChartBarsHorizontal } from './ChartBarsHorizontal';
import { ChartCartesian } from './ChartCartesian';
import { ChartDonut } from './ChartDonut';
import { ChartLegend } from './ChartLegend';
import { ChartLine } from './ChartLine';

export { ChartBars } from './ChartBars';
export { ChartBarsHorizontal } from './ChartBarsHorizontal';
export { ChartCartesian } from './ChartCartesian';
export { ChartDonut } from './ChartDonut';
export { ChartLegend } from './ChartLegend';
export { ChartLine } from './ChartLine';
export { ChartPlot } from './ChartPlot';
export { formatChartCompact } from './chart-format';
export {
  ACTIVITY_CHART_HEIGHT,
  axisTicks,
  bandSlot,
  CHART_WIDTH,
  DEFAULT_CHART_HEIGHT,
  DEFAULT_CHART_MARGIN,
  DUAL_AXIS_CHART_MARGIN,
  HORIZONTAL_BAR_CHART_MARGIN,
  linearScale,
  niceMax,
  polylinePoints,
  type ChartMargin,
} from './chart-scale';
export type {
  ChartAxisSide,
  ChartBarSeries,
  ChartBarsHorizontalProps,
  ChartBarsProps,
  ChartCartesianProps,
  ChartDonutProps,
  ChartDonutSegment,
  ChartLegendItem,
  ChartLegendProps,
  ChartLineProps,
  ChartLineSeries,
} from './chart-types';

/** Namespace export for dashboard-style composition. */
export const Chart = {
  Cartesian: ChartCartesian,
  Bars: ChartBars,
  Line: ChartLine,
  BarsHorizontal: ChartBarsHorizontal,
  Donut: ChartDonut,
  Legend: ChartLegend,
};

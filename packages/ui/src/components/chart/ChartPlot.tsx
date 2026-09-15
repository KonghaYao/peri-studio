import { splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { CHART_WIDTH } from './chart-scale';

export type ChartPlotProps = {
  height: number;
  width?: number;
  class?: string;
  children: JSX.Element;
};

/** Responsive SVG viewport for chart primitives. */
export const ChartPlot: Component<ChartPlotProps> = (props) => {
  const [local, rest] = splitProps(props, ['height', 'width', 'class', 'children']);
  const width = () => local.width ?? CHART_WIDTH;
  return (
    <div
      data-slot="chart-plot"
      class={cn('ui-chart-plot w-full overflow-hidden', local.class)}
      style={{ height: `${local.height}px` }}
      aria-hidden="true"
      {...rest}
    >
      <svg
        viewBox={`0 0 ${width()} ${local.height}`}
        class="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
      >
        {local.children}
      </svg>
    </div>
  );
};

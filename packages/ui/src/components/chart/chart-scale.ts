/** Shared scales and layout helpers for @peri/ui charts. */

export const CHART_WIDTH = 640;

export type ChartMargin = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export const DEFAULT_CHART_MARGIN: ChartMargin = {
  top: 16,
  right: 16,
  bottom: 36,
  left: 48,
};

/** Extra right gutter for a secondary y-axis (token overlay, etc.). */
export const DUAL_AXIS_CHART_MARGIN: ChartMargin = {
  top: 16,
  right: 56,
  bottom: 36,
  left: 48,
};

export const HORIZONTAL_BAR_CHART_MARGIN: ChartMargin = {
  top: 8,
  right: 16,
  bottom: 28,
  left: 132,
};

export const DEFAULT_CHART_HEIGHT = 256;
export const ACTIVITY_CHART_HEIGHT = 320;

export function linearScale(
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): (value: number) => number {
  const span = domainMax - domainMin || 1;
  return (value: number) => rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin);
}

export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

/** Evenly spaced axis ticks from min to max (inclusive). */
export function axisTicks(min: number, max: number, count = 3): number[] {
  if (count <= 1) return [max];
  if (min === max) return [min];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, index) => min + step * index);
}

export function bandSlot(
  index: number,
  count: number,
  innerWidth: number,
  padding = 0.18,
): { x: number; width: number } {
  const step = innerWidth / Math.max(count, 1);
  const width = step * (1 - padding);
  return { x: index * step + (step - width) / 2, width };
}

export function polylinePoints(
  values: number[],
  xAt: (index: number) => number,
  yAt: (value: number) => number,
): string {
  return values.map((value, index) => `${xAt(index)},${yAt(value)}`).join(' ');
}

export function polarToCartesian(cx: number, cy: number, radius: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

export function describeArc(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const startOuter = polarToCartesian(cx, cy, outerRadius, endAngle);
  const endOuter = polarToCartesian(cx, cy, outerRadius, startAngle);
  const startInner = polarToCartesian(cx, cy, innerRadius, startAngle);
  const endInner = polarToCartesian(cx, cy, innerRadius, endAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 1 ${endInner.x} ${endInner.y}`,
    'Z',
  ].join(' ');
}

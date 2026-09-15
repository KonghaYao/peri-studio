/** Compact SI-style axis labels (`200M`, not `200000k`). */
export function formatChartCompact(value: number): string {
  return Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

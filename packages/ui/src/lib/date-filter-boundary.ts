/** 日期筛选 boundary：对应 peri-fuse `date-filter-input.tsx` 的 start/end 语义。 */
export type DateFilterBoundary = 'start' | 'end';

/**
 * ISO → 本地 Date（无效值返回 undefined）。
 * 对应 peri-fuse `date-filter-input.tsx` 内联 `toLocalDate`。
 */
export function toLocalDate(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * 本地日历日 → 按 boundary 语义生成 UTC ISO 字符串。
 * 对应 peri-fuse `date-filter-input.tsx` 内联 `toIso`。
 */
export function toIso(date: Date, boundary: DateFilterBoundary): string {
  if (boundary === 'end') {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      23,
      59,
      59,
      999,
    ).toISOString();
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}

/**
 * 本地 Date → `YYYY-MM-DD` 显示格式。
 * 对应 peri-fuse `date-filter-input.tsx` 内联 `formatDay`。
 */
export function formatDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

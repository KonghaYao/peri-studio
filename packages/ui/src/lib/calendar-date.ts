/** 日历日期工具：纯原生 Date 运算，无外部依赖。 */

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  );
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function isToday(date: Date, today = new Date()): boolean {
  return sameDay(date, today);
}

/** 生成 6 行 × 7 列的月视图日期格（含前后月溢出日）。 */
export function getCalendarDays(month: Date, weekStartsOn: 0 | 1 = 0): Date[] {
  const firstOfMonth = startOfMonth(month);
  const startOffset = (firstOfMonth.getDay() - weekStartsOn + 7) % 7;
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - startOffset);

  const days: Date[] = [];
  for (let index = 0; index < 42; index += 1) {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    days.push(day);
  }
  return days;
}

export function formatMonthYear(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date);
}

export function formatDateLabel(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function getWeekdayLabels(weekStartsOn: 0 | 1 = 0, locale?: string): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const referenceSunday = new Date(2024, 0, 7);
  const startDay = new Date(referenceSunday);
  startDay.setDate(referenceSunday.getDate() + weekStartsOn);
  const labels: string[] = [];
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(startDay);
    date.setDate(startDay.getDate() + index);
    labels.push(formatter.format(date));
  }
  return labels;
}

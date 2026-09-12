/** DatePicker 标签格式化：按 picker 粒度输出展示文案。 */

export type DatePickerMode = 'date' | 'week' | 'month' | 'quarter' | 'year';

export function formatByPicker(date: Date, picker: DatePickerMode = 'date', locale?: string): string {
  switch (picker) {
    case 'week': {
      const week = getWeekNumber(date);
      return `Week ${week}, ${date.getFullYear()}`;
    }
    case 'month':
      return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date);
    case 'quarter':
      return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
    case 'year':
      return String(date.getFullYear());
    default:
      return new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(date);
  }
}

function getWeekNumber(date: Date): number {
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - day + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const firstDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3);
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / 604_800_000);
}

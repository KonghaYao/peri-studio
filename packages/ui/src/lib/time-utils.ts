/** 时间工具：纯原生 Date，无外部依赖。 */

export function formatTimeLabel(date: Date, locale?: string, withSeconds = false): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
  }).format(date);
}

export function parseTimeString(text: string): Date | null {
  const match = text.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  const date = new Date();
  date.setHours(hours, minutes, seconds, 0);
  return date;
}

export function setTimeOnDate(base: Date, hours: number, minutes: number, seconds = 0) {
  const next = new Date(base);
  next.setHours(hours, minutes, seconds, 0);
  return next;
}

export function sameTime(a: Date, b: Date, withSeconds = false) {
  if (withSeconds) {
    return a.getHours() === b.getHours()
      && a.getMinutes() === b.getMinutes()
      && a.getSeconds() === b.getSeconds();
  }
  return a.getHours() === b.getHours() && a.getMinutes() === b.getMinutes();
}

export function buildTimeColumns(stepMinute = 1, withSeconds = false) {
  const hours = Array.from({ length: 24 }, (_, index) => index);
  const minutes = Array.from({ length: Math.floor(60 / stepMinute) }, (_, index) => index * stepMinute);
  const seconds = withSeconds ? Array.from({ length: 60 }, (_, index) => index) : [];
  return { hours, minutes, seconds };
}

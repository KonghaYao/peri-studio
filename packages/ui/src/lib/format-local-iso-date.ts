/** ISO 风格日期格式化：本地或 UTC 字段，精度可控（自 peri-fuse LocalIsoDate 抽象）。 */

export type LocalIsoDateAccuracy = 'day' | 'hour' | 'minute' | 'second' | 'millisecond';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatLocalIsoDate(
  date: Date,
  useUTC = false,
  accuracy: LocalIsoDateAccuracy,
): string {
  const year = useUTC ? date.getUTCFullYear() : date.getFullYear();
  const month = useUTC ? date.getUTCMonth() + 1 : date.getMonth() + 1;
  const day = useUTC ? date.getUTCDate() : date.getDate();
  const hours = useUTC ? date.getUTCHours() : date.getHours();
  const minutes = useUTC ? date.getUTCMinutes() : date.getMinutes();
  const seconds = useUTC ? date.getUTCSeconds() : date.getSeconds();
  const ms = useUTC ? date.getUTCMilliseconds() : date.getMilliseconds();

  let formatted = `${year}-${pad2(month)}-${pad2(day)}`;

  if (accuracy === 'hour' || accuracy === 'minute' || accuracy === 'second' || accuracy === 'millisecond') {
    formatted += ` ${pad2(hours)}`;
  }
  if (accuracy === 'minute' || accuracy === 'second' || accuracy === 'millisecond') {
    formatted += `:${pad2(minutes)}`;
  }
  if (accuracy === 'second' || accuracy === 'millisecond') {
    formatted += `:${pad2(seconds)}`;
  }
  if (accuracy === 'millisecond') {
    formatted += `.${String(ms).padStart(3, '0')}`;
  }

  return formatted;
}

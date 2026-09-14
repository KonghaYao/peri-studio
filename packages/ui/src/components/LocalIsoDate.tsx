import { splitProps, type Component } from 'solid-js';
import { cn } from '../lib/cn';
import {
  formatLocalIsoDate,
  type LocalIsoDateAccuracy,
} from '../lib/format-local-iso-date';

export type { LocalIsoDateAccuracy } from '../lib/format-local-iso-date';
export { formatLocalIsoDate } from '../lib/format-local-iso-date';

export type LocalIsoDateProps = {
  date: Date;
  accuracy?: LocalIsoDateAccuracy;
  class?: string;
  'data-testid'?: string;
};

/** T2 · 本地时区 ISO 日期展示，native title 附带 UTC 毫秒精度。 */
export const LocalIsoDate: Component<LocalIsoDateProps> = (props) => {
  const [local, rest] = splitProps(props, ['date', 'accuracy', 'class']);

  if (!(local.date instanceof Date) || Number.isNaN(local.date.getTime())) {
    return null;
  }

  const accuracy = () => local.accuracy ?? 'second';
  const localDateString = () => formatLocalIsoDate(local.date, false, accuracy());
  const utcDateString = () => formatLocalIsoDate(local.date, true, 'millisecond');

  return (
    <time
      {...rest}
      dateTime={local.date.toISOString()}
      title={`UTC: ${utcDateString()}`}
      class={cn('tabular-nums text-content-primary', local.class)}
    >
      {localDateString()}
    </time>
  );
};

import { createSignal, onCleanup, onMount, Show, splitProps, type Component, type ComponentProps, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';

export type StatisticProps = ComponentProps<'div'> & {
  title?: JSX.Element;
  value?: JSX.Element | number | string;
  prefix?: JSX.Element;
  suffix?: JSX.Element;
  precision?: number;
  loading?: boolean;
};

function formatValue(value: JSX.Element | number | string | undefined, precision?: number) {
  if (value === undefined || value === null) return '—';
  if (typeof value !== 'number') return value;
  if (precision === undefined) return value.toLocaleString();
  return value.toFixed(precision);
}

/** 统计数值展示。 */
export const Statistic: Component<StatisticProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'title', 'value', 'prefix', 'suffix', 'precision', 'loading']);
  return (
    <div data-slot="statistic" class={cn('min-w-0', local.class)} {...rest}>
      <Show when={local.title}>
        <div class="mb-4 text-12 text-content-muted">{local.title}</div>
      </Show>
      <div
        class={cn(
          'flex items-baseline gap-6 font-semibold text-content-primary',
          local.loading ? 'opacity-60' : '',
        )}
      >
        <Show when={local.prefix}>
          <span class="text-14 text-content-muted">{local.prefix}</span>
        </Show>
        <span class="text-24 leading-tight tabular-nums">{formatValue(local.value, local.precision)}</span>
        <Show when={local.suffix}>
          <span class="text-14 text-content-muted">{local.suffix}</span>
        </Show>
      </div>
    </div>
  );
};

export type CountdownProps = ComponentProps<'div'> & {
  title?: JSX.Element;
  value?: number | Date;
  format?: string;
  onFinish?: () => void;
};

function remainingMs(value?: number | Date) {
  if (!value) return 0;
  const target = value instanceof Date ? value.getTime() : value;
  return Math.max(0, target - Date.now());
}

function formatCountdown(ms: number, format = 'HH:mm:ss') {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (format === 'mm:ss') return `${pad(minutes)}:${pad(seconds)}`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** 倒计时统计。 */
export const StatisticCountdown: Component<CountdownProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'title', 'value', 'format', 'onFinish']);
  const [remaining, setRemaining] = createSignal(remainingMs(local.value));
  let timer: ReturnType<typeof setInterval> | undefined;

  onMount(() => {
    timer = setInterval(() => {
      const next = remainingMs(local.value);
      setRemaining(next);
      if (next <= 0) {
        local.onFinish?.();
        if (timer) clearInterval(timer);
      }
    }, 1000);
  });
  onCleanup(() => {
    if (timer) clearInterval(timer);
  });

  return (
    <div data-slot="statistic-countdown" class={cn('min-w-0', local.class)} {...rest}>
      <Show when={local.title}>
        <div class="mb-4 text-12 text-content-muted">{local.title}</div>
      </Show>
      <div class="text-24 font-semibold tabular-nums text-content-primary">
        {formatCountdown(remaining(), local.format)}
      </div>
    </div>
  );
};

import { ChevronLeft, ChevronRight } from 'lucide-solid';
import {
  type Accessor,
  type Component,
  type ComponentProps,
  For,
  Show,
  createContext,
  createMemo,
  createSignal,
  splitProps,
  useContext,
} from 'solid-js';
import { cn } from '../lib/cn';
import {
  addMonths,
  formatDateLabel,
  formatMonthYear,
  getCalendarDays,
  getWeekdayLabels,
  isSameMonth,
  isToday,
  sameDay,
  startOfMonth,
} from '../lib/calendar-date';
import { IconButton } from './Button';

type DisabledMatcher = Date | ((date: Date) => boolean);

type CalendarContextValue = {
  month: Accessor<Date>;
  setMonth: (month: Date) => void;
  value: Accessor<Date | undefined>;
  selectDate: (date: Date) => void;
  isSelected: (date: Date) => boolean;
  isDisabled: (date: Date) => boolean;
  isOutsideMonth: (date: Date) => boolean;
  showOutsideDays: Accessor<boolean>;
  weekStartsOn: Accessor<0 | 1>;
  locale: Accessor<string | undefined>;
};

const CalendarContext = createContext<CalendarContextValue>();

function useCalendarContext(component: string) {
  const context = useContext(CalendarContext);
  if (!context) {
    throw new Error(`${component} must be used within <Calendar>.`);
  }
  return context;
}

function isDateDisabled(date: Date, disabled?: DisabledMatcher | DisabledMatcher[]) {
  if (!disabled) return false;
  const matchers = Array.isArray(disabled) ? disabled : [disabled];
  return matchers.some((matcher) =>
    typeof matcher === 'function' ? matcher(date) : sameDay(matcher, date),
  );
}

type CalendarProps = Omit<ComponentProps<'div'>, 'onChange'> & {
  value?: Date;
  defaultValue?: Date;
  onValueChange?: (value: Date | undefined) => void;
  month?: Date;
  defaultMonth?: Date;
  onMonthChange?: (month: Date) => void;
  disabled?: DisabledMatcher | DisabledMatcher[];
  showOutsideDays?: boolean;
  weekStartsOn?: 0 | 1;
  locale?: string;
};

/** 月历根容器：管理可见月份与选中日期。 */
export const Calendar: Component<CalendarProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'value',
    'defaultValue',
    'onValueChange',
    'month',
    'defaultMonth',
    'onMonthChange',
    'disabled',
    'showOutsideDays',
    'weekStartsOn',
    'locale',
  ]);

  const [internalValue, setInternalValue] = createSignal<Date | undefined>(local.defaultValue);
  const [internalMonth, setInternalMonth] = createSignal<Date>(
    startOfMonth(local.defaultMonth ?? local.defaultValue ?? local.value ?? new Date()),
  );

  const value = createMemo(() => local.value ?? internalValue());
  const month = createMemo(() => startOfMonth(local.month ?? internalMonth()));
  const showOutsideDays = () => local.showOutsideDays ?? true;
  const weekStartsOn = () => local.weekStartsOn ?? 0;
  const locale = () => local.locale;

  const setMonth = (next: Date) => {
    const normalized = startOfMonth(next);
    if (local.month === undefined) {
      setInternalMonth(normalized);
    }
    local.onMonthChange?.(normalized);
  };

  const selectDate = (date: Date) => {
    if (isDateDisabled(date, local.disabled)) return;
    if (local.value === undefined) {
      setInternalValue(date);
    }
    local.onValueChange?.(date);
  };

  const context: CalendarContextValue = {
    month,
    setMonth,
    value,
    selectDate,
    isSelected: (date) => {
      const selected = value();
      return selected ? sameDay(date, selected) : false;
    },
    isDisabled: (date) => isDateDisabled(date, local.disabled),
    isOutsideMonth: (date) => !isSameMonth(date, month()),
    showOutsideDays,
    weekStartsOn,
    locale,
  };

  return (
    <CalendarContext.Provider value={context}>
      <div
        data-slot="calendar"
        class={cn('w-(--container-popover) rounded-8 border border-border-subtle bg-surface p-12', local.class)}
        {...rest}
      >
        <Show when={local.children} fallback={<><CalendarHeader /><CalendarGrid /></>}>
          {local.children}
        </Show>
      </div>
    </CalendarContext.Provider>
  );
};

/** 月历顶栏：月份标题与前后导航。 */
export const CalendarHeader: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  const context = useCalendarContext('CalendarHeader');

  return (
    <div
      data-slot="calendar-header"
      class={cn('mb-8 flex items-center justify-between gap-8', local.class)}
      {...rest}
    >
      <Show
        when={local.children}
        fallback={
          <>
            <CalendarNav direction="previous" />
            <div class="flex-1 text-center text-13 font-medium text-content-primary">
              {formatMonthYear(context.month(), context.locale())}
            </div>
            <CalendarNav direction="next" />
          </>
        }
      >
        {local.children}
      </Show>
    </div>
  );
};

type CalendarNavProps = ComponentProps<'button'> & {
  direction: 'previous' | 'next';
};

/** 月历导航按钮。 */
export const CalendarNav: Component<CalendarNavProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'direction']);
  const context = useCalendarContext('CalendarNav');
  const label = () => (local.direction === 'previous' ? 'Previous month' : 'Next month');

  const navigate = () => {
    const delta = local.direction === 'previous' ? -1 : 1;
    context.setMonth(addMonths(context.month(), delta));
  };

  return (
    <IconButton
      type="button"
      variant="ghost"
      size="sm"
      label={label()}
      showTooltip={false}
      class={cn('shrink-0', local.class)}
      onClick={navigate}
      {...rest}
    >
      <Show when={local.direction === 'previous'} fallback={<ChevronRight size={14} aria-hidden="true" />}>
        <ChevronLeft size={14} aria-hidden="true" />
      </Show>
    </IconButton>
  );
};

/** 月历日期网格（含星期标题行）。 */
export const CalendarGrid: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  const context = useCalendarContext('CalendarGrid');
  const weekdays = createMemo(() => getWeekdayLabels(context.weekStartsOn(), context.locale()));
  const days = createMemo(() => getCalendarDays(context.month(), context.weekStartsOn()));

  return (
    <div data-slot="calendar-grid" class={cn('flex flex-col gap-4', local.class)} {...rest}>
      <div class="grid grid-cols-7 gap-4" role="row">
        <For each={weekdays()}>
          {(weekday) => (
            <div
              role="columnheader"
              class="flex size-32 items-center justify-center text-11 font-medium text-content-muted"
            >
              {weekday}
            </div>
          )}
        </For>
      </div>
      <div class="grid grid-cols-7 gap-4" role="grid">
        <For each={days()}>
          {(day) => (
            <CalendarCell date={day}>
              <CalendarDay date={day} />
            </CalendarCell>
          )}
        </For>
      </div>
    </div>
  );
};

type CalendarCellProps = ComponentProps<'div'> & {
  date: Date;
};

/** 单日网格单元容器。 */
export const CalendarCell: Component<CalendarCellProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'date', 'children']);
  const context = useCalendarContext('CalendarCell');
  const outside = () => context.isOutsideMonth(local.date);
  const hidden = () => outside() && !context.showOutsideDays();

  return (
    <div
      data-slot="calendar-cell"
      role="gridcell"
      data-outside={outside() || undefined}
      class={cn('flex items-center justify-center', hidden() && 'invisible', local.class)}
      {...rest}
    >
      <Show when={!hidden()}>{local.children}</Show>
    </div>
  );
};

type CalendarDayProps = Omit<ComponentProps<'button'>, 'onClick'> & {
  date: Date;
};

const calendarDayClasses = (
  selected: boolean,
  disabled: boolean,
  outside: boolean,
  today: boolean,
  className?: string,
) =>
  cn(
    'inline-flex size-32 items-center justify-center rounded-6 text-13 text-content-primary outline-none transition-colors',
    'focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2',
    disabled
      ? 'cursor-not-allowed opacity-40'
      : 'hover:bg-interaction-hover',
    selected && 'bg-accent-solid text-content-on-accent hover:bg-accent-solid',
    !selected && today && 'border border-border-subtle font-medium',
    outside && !selected && 'text-content-muted',
    className,
  );

/** 可点击的日期按钮。 */
export const CalendarDay: Component<CalendarDayProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'date']);
  const context = useCalendarContext('CalendarDay');
  const selected = () => context.isSelected(local.date);
  const disabled = () => context.isDisabled(local.date);
  const outside = () => context.isOutsideMonth(local.date);
  const today = () => isToday(local.date);
  const label = () => formatDateLabel(local.date, context.locale());

  return (
    <button
      type="button"
      data-slot="calendar-day"
      data-selected={selected() || undefined}
      data-outside={outside() || undefined}
      data-today={today() || undefined}
      aria-label={label()}
      aria-selected={selected()}
      aria-disabled={disabled() || undefined}
      disabled={disabled()}
      class={calendarDayClasses(selected(), disabled(), outside(), today(), local.class)}
      onClick={() => context.selectDate(local.date)}
      {...rest}
    >
      {local.date.getDate()}
    </button>
  );
};

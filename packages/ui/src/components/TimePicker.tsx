import { Clock } from 'lucide-solid';
import {
  For,
  Show,
  createContext,
  createMemo,
  createSignal,
  splitProps,
  useContext,
  type Component,
  type ComponentProps,
} from 'solid-js';
import { cn } from '../lib/cn';
import { formatTimeLabel, parseTimeString, setTimeOnDate } from '../lib/time-utils';
import { Button } from './Button';
import { Input } from './Field';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';

type TimePickerContextValue = {
  value: () => Date | undefined;
  setValue: (value: Date | undefined) => void;
  open: () => boolean;
  setOpen: (open: boolean) => void;
  placeholder: () => string;
  disabled: () => boolean;
  format: () => string;
  use12Hours: () => boolean;
  withSeconds: () => boolean;
};

const TimePickerContext = createContext<TimePickerContextValue>();

function useTimePickerContext(component: string) {
  const context = useContext(TimePickerContext);
  if (!context) throw new Error(`${component} must be used within <TimePicker>.`);
  return context;
}

export type TimePickerProps = Omit<ComponentProps<'div'>, 'onChange'> & {
  value?: Date;
  defaultValue?: Date;
  onValueChange?: (value: Date | undefined) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
  disabled?: boolean;
  format?: string;
  use12Hours?: boolean;
  showSecond?: boolean;
};

/** 时间选择器根容器。 */
export const TimePicker: Component<TimePickerProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'value',
    'defaultValue',
    'onValueChange',
    'open',
    'defaultOpen',
    'onOpenChange',
    'placeholder',
    'disabled',
    'format',
    'use12Hours',
    'showSecond',
  ]);

  const [internalValue, setInternalValue] = createSignal<Date | undefined>(local.defaultValue);
  const [internalOpen, setInternalOpen] = createSignal(local.defaultOpen ?? false);

  const value = createMemo(() => local.value ?? internalValue());
  const open = createMemo(() => local.open ?? internalOpen());

  const setValue = (next: Date | undefined) => {
    if (local.value === undefined) setInternalValue(next);
    local.onValueChange?.(next);
  };

  const setOpen = (next: boolean) => {
    if (local.open === undefined) setInternalOpen(next);
    local.onOpenChange?.(next);
  };

  const context: TimePickerContextValue = {
    value,
    setValue,
    open,
    setOpen,
    placeholder: () => local.placeholder ?? 'Select time',
    disabled: () => local.disabled ?? false,
    format: () => local.format ?? (local.showSecond ? 'HH:mm:ss' : 'HH:mm'),
    use12Hours: () => local.use12Hours ?? false,
    withSeconds: () => local.showSecond ?? false,
  };

  return (
    <TimePickerContext.Provider value={context}>
      <Popover open={open()} onOpenChange={setOpen}>
        <div data-slot="time-picker" class={cn('inline-flex', local.class)} {...rest}>
          {local.children ?? (
            <>
              <TimePickerTrigger />
              <TimePickerContent />
            </>
          )}
        </div>
      </Popover>
    </TimePickerContext.Provider>
  );
};

export const TimePickerTrigger: Component<ComponentProps<typeof Button>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'variant', 'size', 'disabled']);
  const context = useTimePickerContext('TimePickerTrigger');
  const selected = () => context.value();
  const label = () =>
    selected()
      ? formatTimeLabel(selected()!, undefined, context.withSeconds())
      : context.placeholder();

  return (
    <PopoverTrigger
      as={Button}
      variant={local.variant ?? 'default'}
      size={local.size ?? 'md'}
      disabled={local.disabled ?? context.disabled()}
      data-empty={selected() ? undefined : true}
      class={cn('justify-start gap-8 text-left font-normal data-[empty]:text-text-faint', local.class)}
      {...rest}
    >
      <Show when={local.children} fallback={
        <>
          <Clock size={14} class="shrink-0 text-content-muted" aria-hidden="true" />
          <span class="truncate">{label()}</span>
        </>
      }>
        {local.children}
      </Show>
    </PopoverTrigger>
  );
};

export const TimePickerContent: Component<ComponentProps<typeof PopoverContent>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'aria-label']);
  const context = useTimePickerContext('TimePickerContent');
  const [hour, setHour] = createSignal(context.value()?.getHours() ?? 0);
  const [minute, setMinute] = createSignal(context.value()?.getMinutes() ?? 0);
  const [second, setSecond] = createSignal(context.value()?.getSeconds() ?? 0);

  const apply = () => {
    const base = context.value() ?? new Date();
    context.setValue(setTimeOnDate(base, hour(), minute(), context.withSeconds() ? second() : 0));
    context.setOpen(false);
  };

  return (
    <PopoverContent aria-label={local['aria-label'] ?? 'Choose time'} class={cn('w-auto p-12', local.class)} {...rest}>
      <div class="flex flex-col gap-12">
        <div class="flex gap-8">
          <TimeColumn label="Hour" values={Array.from({ length: 24 }, (_, index) => index)} selected={hour()} onSelect={setHour} />
          <TimeColumn label="Minute" values={Array.from({ length: 60 }, (_, index) => index)} selected={minute()} onSelect={setMinute} />
          <Show when={context.withSeconds()}>
            <TimeColumn label="Second" values={Array.from({ length: 60 }, (_, index) => index)} selected={second()} onSelect={setSecond} />
          </Show>
        </div>
        <Input
          aria-label="Time input"
          placeholder="HH:mm"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              const parsed = parseTimeString((event.currentTarget as HTMLInputElement).value);
              if (parsed) {
                context.setValue(parsed);
                context.setOpen(false);
              }
            }
          }}
        />
        <div class="flex justify-end gap-8">
          <Button variant="ghost" size="sm" onClick={() => context.setOpen(false)}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={apply}>OK</Button>
        </div>
      </div>
    </PopoverContent>
  );
};

function TimeColumn(props: {
  label: string;
  values: number[];
  selected: number;
  onSelect: (value: number) => void;
}) {
  return (
    <div class="flex max-h-48 w-20 flex-col overflow-y-auto rounded-6 border border-border-subtle">
      <For each={props.values}>
        {(value) => (
          <button
            type="button"
            class={cn(
              'min-h-28 px-8 text-center text-12 text-content-primary hover:bg-interaction-hover',
              props.selected === value && 'bg-interaction-hover font-medium',
            )}
            onClick={() => props.onSelect(value)}
          >
            {String(value).padStart(2, '0')}
          </button>
        )}
      </For>
    </div>
  );
}

export type TimeRangeValue = [Date | undefined, Date | undefined];

export type TimeRangePickerProps = Omit<TimePickerProps, 'value' | 'defaultValue' | 'onValueChange'> & {
  value?: TimeRangeValue;
  defaultValue?: TimeRangeValue;
  onValueChange?: (value: TimeRangeValue) => void;
};

/** 时间范围选择器。 */
export const TimeRangePicker: Component<TimeRangePickerProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'value',
    'defaultValue',
    'onValueChange',
    'class',
    'disabled',
    'placeholder',
    'showSecond',
  ]);

  const [internal, setInternal] = createSignal<TimeRangeValue>(local.defaultValue ?? [undefined, undefined]);
  const value = createMemo(() => local.value ?? internal());

  const setPart = (index: 0 | 1, next: Date | undefined) => {
    const current = [...value()] as TimeRangeValue;
    current[index] = next;
    if (local.value === undefined) setInternal(current);
    local.onValueChange?.(current);
  };

  const label = () => {
    const [start, end] = value();
    if (!start && !end) return local.placeholder ?? 'Start time → End time';
    const withSeconds = local.showSecond ?? false;
    const left = start ? formatTimeLabel(start, undefined, withSeconds) : '—';
    const right = end ? formatTimeLabel(end, undefined, withSeconds) : '—';
    return `${left} → ${right}`;
  };

  return (
    <div class={cn('inline-flex items-center gap-8', local.class)} {...rest}>
      <TimePicker
        value={value()[0]}
        onValueChange={(next) => setPart(0, next)}
        disabled={local.disabled}
        showSecond={local.showSecond}
        placeholder="Start time"
      />
      <span class="text-content-muted">→</span>
      <TimePicker
        value={value()[1]}
        onValueChange={(next) => setPart(1, next)}
        disabled={local.disabled}
        showSecond={local.showSecond}
        placeholder="End time"
      />
      <span class="sr-only">{label()}</span>
    </div>
  );
};

type TimePickerCompound = typeof TimePicker & {
  Trigger: typeof TimePickerTrigger;
  Content: typeof TimePickerContent;
  RangePicker: typeof TimeRangePicker;
};
(TimePicker as TimePickerCompound).Trigger = TimePickerTrigger;
(TimePicker as TimePickerCompound).Content = TimePickerContent;
(TimePicker as TimePickerCompound).RangePicker = TimeRangePicker;

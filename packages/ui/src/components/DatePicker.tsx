import { Calendar as CalendarIcon } from 'lucide-solid';
import {
  type Accessor,
  type Component,
  type ComponentProps,
  Show,
  createContext,
  createMemo,
  createSignal,
  splitProps,
  useContext,
} from 'solid-js';
import { cn } from '../lib/cn';
import { formatByPicker, type DatePickerMode } from '../lib/date-picker-format';
import { Button } from './Button';
import { DatePickerPanel, type DatePickerPreset } from './date-picker-panel';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';

type DatePickerContextValue = {
  value: Accessor<Date | undefined>;
  setValue: (value: Date | undefined) => void;
  open: Accessor<boolean>;
  setOpen: (open: boolean) => void;
  placeholder: Accessor<string>;
  locale: Accessor<string | undefined>;
  disabled: Accessor<boolean>;
  defaultMonth: Accessor<Date | undefined>;
  calendarDisabled: Accessor<ComponentProps<typeof DatePickerPanel>['disabled'] | undefined>;
  picker: Accessor<DatePickerMode>;
  presets: Accessor<DatePickerPreset[] | undefined>;
  showTime: Accessor<boolean>;
};

const DatePickerContext = createContext<DatePickerContextValue>();

function useDatePickerContext(component: string) {
  const context = useContext(DatePickerContext);
  if (!context) {
    throw new Error(`${component} must be used within <DatePicker>.`);
  }
  return context;
}

type DatePickerProps = Omit<ComponentProps<'div'>, 'onChange'> & {
  value?: Date;
  defaultValue?: Date;
  onValueChange?: (value: Date | undefined) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
  locale?: string;
  disabled?: boolean;
  /** 透传给内嵌 Calendar 的 disabled 规则 */
  calendarDisabled?: ComponentProps<typeof DatePickerPanel>['disabled'];
  /** Ant Design 别名 */
  disabledDate?: ComponentProps<typeof DatePickerPanel>['disabled'];
  picker?: DatePickerMode;
  presets?: DatePickerPreset[];
  showTime?: boolean;
  defaultMonth?: Date;
};

/** 日期选择器根容器：组合 Popover 与 Calendar。 */
export const DatePicker: Component<DatePickerProps> = (props) => {
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
    'locale',
    'disabled',
    'calendarDisabled',
    'disabledDate',
    'picker',
    'presets',
    'showTime',
    'defaultMonth',
  ]);

  const [internalValue, setInternalValue] = createSignal<Date | undefined>(local.defaultValue);
  const [internalOpen, setInternalOpen] = createSignal(local.defaultOpen ?? false);

  const value = createMemo(() => local.value ?? internalValue());
  const open = createMemo(() => local.open ?? internalOpen());
  const placeholder = () => local.placeholder ?? 'Pick a date';
  const locale = () => local.locale;
  const disabled = () => local.disabled ?? false;

  const setValue = (next: Date | undefined) => {
    if (local.value === undefined) {
      setInternalValue(next);
    }
    local.onValueChange?.(next);
  };

  const setOpen = (next: boolean) => {
    if (local.open === undefined) {
      setInternalOpen(next);
    }
    local.onOpenChange?.(next);
  };

  const context: DatePickerContextValue = {
    value,
    setValue,
    open,
    setOpen,
    placeholder,
    locale,
    disabled,
    defaultMonth: () => local.defaultMonth,
    calendarDisabled: () => local.calendarDisabled ?? local.disabledDate,
    picker: () => local.picker ?? 'date',
    presets: () => local.presets,
    showTime: () => local.showTime ?? false,
  };

  return (
    <DatePickerContext.Provider value={context}>
      <Popover open={open()} onOpenChange={setOpen}>
        <div data-slot="date-picker" class={cn('inline-flex', local.class)} {...rest}>
          {local.children ?? (
            <>
              <DatePickerTrigger />
              <DatePickerContent />
            </>
          )}
        </div>
      </Popover>
    </DatePickerContext.Provider>
  );
};

type DatePickerTriggerProps = ComponentProps<typeof Button>;

/** 日期选择器触发按钮。 */
export const DatePickerTrigger: Component<DatePickerTriggerProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'variant', 'size', 'disabled']);
  const context = useDatePickerContext('DatePickerTrigger');
  const selected = () => context.value();
  const label = () =>
    selected()
      ? formatByPicker(selected()!, context.picker(), context.locale())
      : context.placeholder();

  return (
    <PopoverTrigger
      as={Button}
      variant={local.variant ?? 'default'}
      size={local.size ?? 'md'}
      disabled={local.disabled ?? context.disabled()}
      data-empty={selected() ? undefined : true}
      class={cn(
        'justify-start gap-8 text-left font-normal data-[empty]:text-text-faint',
        local.class,
      )}
      {...rest}
    >
      <Show when={local.children} fallback={
        <>
          <CalendarIcon size={14} class="shrink-0 text-content-muted" aria-hidden="true" />
          <span class="truncate">{label()}</span>
        </>
      }>
        {local.children}
      </Show>
    </PopoverTrigger>
  );
};

type DatePickerContentProps = ComponentProps<typeof PopoverContent>;

/** 日期选择器弹出层，内嵌 Calendar。 */
export const DatePickerContent: Component<DatePickerContentProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'aria-label']);
  const context = useDatePickerContext('DatePickerContent');

  return (
    <PopoverContent
      aria-label={local['aria-label'] ?? 'Choose date'}
      class={cn('w-auto p-0', local.class)}
      {...rest}
    >
      <DatePickerPanel
        value={context.value()}
        onValueChange={(date) => {
          context.setValue(date);
          if (!context.showTime()) context.setOpen(false);
        }}
        picker={context.picker()}
        disabled={context.calendarDisabled()}
        locale={context.locale()}
        presets={context.presets()}
        showTime={context.showTime()}
        defaultMonth={context.defaultMonth()}
      />
    </PopoverContent>
  );
};

export type DateRangeValue = [Date | undefined, Date | undefined];

export type DateRangePickerProps = Omit<ComponentProps<'div'>, 'onChange'> & {
  value?: DateRangeValue;
  defaultValue?: DateRangeValue;
  onValueChange?: (value: DateRangeValue) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  placeholder?: [string, string];
  locale?: string;
  disabled?: boolean;
  calendarDisabled?: ComponentProps<typeof DatePickerPanel>['disabled'];
  defaultMonth?: Date;
};

/** 日期范围选择器：开始/结束两个 DatePicker 组合。 */
export const DateRangePicker: Component<DateRangePickerProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'value',
    'defaultValue',
    'onValueChange',
    'placeholder',
    'locale',
    'disabled',
    'calendarDisabled',
    'defaultMonth',
  ]);

  const [internal, setInternal] = createSignal<DateRangeValue>(local.defaultValue ?? [undefined, undefined]);
  const value = createMemo(() => local.value ?? internal());
  const placeholders = () => local.placeholder ?? ['Start date', 'End date'];

  const setPart = (index: 0 | 1, next: Date | undefined) => {
    const current = [...value()] as DateRangeValue;
    current[index] = next;
    if (local.value === undefined) setInternal(current);
    local.onValueChange?.(current);
  };

  return (
    <div data-slot="date-range-picker" class={cn('inline-flex items-center gap-8', local.class)} {...rest}>
      <DatePicker
        value={value()[0]}
        onValueChange={(next) => setPart(0, next)}
        placeholder={placeholders()[0]}
        locale={local.locale}
        disabled={local.disabled}
        calendarDisabled={local.calendarDisabled}
        defaultMonth={local.defaultMonth ?? value()[0] ?? value()[1]}
      />
      <span class="text-content-muted" aria-hidden="true">→</span>
      <DatePicker
        value={value()[1]}
        onValueChange={(next) => setPart(1, next)}
        placeholder={placeholders()[1]}
        locale={local.locale}
        disabled={local.disabled}
        calendarDisabled={local.calendarDisabled}
        defaultMonth={local.defaultMonth ?? value()[1] ?? value()[0]}
      />
    </div>
  );
};

type DatePickerCompound = typeof DatePicker & { RangePicker: typeof DateRangePicker };
(DatePicker as DatePickerCompound).RangePicker = DateRangePicker;

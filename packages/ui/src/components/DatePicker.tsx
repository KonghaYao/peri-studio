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
import { formatDateLabel } from '../lib/calendar-date';
import { Button } from './Button';
import { Calendar } from './Calendar';
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
  calendarDisabled: Accessor<ComponentProps<typeof Calendar>['disabled'] | undefined>;
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
  calendarDisabled?: ComponentProps<typeof Calendar>['disabled'];
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
    calendarDisabled: () => local.calendarDisabled,
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
    selected() ? formatDateLabel(selected()!, context.locale()) : context.placeholder();

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
      <Calendar
        value={context.value()}
        onValueChange={(date) => {
          context.setValue(date);
          context.setOpen(false);
        }}
        defaultMonth={context.defaultMonth() ?? context.value()}
        disabled={context.calendarDisabled()}
        locale={context.locale()}
        class="border-0 shadow-none"
      />
    </PopoverContent>
  );
};

import { Calendar as CalendarIcon, X } from 'lucide-solid';
import { Show, createSignal, splitProps, type Component } from 'solid-js';
import {
  formatDay,
  toIso,
  toLocalDate,
  type DateFilterBoundary,
} from '../../lib/date-filter-boundary';
import { cn } from '../../lib/cn';
import { IconButton } from '../Button';
import { DatePicker, DatePickerContent, DatePickerTrigger } from '../DatePicker';

export type { DateFilterBoundary };

export type DateFilterInputProps = {
  /** 已提交 ISO 值（undefined = 未激活）。 */
  value: string | undefined;
  onCommit: (value: string | undefined) => void;
  placeholder?: string;
  title?: string;
  'aria-label'?: string;
  /** start = 当天 00:00:00.000 本地；end = 当天 23:59:59.999 本地。 */
  boundary?: DateFilterBoundary;
  /** 透传给内嵌 DatePicker，便于首次打开时定位月份。 */
  defaultMonth?: Date;
  class?: string;
};

/**
 * 检索栏日期筛选：Popover + DatePicker；ISO 存储 + boundary 语义。
 * 对应 peri-fuse `date-filter-input.tsx`（复用 studio DatePicker，无 DOM hack）。
 */
export const DateFilterInput: Component<DateFilterInputProps> = (props) => {
  const [local] = splitProps(props, [
    'value',
    'onCommit',
    'placeholder',
    'title',
    'aria-label',
    'boundary',
    'defaultMonth',
    'class',
  ]);

  const [open, setOpen] = createSignal(false);
  const selected = () => toLocalDate(local.value);
  const placeholder = () => local.placeholder ?? 'Select date…';
  const boundary = () => local.boundary ?? 'start';
  const label = () => local['aria-label'] ?? local.title;

  return (
    <DatePicker
      value={selected()}
      open={open()}
      onOpenChange={setOpen}
      defaultMonth={local.defaultMonth}
      placeholder={placeholder()}
      onValueChange={(date) => {
        if (date) {
          local.onCommit(toIso(date, boundary()));
          setOpen(false);
        }
      }}
      class={cn('w-full', local.class)}
    >
      <DatePickerTrigger
        size="sm"
        variant="default"
        title={local.title}
        aria-label={label()}
        data-empty={selected() ? undefined : true}
        class={cn(
          'w-full gap-8',
          selected() ? 'text-text-primary' : 'text-text-faint',
        )}
      >
        <CalendarIcon size={14} class="shrink-0 text-content-muted" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-left">
          {selected() ? formatDay(selected()!) : placeholder()}
        </span>
        <Show when={selected()}>
          <IconButton
            type="button"
            label={`Clear ${local.title ?? 'date filter'}`}
            showTooltip={false}
            size="sm"
            variant="ghost"
            class="shrink-0 text-content-muted"
            onClick={(event) => {
              event.stopPropagation();
              local.onCommit(undefined);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                local.onCommit(undefined);
              }
            }}
          >
            <X size={14} aria-hidden="true" />
          </IconButton>
        </Show>
      </DatePickerTrigger>
      <DatePickerContent aria-label={label() ?? 'Choose date'} />
    </DatePicker>
  );
};

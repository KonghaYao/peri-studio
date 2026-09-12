import { For, Show, splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../lib/cn';
import { startOfMonth } from '../lib/calendar-date';
import type { DatePickerMode } from '../lib/date-picker-format';
import { Button } from './Button';
import { Calendar } from './Calendar';
import { TimePicker } from './TimePicker';

export type DatePickerPreset = {
  label: string;
  value: Date;
};

export type DatePickerPanelProps = {
  value?: Date;
  onValueChange?: (value: Date | undefined) => void;
  picker?: DatePickerMode;
  locale?: string;
  disabled?: ComponentProps<typeof Calendar>['disabled'];
  presets?: DatePickerPreset[];
  showTime?: boolean;
  defaultMonth?: Date;
  class?: string;
};

const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** DatePicker 弹出面板：日历/月/季/年视图 + 预设 + 可选时间。 */
export const DatePickerPanel: Component<DatePickerPanelProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'value',
    'onValueChange',
    'picker',
    'locale',
    'disabled',
    'presets',
    'showTime',
    'defaultMonth',
    'class',
  ]);
  const picker = () => local.picker ?? 'date';
  const baseYear = () => local.value?.getFullYear() ?? new Date().getFullYear();

  const selectMonth = (month: number) => {
    local.onValueChange?.(new Date(baseYear(), month, 1));
  };

  const selectQuarter = (quarter: number) => {
    local.onValueChange?.(new Date(baseYear(), (quarter - 1) * 3, 1));
  };

  const selectYear = (year: number) => {
    local.onValueChange?.(new Date(year, local.value?.getMonth() ?? 0, 1));
  };

  return (
    <div data-slot="date-picker-panel" class={cn('flex flex-col gap-8 p-8', local.class)} {...rest}>
      <Show when={(local.presets?.length ?? 0) > 0}>
        <div class="flex flex-wrap gap-6 border-b border-border-subtle pb-8">
          <For each={local.presets}>
            {(preset) => (
              <Button
                size="sm"
                variant="default"
                onClick={() => local.onValueChange?.(preset.value)}
              >
                {preset.label}
              </Button>
            )}
          </For>
        </div>
      </Show>

      <Show
        when={picker() === 'date' || picker() === 'week'}
        fallback={(
          <Show
            when={picker() === 'month'}
            fallback={(
              <Show
                when={picker() === 'quarter'}
                fallback={(
                  <div class="grid grid-cols-3 gap-6 p-4">
                    <For each={Array.from({ length: 12 }, (_, index) => baseYear() - 5 + index)}>
                      {(year) => (
                        <Button
                          size="sm"
                          variant={local.value?.getFullYear() === year ? 'primary' : 'default'}
                          onClick={() => selectYear(year)}
                        >
                          {year}
                        </Button>
                      )}
                    </For>
                  </div>
                )}
              >
                <div class="grid grid-cols-2 gap-6 p-4">
                  <For each={[1, 2, 3, 4]}>
                    {(quarter) => (
                      <Button
                        size="sm"
                        variant={
                          local.value && Math.floor(local.value.getMonth() / 3) + 1 === quarter
                            ? 'primary'
                            : 'default'
                        }
                        onClick={() => selectQuarter(quarter)}
                      >
                        Q{quarter}
                      </Button>
                    )}
                  </For>
                </div>
              </Show>
            )}
          >
            <div class="grid grid-cols-3 gap-6 p-4">
              <For each={monthLabels.map((label, index) => ({ label, index }))}>
                {(month) => (
                  <Button
                    size="sm"
                    variant={local.value?.getMonth() === month.index ? 'primary' : 'default'}
                    onClick={() => selectMonth(month.index)}
                  >
                    {month.label}
                  </Button>
                )}
              </For>
            </div>
          </Show>
        )}
      >
        <Calendar
          value={local.value}
          onValueChange={local.onValueChange}
          defaultMonth={local.defaultMonth ?? local.value ?? startOfMonth(new Date())}
          disabled={local.disabled}
          locale={local.locale}
          class="border-0 shadow-none"
        />
      </Show>

      <Show when={local.showTime}>
        <div class="border-t border-border-subtle pt-8">
          <TimePicker
            value={local.value}
            onValueChange={(next) => {
              if (!next) return;
              const base = local.value ?? new Date();
              const merged = new Date(base);
              merged.setHours(next.getHours(), next.getMinutes(), next.getSeconds(), 0);
              local.onValueChange?.(merged);
            }}
          />
        </div>
      </Show>
    </div>
  );
};

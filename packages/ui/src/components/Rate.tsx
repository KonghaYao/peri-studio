import { Star } from 'lucide-solid';
import { For, createMemo, createSignal, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../lib/cn';

export type RateProps = {
  value?: number;
  defaultValue?: number;
  onChange?: (value: number) => void;
  count?: number;
  allowHalf?: boolean;
  allowClear?: boolean;
  disabled?: boolean;
  class?: string;
  character?: (index: number) => JSX.Element;
  tooltips?: string[];
};

/** 星级评分。 */
export const Rate: Component<RateProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'value',
    'defaultValue',
    'onChange',
    'count',
    'allowHalf',
    'allowClear',
    'disabled',
    'class',
    'character',
    'tooltips',
  ]);

  const count = () => local.count ?? 5;
  const [internal, setInternal] = createSignal(local.defaultValue ?? 0);
  const value = createMemo(() => local.value ?? internal());

  const setValue = (next: number) => {
    const clamped = Math.max(0, Math.min(count(), next));
    const cleared = local.allowClear && clamped === value() ? 0 : clamped;
    if (local.value === undefined) setInternal(cleared);
    local.onChange?.(cleared);
  };

  const handlePointer = (index: number, event: PointerEvent) => {
    if (local.disabled) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const half = local.allowHalf && event.clientX - rect.left < rect.width / 2;
    setValue(half ? index + 0.5 : index + 1);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Rate"
      class={cn('inline-flex items-center gap-4', local.class)}
      {...rest}
    >
      <For each={Array.from({ length: count() }, (_, index) => index)}>
        {(index) => {
          const filled = () => value() >= index + 1;
          const half = () => local.allowHalf && value() >= index + 0.5 && value() < index + 1;
          const title = () => local.tooltips?.[index];
          return (
            <button
              type="button"
              role="radio"
              aria-checked={filled() || half()}
              title={title()}
              disabled={local.disabled}
              class={cn(
                'relative cursor-pointer border-0 bg-transparent p-0 text-content-muted outline-none',
                'hover:text-warning disabled:cursor-not-allowed disabled:opacity-45',
                (filled() || half()) && 'text-warning',
              )}
              onPointerDown={(event) => handlePointer(index, event)}
            >
              {local.character?.(index) ?? <Star size={18} fill={filled() || half() ? 'currentColor' : 'none'} />}
            </button>
          );
        }}
      </For>
    </div>
  );
};

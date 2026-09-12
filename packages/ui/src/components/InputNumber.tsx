import { Minus, Plus } from 'lucide-solid';
import {
  createMemo,
  createSignal,
  splitProps,
  type Component,
  type JSX,
} from 'solid-js';
import { cn } from '../lib/cn';
import { inputFieldVariants, inputShellClass } from '../lib/input-variants';
import { IconButton } from './Button';
import type { InputShellVariantProps } from '../lib/input-variants';

export type InputNumberProps = Omit<
  JSX.IntrinsicElements['input'],
  'type' | 'value' | 'onChange' | 'size'
> &
  InputShellVariantProps & {
    value?: number | null;
    defaultValue?: number;
    onChange?: (value: number | null) => void;
    min?: number;
    max?: number;
    step?: number;
    precision?: number;
    controls?: boolean;
    keyboard?: boolean;
    status?: 'error' | 'warning' | 'default';
    invalid?: boolean;
    parser?: (display: string) => number | null;
    formatter?: (value: number | null) => string;
    class?: string;
  };

function clampNumber(value: number, min?: number, max?: number) {
  let next = value;
  if (min != null) next = Math.max(min, next);
  if (max != null) next = Math.min(max, next);
  return next;
}

function roundPrecision(value: number, precision?: number) {
  if (precision == null) return value;
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

/** 数字输入：步进、min/max、可选 spinner。 */
export const InputNumber: Component<InputNumberProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'size',
    'variant',
    'status',
    'invalid',
    'value',
    'defaultValue',
    'onChange',
    'min',
    'max',
    'step',
    'precision',
    'controls',
    'keyboard',
    'parser',
    'formatter',
    'disabled',
  ]);

  const [internal, setInternal] = createSignal<number | null>(local.defaultValue ?? null);
  const value = createMemo(() => local.value ?? internal());

  const display = createMemo(() => {
    const current = value();
    if (local.formatter) return local.formatter(current);
    return current == null ? '' : String(current);
  });

  const commit = (next: number | null) => {
    if (local.value === undefined) setInternal(next);
    local.onChange?.(next);
  };

  const parseInput = (text: string) => {
    if (local.parser) return local.parser(text);
    if (text.trim() === '') return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const applyDelta = (delta: number) => {
    const step = local.step ?? 1;
    const base = value() ?? 0;
    const next = roundPrecision(clampNumber(base + delta * step, local.min, local.max), local.precision);
    commit(next);
  };

  const showControls = () => local.controls ?? true;

  return (
    <div
      class={cn(
        inputShellClass({
          size: local.size,
          variant: local.variant,
          status: local.status,
          invalid: local.invalid,
          class: cn('pr-4', local.class),
        }),
      )}
    >
      <input
        {...rest}
        type="text"
        inputMode="decimal"
        disabled={local.disabled}
        value={display()}
        aria-invalid={local.invalid || local.status === 'error' ? 'true' : undefined}
        class={inputFieldVariants({ size: local.size ?? 'md' })}
        onInput={(event) => {
          const parsed = parseInput(event.currentTarget.value);
          if (parsed == null) {
            commit(null);
            return;
          }
          commit(roundPrecision(clampNumber(parsed, local.min, local.max), local.precision));
        }}
        onKeyDown={(event) => {
          if (local.keyboard === false) return;
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            applyDelta(1);
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            applyDelta(-1);
          }
        }}
      />
      {showControls() ? (
        <div class="flex shrink-0 flex-col border-l border-border-subtle">
          <IconButton
            type="button"
            label="Increase"
            showTooltip={false}
            size="sm"
            variant="ghost"
            class="h-16 rounded-none"
            disabled={local.disabled || (local.max != null && (value() ?? 0) >= local.max)}
            onClick={() => applyDelta(1)}
          >
            <Plus size={12} aria-hidden="true" />
          </IconButton>
          <IconButton
            type="button"
            label="Decrease"
            showTooltip={false}
            size="sm"
            variant="ghost"
            class="h-16 rounded-none border-t border-border-subtle"
            disabled={local.disabled || (local.min != null && (value() ?? 0) <= local.min)}
            onClick={() => applyDelta(-1)}
          >
            <Minus size={12} aria-hidden="true" />
          </IconButton>
        </div>
      ) : null}
    </div>
  );
};

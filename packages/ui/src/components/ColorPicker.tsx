import { Check } from 'lucide-solid';
import {
  For,
  Show,
  createMemo,
  createSignal,
  splitProps,
  type Component,
} from 'solid-js';
import { cn } from '../lib/cn';
import { Input } from './Field';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';

export type ColorPickerProps = {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  presets?: string[];
  disabled?: boolean;
  showText?: boolean;
  class?: string;
  'data-testid'?: string;
};

const DEFAULT_PRESETS = [
  '#1677ff',
  '#52c41a',
  '#faad14',
  '#ff4d4f',
  '#722ed1',
  '#13c2c2',
  '#eb2f96',
  '#2f54eb',
];

function normalizeHex(value: string) {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return trimmed;
}

/** 颜色选择器：色块触发 + 预设与 hex 输入。 */
export const ColorPicker: Component<ColorPickerProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'value',
    'defaultValue',
    'onChange',
    'presets',
    'disabled',
    'showText',
    'class',
    'data-testid',
  ]);

  const [internal, setInternal] = createSignal(local.defaultValue ?? '#1677ff');
  const value = createMemo(() => normalizeHex(local.value ?? internal()));
  const presets = () => local.presets ?? DEFAULT_PRESETS;

  const commit = (next: string) => {
    const normalized = normalizeHex(next);
    if (local.value === undefined) setInternal(normalized);
    local.onChange?.(normalized);
  };

  return (
    <Popover>
      <PopoverTrigger
        as="button"
        type="button"
        disabled={local.disabled}
        data-testid={local['data-testid']}
        class={cn(
          'inline-flex h-36 items-center gap-8 rounded-6 border border-border-strong bg-surface px-10 text-13 text-text-primary',
          'hover:border-accent-border-hover focus-visible:border-focus-ring disabled:cursor-not-allowed disabled:opacity-45',
          local.class,
        )}
        {...rest}
      >
        <span
          class="size-20 rounded-4 border border-border-subtle"
          style={{ 'background-color': value() }}
          aria-hidden="true"
        />
        <Show when={local.showText}>
          <span class="font-mono text-12">{value()}</span>
        </Show>
      </PopoverTrigger>
      <PopoverContent class="w-(--container-dialog-compact) p-12">
        <div class="flex flex-col gap-12">
          <Input
            value={value()}
            onInput={(event) => commit(event.currentTarget.value)}
            aria-label="Hex color"
            class="font-mono"
          />
          <div class="grid grid-cols-4 gap-8">
            <For each={presets()}>
              {(color) => (
                <button
                  type="button"
                  class={cn(
                    'relative grid size-32 place-items-center rounded-6 border border-border-subtle',
                    value() === color && 'ring-2 ring-focus-ring',
                  )}
                  style={{ 'background-color': color }}
                  aria-label={color}
                  onClick={() => commit(color)}
                >
                  <Show when={value() === color}>
                    <Check size={14} class="text-surface" aria-hidden="true" />
                  </Show>
                </button>
              )}
            </For>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

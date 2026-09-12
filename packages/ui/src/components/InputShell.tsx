import { X } from 'lucide-solid';
import {
  Show,
  createMemo,
  splitProps,
  type Component,
  type JSX,
} from 'solid-js';
import { cn } from '../lib/cn';
import {
  inputFieldVariants,
  inputShellClass,
  type InputShellVariantProps,
} from '../lib/input-variants';
import { IconButton } from './Button';

export type InputShellProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'prefix'> &
  InputShellVariantProps & {
    invalid?: boolean;
    status?: 'error' | 'warning' | 'default';
    allowClear?: boolean;
    onClear?: () => void;
    prefix?: JSX.Element;
    suffix?: JSX.Element;
    addonBefore?: JSX.Element;
    addonAfter?: JSX.Element;
    showCount?: boolean;
    countFormatter?: (info: { value: string; count: number; maxLength?: number }) => string;
  };

/** 带壳层的输入框：prefix/suffix、清除、字数统计。 */
export const InputShell: Component<InputShellProps> = (props) => {
  const [local, input] = splitProps(props, [
    'class',
    'size',
    'variant',
    'status',
    'invalid',
    'allowClear',
    'onClear',
    'prefix',
    'suffix',
    'addonBefore',
    'addonAfter',
    'showCount',
    'countFormatter',
    'value',
    'maxLength',
    'disabled',
    'onInput',
  ]);

  const valueText = createMemo(() => String(local.value ?? ''));

  const showClear = () =>
    local.allowClear
    && !local.disabled
    && valueText().length > 0;

  const maxLengthNumber = () => {
    const raw = local.maxLength;
    return typeof raw === 'number' ? raw : undefined;
  };

  const countLabel = createMemo(() => {
    if (!local.showCount) return '';
    const count = valueText().length;
    const maxLength = maxLengthNumber();
    const info = { value: valueText(), count, maxLength };
    return local.countFormatter
      ? local.countFormatter(info)
      : maxLength != null
        ? `${count} / ${maxLength}`
        : String(count);
  });

  const handleClear = () => {
    local.onClear?.();
  };

  const shell = () =>
    inputShellClass({
      size: local.size,
      variant: local.variant,
      status: local.status,
      invalid: local.invalid,
      class: cn('relative', local.class),
    });

  const fieldSize = () => local.size ?? 'md';

  return (
    <div class="flex w-full flex-col gap-4">
      <div class="flex w-full items-stretch">
        <Show when={local.addonBefore}>
          <div class="flex shrink-0 items-center rounded-l-6 border border-r-0 border-border-strong bg-surface-muted px-12 text-13 text-content-muted">
            {local.addonBefore}
          </div>
        </Show>
        <div
          data-slot="input-shell"
          class={cn(
            shell(),
            local.addonBefore ? 'rounded-l-none' : undefined,
            local.addonAfter ? 'rounded-r-none' : undefined,
          )}
        >
          <Show when={local.prefix}>
            <span class="shrink-0 text-content-muted">{local.prefix}</span>
          </Show>
          <input
            {...input}
            value={local.value}
            maxLength={local.maxLength}
            disabled={local.disabled}
            aria-invalid={local.invalid || local.status === 'error' ? 'true' : undefined}
            class={inputFieldVariants({ size: fieldSize() })}
            onInput={local.onInput}
          />
          <Show when={showClear()}>
            <IconButton
              type="button"
              label="Clear"
              showTooltip={false}
              size="sm"
              variant="ghost"
              class="shrink-0 text-content-muted"
              onClick={handleClear}
            >
              <X size={14} aria-hidden="true" />
            </IconButton>
          </Show>
          <Show when={local.suffix}>
            <span class="shrink-0 text-content-muted">{local.suffix}</span>
          </Show>
        </div>
        <Show when={local.addonAfter}>
          <div class="flex shrink-0 items-center rounded-r-6 border border-l-0 border-border-strong bg-surface-muted px-12 text-13 text-content-muted">
            {local.addonAfter}
          </div>
        </Show>
      </div>
      <Show when={local.showCount}>
        <span class="self-end text-11 text-text-muted">{countLabel()}</span>
      </Show>
    </div>
  );
};

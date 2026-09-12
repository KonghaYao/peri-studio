import { createUniqueId, Show, splitProps, type Component, type JSX } from 'solid-js';
import type { InputShellVariantProps } from '../lib/input-variants';
import { InputPassword } from './InputPassword';
import { InputSearch } from './InputSearch';
import { InputShell, type InputShellProps } from './InputShell';

export type InputProps = InputShellProps;

/** 带壳层的文本输入，对齐 Ant Design Input API。 */
export const Input: Component<InputProps> & {
  Password: typeof InputPassword;
  Search: typeof InputSearch;
} = Object.assign((props: InputProps) => <InputShell {...props} />, {
  Password: InputPassword,
  Search: InputSearch,
});

export function TextField(
  props: JSX.InputHTMLAttributes<HTMLInputElement> &
    InputShellVariantProps & {
      label?: string;
      hint?: string;
      error?: string;
      allowClear?: boolean;
      prefix?: JSX.Element;
      suffix?: JSX.Element;
      showCount?: boolean;
    },
) {
  const [local, input] = splitProps(props, [
    'label',
    'hint',
    'error',
    'class',
    'id',
    'aria-describedby',
    'size',
    'variant',
    'status',
    'allowClear',
    'prefix',
    'suffix',
    'showCount',
  ]);
  const generated = createUniqueId();
  const id = () => local.id || `field-${generated}`;
  const hintId = () => (local.hint ? `${id()}-hint` : undefined);
  const errorId = () => (local.error ? `${id()}-error` : undefined);
  const describedBy = () =>
    [local['aria-describedby'], hintId(), errorId()].filter(Boolean).join(' ') || undefined;

  return (
    <div class="mb-9 flex flex-col gap-6">
      <Show when={local.label}>
        <label class="text-12 font-semibold text-text-secondary" for={id()}>
          {local.label}
        </label>
      </Show>
      <Input
        {...input}
        id={id()}
        invalid={!!local.error}
        status={local.error ? 'error' : (local.status ?? undefined)}
        aria-describedby={describedBy()}
        class={local.class}
        size={local.size}
        variant={local.variant}
        allowClear={local.allowClear}
        prefix={local.prefix}
        suffix={local.suffix}
        showCount={local.showCount}
      />
      <Show when={local.hint}>
        <span id={hintId()} class="text-11 text-text-muted">{local.hint}</span>
      </Show>
      <Show when={local.error}>
        <span id={errorId()} class="m-0 text-13 text-danger">{local.error}</span>
      </Show>
    </div>
  );
}

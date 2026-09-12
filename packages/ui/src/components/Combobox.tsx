import type { JSX, ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import {
  Combobox as KCombobox,
  type ComboboxContentProps,
  type ComboboxControlProps,
  type ComboboxInputProps,
  type ComboboxItemProps,
  type ComboboxRootProps,
} from '@kobalte/core/combobox';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../lib/cn';

/**
 * Kobalte Combobox 根：选项与 itemComponent 在 Root 上声明。
 * 未传 optionLabel 时回退到 optionTextValue，避免对象选项在输入框显示为 [object Object]。
 */
function ComboboxRoot<Option, OptGroup = never>(
  props: ComboboxRootProps<Option, OptGroup> & { children?: JSX.Element },
) {
  const [local, rest] = splitProps(props, ['optionLabel', 'optionTextValue']);
  return (
    <KCombobox
      optionLabel={local.optionLabel ?? local.optionTextValue}
      optionTextValue={local.optionTextValue}
      {...rest}
    />
  );
}

export const Combobox = ComboboxRoot as typeof KCombobox;

type ControlProps<Option, T extends ValidComponent = 'div'> = PolymorphicProps<
  T,
  ComboboxControlProps<Option, T> & { class?: string }
>;

/** 输入与触发器容器：视觉对齐 Select 触发器边框与 focus ring。 */
export function ComboboxControl<Option, T extends ValidComponent = 'div'>(
  props: ControlProps<Option, T>,
) {
  const [local, rest] = splitProps(props as ComboboxControlProps<Option> & { class?: string }, ['class']);
  return (
    <KCombobox.Control
      class={cn(
        'flex h-36 w-full items-center gap-8 rounded-6 border border-border-strong bg-surface px-12 text-13 text-text-primary ui-control-transition',
        'focus-within:border-focus-ring focus-within:shadow-accent-ring',
        'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-45',
        local.class,
      )}
      {...rest}
    />
  );
}

type InputProps<T extends ValidComponent = 'input'> = PolymorphicProps<
  T,
  ComboboxInputProps<T> & { class?: string }
>;

/** 可过滤的 combobox 输入：边框由 ComboboxControl 承担。 */
export function ComboboxInput<T extends ValidComponent = 'input'>(props: InputProps<T>) {
  const [local, rest] = splitProps(props as ComboboxInputProps & { class?: string }, ['class']);
  return (
    <KCombobox.Input
      class={cn(
        'min-w-0 flex-1 border-0 bg-transparent text-13 text-text-primary outline-none',
        'placeholder:text-text-faint disabled:cursor-not-allowed disabled:text-text-muted',
        local.class,
      )}
      {...rest}
    />
  );
}

type ContentProps<T extends ValidComponent = 'div'> = PolymorphicProps<
  T,
  ComboboxContentProps<T> & { class?: string }
>;

/** 弹出列表容器：内含 Portal，默认渲染 Kobalte Listbox。 */
export function ComboboxContent<T extends ValidComponent = 'div'>(props: ContentProps<T>) {
  const [local, rest] = splitProps(props as ComboboxContentProps & { class?: string; children?: unknown }, [
    'class',
    'children',
  ]);
  return (
    <KCombobox.Portal>
      <KCombobox.Content
        class={cn(
          'z-(--z-overlay) overflow-hidden rounded-8 border border-border-subtle bg-surface p-4 text-13 text-text-primary shadow-popover outline-none',
          'origin-[var(--kb-combobox-content-transform-origin)] animate-content-hide data-[expanded]:animate-content-show',
          'min-w-(--container-menu-min)',
          local.class,
        )}
        {...rest}
      >
        {local.children ?? <KCombobox.Listbox class="max-h-(--container-search-results) overflow-y-auto outline-none" />}
      </KCombobox.Content>
    </KCombobox.Portal>
  );
}

type ItemProps<T extends ValidComponent = 'div'> = PolymorphicProps<
  T,
  ComboboxItemProps<T> & { class?: string }
>;

/** 下拉选项行：对齐 Select 列表项密度与 hover/selected 态。 */
export function ComboboxItem<T extends ValidComponent = 'div'>(
  props: ItemProps<T>,
) {
  const [local, rest] = splitProps(props as ComboboxItemProps & { class?: string }, ['class']);
  return (
    <KCombobox.Item
      class={cn(
        'flex min-h-36 cursor-pointer items-center rounded-6 px-12 py-8 text-left text-13 text-content-primary outline-none',
        'data-[highlighted]:bg-interaction-hover data-[selected]:font-medium',
        'data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45',
        local.class,
      )}
      {...rest}
    />
  );
}

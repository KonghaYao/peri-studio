import { Combobox as KCombobox } from '@kobalte/core/combobox';
import { createMemo, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import { inputShellClass } from '../lib/input-variants';
import type { InputShellVariantProps } from '../lib/input-variants';
import { FloatingSurface } from './FloatingSurface';
import { floatingPositionedShellClass, menuSurfaceMotion } from '../lib/overlay-motion';

export type AutoCompleteOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type AutoCompleteProps = InputShellVariantProps & {
  options: AutoCompleteOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onSelect?: (value: string, option: AutoCompleteOption) => void;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  class?: string;
  filterOption?: (input: string, option: AutoCompleteOption) => boolean;
  notFoundContent?: JSX.Element;
  'data-testid'?: string;
};

const defaultFilter = (input: string, option: AutoCompleteOption) =>
  option.label.toLowerCase().includes(input.toLowerCase())
  || option.value.toLowerCase().includes(input.toLowerCase());

/** 自动完成：输入框 + 建议下拉，基于 Kobalte Combobox。 */
export const AutoComplete: Component<AutoCompleteProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'options',
    'value',
    'defaultValue',
    'onChange',
    'onSelect',
    'placeholder',
    'disabled',
    'allowClear',
    'class',
    'size',
    'variant',
    'status',
    'filterOption',
    'notFoundContent',
    'data-testid',
  ]);

  const filter = () => local.filterOption ?? defaultFilter;
  const filteredOptions = createMemo(() => {
    const query = local.value ?? local.defaultValue ?? '';
    if (!query) return local.options;
    return local.options.filter((option) => filter()(query, option));
  });

  return (
    <KCombobox<AutoCompleteOption>
      options={filteredOptions()}
      optionValue="value"
      optionTextValue="label"
      optionLabel="label"
      optionDisabled="disabled"
      value={local.options.find((option) => option.value === local.value)}
      defaultValue={local.defaultValue ? local.options.find((option) => option.value === local.defaultValue) : undefined}
      onInputChange={(text) => local.onChange?.(text)}
      onChange={(option) => {
        if (!option) return;
        local.onChange?.(option.value);
        local.onSelect?.(option.value, option);
      }}
      placeholder={local.placeholder}
      disabled={local.disabled}
      itemComponent={(itemProps) => (
        <KCombobox.Item
          item={itemProps.item}
          class={cn(
            'flex min-h-36 cursor-pointer items-center rounded-6 px-12 py-8 text-left text-13 text-content-primary outline-none',
            'data-[highlighted]:bg-interaction-hover data-[selected]:font-medium',
            'data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
          )}
        >
          <KCombobox.ItemLabel>{itemProps.item.rawValue.label}</KCombobox.ItemLabel>
        </KCombobox.Item>
      )}
    >
      <KCombobox.Control
        data-testid={local['data-testid']}
        class={inputShellClass({
          size: local.size,
          variant: local.variant,
          status: local.status,
          class: cn('px-0', local.class),
        })}
      >
        <KCombobox.Input
          class={cn(
            'min-w-0 flex-1 border-0 bg-transparent px-12 text-13 text-text-primary outline-none',
            'placeholder:text-text-faint disabled:cursor-not-allowed disabled:text-text-muted',
          )}
          {...rest}
        />
      </KCombobox.Control>
      <KCombobox.Portal>
        <KCombobox.Content class={floatingPositionedShellClass}>
          <FloatingSurface
            class={cn(
              'z-(--z-overlay) min-w-(--container-menu-min) overflow-hidden rounded-8 border border-border-subtle bg-surface p-4 shadow-popover outline-none',
              'origin-[var(--kb-combobox-content-transform-origin)]',
              menuSurfaceMotion,
            )}
          >
            <KCombobox.Listbox class="max-h-(--container-search-results) overflow-y-auto outline-none" />
            {local.notFoundContent ? (
              <div class="px-12 py-8 text-12 text-text-muted">{local.notFoundContent}</div>
            ) : null}
          </FloatingSurface>
        </KCombobox.Content>
      </KCombobox.Portal>
    </KCombobox>
  );
};

import { Select as KSelect } from '@kobalte/core/select';
import { Check, ChevronDown } from 'lucide-solid';
import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
}

export function Select(props: {
  options: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  /** plain：无边框的文字选择器（Composer 模型名） */
  variant?: 'default' | 'plain';
}) {
  const plain = () => props.variant === 'plain';
  return (
    <KSelect<SelectOption>
      options={props.options}
      optionValue="value"
      optionTextValue="label"
      value={props.options.find((option) => option.value === props.value)}
      onChange={(option) => props.onChange?.(option?.value ?? '')}
      placeholder={props.placeholder}
      disabled={props.disabled}
      itemComponent={(itemProps) => (
        <KSelect.Item
          item={itemProps.item}
          class={cn(
            'flex h-(--control-height-md) cursor-pointer items-center justify-between rounded-sm px-3 text-13 text-content-primary outline-none',
            'data-[highlighted]:bg-interaction-hover data-[selected]:font-medium data-[selected]:text-accent-solid',
          )}
        >
          <KSelect.ItemLabel>{itemProps.item.rawValue.label}</KSelect.ItemLabel>
          <KSelect.ItemIndicator><Check size={14} strokeWidth={2.5} /></KSelect.ItemIndicator>
        </KSelect.Item>
      )}
    >
      <KSelect.Trigger
        class={cn(
          'inline-flex cursor-pointer items-center outline-none transition-colors duration-(--duration-fast)',
          'disabled:cursor-not-allowed disabled:opacity-45',
          plain()
            ? 'h-(--control-height-sm) gap-0.5 px-1 text-12 text-content-secondary hover:text-content-primary focus-visible:text-content-primary'
            : cn(
                'h-(--control-height-md) w-full justify-between gap-2 rounded-md border border-border-strong bg-surface-overlay px-3 text-13 text-content-primary',
                'hover:border-accent-border-hover focus:border-border-focus focus:shadow-(--shadow-focus-ring)',
                'data-[placeholder-shown]:text-content-faint',
              ),
          props.class,
        )}
      >
        <KSelect.Value<SelectOption>>{(state) => state.selectedOption()?.label}</KSelect.Value>
        <KSelect.Icon><ChevronDown size={plain() ? 12 : 14} class="text-content-muted" /></KSelect.Icon>
      </KSelect.Trigger>
      <KSelect.Portal>
        <KSelect.Content class="z-(--z-overlay) rounded-md border border-border-subtle bg-surface-overlay p-1 shadow-overlay">
          <KSelect.Listbox class="outline-none" />
        </KSelect.Content>
      </KSelect.Portal>
    </KSelect>
  );
}

import { Select as KSelect } from '@kobalte/core/select';
import { Check, ChevronDown } from 'lucide-solid';
import { Show, splitProps } from 'solid-js';
import { cn } from '../lib/cn';

export interface SelectOption {
  value: string;
  label: string;
  description?: string | null;
}

export function Select(props: {
  options: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  listClass?: string;
  'data-testid'?: string;
  'aria-label'?: string;
  /** plain：无边框文字触发器（Composer 模型名） */
  variant?: 'default' | 'plain';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [local] = splitProps(props, [
    'options',
    'value',
    'onChange',
    'placeholder',
    'disabled',
    'class',
    'listClass',
    'data-testid',
    'aria-label',
    'variant',
    'open',
    'onOpenChange',
  ]);
  const plain = () => local.variant === 'plain';

  return (
    <KSelect<SelectOption>
      options={local.options}
      optionValue="value"
      optionTextValue="label"
      value={local.options.find((option) => option.value === local.value)}
      onChange={(option) => local.onChange?.(option?.value ?? '')}
      placeholder={local.placeholder}
      disabled={local.disabled}
      open={local.open}
      onOpenChange={local.onOpenChange}
      itemComponent={(itemProps) => (
        <KSelect.Item
          item={itemProps.item}
          class={cn(
            'grid min-h-32 cursor-pointer grid-cols-split-auto items-start gap-x-14 gap-y-2 rounded-6 px-12 py-8 text-left text-13 text-content-primary outline-none',
            'data-[highlighted]:bg-interaction-hover data-[selected]:font-medium',
          )}
        >
          <KSelect.ItemLabel class="min-w-0 text-12 leading-snug">
            {itemProps.item.rawValue.label}
          </KSelect.ItemLabel>
          <KSelect.ItemIndicator class="text-accent">
            <Check size={14} strokeWidth={2.5} aria-hidden="true" />
          </KSelect.ItemIndicator>
          <Show when={itemProps.item.rawValue.description}>
            <small class="col-span-full text-10p5 leading-145 text-text-muted">
              {itemProps.item.rawValue.description}
            </small>
          </Show>
        </KSelect.Item>
      )}
    >
      <KSelect.Trigger
        data-testid={local['data-testid']}
        aria-label={local['aria-label']}
        class={cn(
          'inline-flex max-w-full min-w-0 cursor-pointer items-center outline-none transition-colors duration-(--duration-fast)',
          'disabled:cursor-not-allowed disabled:opacity-45',
          plain()
            ? 'h-28 gap-2 border-0 bg-transparent px-4 text-12 text-content-secondary hover:text-content-primary focus-visible:text-content-primary'
            : cn(
                'h-32 w-full justify-between gap-8 rounded-6 border border-border-strong bg-surface px-12 text-13 text-text-primary',
                'hover:border-accent-border-hover focus:border-focus-ring focus:shadow-accent-ring',
                'data-[placeholder-shown]:text-text-faint',
              ),
          local.class,
        )}
      >
        <KSelect.Value<SelectOption>>
          {(state) => (
            <span class="min-w-0 truncate">{state.selectedOption()?.label ?? local.placeholder}</span>
          )}
        </KSelect.Value>
        <KSelect.Icon>
          <ChevronDown size={plain() ? 12 : 14} class="shrink-0 text-content-muted" strokeWidth={1.7} />
        </KSelect.Icon>
      </KSelect.Trigger>
      <KSelect.Portal>
        <KSelect.Content
          class={cn(
            'z-(--z-overlay) overflow-hidden rounded-8 border border-border-subtle bg-surface p-4 shadow-popover outline-none',
            'origin-[var(--kb-select-content-transform-origin)] animate-content-hide data-[expanded]:animate-content-show',
            local.listClass ?? 'min-w-(--container-menu-min)',
          )}
        >
          <KSelect.Listbox class="outline-none" />
        </KSelect.Content>
      </KSelect.Portal>
    </KSelect>
  );
}

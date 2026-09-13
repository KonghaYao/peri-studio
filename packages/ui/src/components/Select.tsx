import { Select as KSelect } from '@kobalte/core/select';
import { Check, ChevronDown, X } from 'lucide-solid';
import { Show, createMemo, createSignal, splitProps } from 'solid-js';
import { Input } from './Field';
import { cn } from '../lib/cn';
import { resolveInputStatus } from '../lib/input-variants';
import { IconButton } from './Button';
import { FloatingSurface } from './FloatingSurface';
import { Spinner } from './Spinner';
import { floatingPositionedShellClass, menuSurfaceMotion } from '../lib/overlay-motion';

export interface SelectOption {
  value: string;
  label: string;
  description?: string | null;
  disabled?: boolean;
}

export interface SelectOptionGroup {
  label: string;
  options: SelectOption[];
}

type SelectMode = 'default' | 'multiple' | 'tags';

type SelectBaseProps = {
  options?: SelectOption[];
  optionGroups?: SelectOptionGroup[];
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  listClass?: string;
  'data-testid'?: string;
  'aria-label'?: string;
  variant?: 'default' | 'plain';
  mode?: SelectMode;
  allowClear?: boolean;
  loading?: boolean;
  showSearch?: boolean;
  status?: 'error' | 'warning' | 'default';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  maxTagCount?: number;
  /** 长列表虚拟滚动，仅渲染可视窗口内的选项。 */
  virtualScroll?: boolean;
  virtualItemHeight?: number;
};

type SelectSingleProps = SelectBaseProps & {
  value?: string;
  onChange?: (value: string) => void;
};

type SelectMultipleProps = SelectBaseProps & {
  value?: string[];
  onChange?: (value: string[]) => void;
  mode: 'multiple' | 'tags';
};

export function Select(props: SelectSingleProps | SelectMultipleProps) {
  const [local] = splitProps(props, [
    'options',
    'optionGroups',
    'value',
    'onChange',
    'placeholder',
    'disabled',
    'class',
    'listClass',
    'data-testid',
    'aria-label',
    'variant',
    'mode',
    'allowClear',
    'loading',
    'showSearch',
    'status',
    'open',
    'onOpenChange',
    'maxTagCount',
    'virtualScroll',
    'virtualItemHeight',
  ]);

  const plain = () => local.variant === 'plain';
  const multiple = () => local.mode === 'multiple' || local.mode === 'tags';
  const [searchTerm, setSearchTerm] = createSignal('');
  const [scrollTop, setScrollTop] = createSignal(0);
  const itemHeight = () => local.virtualItemHeight ?? 36;
  const viewportHeight = () => 288;

  const flatOptions = createMemo(() => {
    if (local.options) return local.options;
    return (local.optionGroups ?? []).flatMap((group) => group.options);
  });

  const filteredOptions = createMemo(() => {
    const term = searchTerm().trim().toLowerCase();
    if (!local.showSearch || !term) return flatOptions();
    return flatOptions().filter((option) => option.label.toLowerCase().includes(term));
  });

  const selectedOptions = createMemo(() => {
    const values = multiple()
      ? (Array.isArray(local.value) ? local.value : [])
      : local.value ? [local.value as string] : [];
    return flatOptions().filter((option) => values.includes(option.value));
  });

  const virtualWindow = createMemo(() => {
    const options = filteredOptions();
    if (!local.virtualScroll || options.length === 0) {
      return { options, paddingTop: 0, paddingBottom: 0 };
    }
    const height = itemHeight();
    const start = Math.max(0, Math.floor(scrollTop() / height) - 2);
    const visibleCount = Math.ceil(viewportHeight() / height) + 4;
    const end = Math.min(options.length, start + visibleCount);
    const slice = options.slice(start, end);
    const merged = [...slice];
    for (const option of selectedOptions()) {
      if (!merged.some((item) => item.value === option.value)) merged.push(option);
    }
    return {
      options: merged,
      paddingTop: start * height,
      paddingBottom: Math.max(0, (options.length - end) * height),
    };
  });

  const groupHeaderFor = (value: string) => {
    for (const group of local.optionGroups ?? []) {
      if (group.options[0]?.value === value) return group.label;
    }
    return undefined;
  };

  const kobalteValue = createMemo(() => {
    if (multiple()) return selectedOptions();
    return flatOptions().find((option) => option.value === local.value);
  });

  const statusClass = () => {
    const status = resolveInputStatus(false, local.status ?? 'default');
    if (plain()) return '';
    if (status === 'error') return 'border-danger focus:border-danger';
    if (status === 'warning') return 'border-warning focus:border-warning';
    return 'border-border-strong hover:border-accent-border-hover focus:border-focus-ring focus:shadow-accent-ring';
  };

  const handleChange = (option: SelectOption | SelectOption[] | null) => {
    if (multiple()) {
      const next = (option as SelectOption[] | null)?.map((item) => item.value) ?? [];
      (local.onChange as ((value: string[]) => void) | undefined)?.(next);
      return;
    }
    (local.onChange as ((value: string) => void) | undefined)?.((option as SelectOption | null)?.value ?? '');
  };

  const clearValue = () => {
    if (multiple()) (local.onChange as ((value: string[]) => void) | undefined)?.([]);
    else (local.onChange as ((value: string) => void) | undefined)?.('');
  };

  const triggerLabel = () => {
    if (multiple()) {
      const selected = selectedOptions();
      if (selected.length === 0) return local.placeholder;
      const limit = local.maxTagCount ?? selected.length;
      const visible = selected.slice(0, limit);
      const overflow = selected.length - visible.length;
      const tags = visible.map((option) => option.label).join(', ');
      return overflow > 0 ? `${tags} +${overflow}` : tags;
    }
    return selectedOptions()[0]?.label ?? local.placeholder;
  };

  const selectionProps = () =>
    multiple()
      ? { multiple: true as const, value: kobalteValue() as SelectOption[] }
      : { value: kobalteValue() as SelectOption | undefined };

  return (
    <KSelect<SelectOption>
      options={local.virtualScroll ? virtualWindow().options : filteredOptions()}
      optionValue="value"
      optionTextValue="label"
      optionDisabled="disabled"
      {...selectionProps()}
      onChange={handleChange}
      placeholder={local.placeholder}
      disabled={local.disabled || local.loading}
      open={local.open}
      onOpenChange={local.onOpenChange}
      itemComponent={(itemProps) => {
        const header = groupHeaderFor(itemProps.item.rawValue.value);
        return (
          <>
            <Show when={header}>
              <div class="px-12 py-4 text-11 font-medium text-content-muted">{header}</div>
            </Show>
            <KSelect.Item
              item={itemProps.item}
              class={cn(
                'grid min-h-36 cursor-pointer grid-cols-split-auto items-start gap-x-14 gap-y-2 rounded-6 px-12 py-8 text-left text-13 text-content-primary outline-none',
                'data-[highlighted]:bg-interaction-hover data-[selected]:font-medium',
                'data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
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
          </>
        );
      }}
    >
      <KSelect.Trigger
        data-testid={local['data-testid']}
        aria-label={local['aria-label']}
        class={cn(
          'inline-flex max-w-full min-w-0 cursor-pointer items-center outline-none transition-colors duration-(--duration-fast)',
          'disabled:cursor-not-allowed disabled:opacity-45',
          plain()
            ? 'h-32 gap-2 border-0 bg-transparent px-4 text-12 text-content-secondary hover:text-content-primary focus-visible:text-content-primary'
            : cn(
                'h-36 w-full justify-between gap-8 rounded-6 border bg-surface px-12 text-13 text-text-primary',
                statusClass(),
                'data-[placeholder-shown]:text-text-faint',
              ),
          local.class,
        )}
      >
        <KSelect.Value<SelectOption>>
          {() => <span class="min-w-0 truncate">{triggerLabel()}</span>}
        </KSelect.Value>
        <div class="flex shrink-0 items-center gap-4">
          <Show when={local.loading}>
            <Spinner class="text-content-muted" decorative />
          </Show>
          <Show when={local.allowClear && selectedOptions().length > 0 && !local.disabled}>
            <IconButton
              type="button"
              label="Clear"
              showTooltip={false}
              size="sm"
              variant="ghost"
              class="text-content-muted"
              onClick={(event) => {
                event.stopPropagation();
                clearValue();
              }}
            >
              <X size={14} aria-hidden="true" />
            </IconButton>
          </Show>
          <KSelect.Icon>
            <ChevronDown size={plain() ? 12 : 14} class="shrink-0 text-content-muted" strokeWidth={1.7} />
          </KSelect.Icon>
        </div>
      </KSelect.Trigger>
      <KSelect.Portal>
        <KSelect.Content class={floatingPositionedShellClass}>
          <FloatingSurface
            class={cn(
              'z-(--z-overlay) overflow-hidden rounded-8 border border-border-subtle bg-surface p-4 shadow-popover outline-none',
              'origin-[var(--kb-select-content-transform-origin)]',
              menuSurfaceMotion,
              local.listClass ?? (plain()
                ? 'w-max min-w-0 max-w-(--container-model-menu)'
                : 'min-w-(--container-menu-min)'),
            )}
          >
            <Show when={local.showSearch}>
              <Input
                class="mb-4"
                placeholder="Search"
                value={searchTerm()}
                onInput={(event) => setSearchTerm(event.currentTarget.value)}
              />
            </Show>
            <div
              class="max-h-(--container-search-results) overflow-y-auto outline-none"
              onScroll={(event) => {
                if (local.virtualScroll) {
                  setScrollTop(event.currentTarget.scrollTop);
                }
              }}
            >
              <Show when={local.virtualScroll}>
                <div style={{ height: `${virtualWindow().paddingTop}px` }} aria-hidden="true" />
              </Show>
              <KSelect.Listbox class="outline-none" />
              <Show when={local.virtualScroll}>
                <div style={{ height: `${virtualWindow().paddingBottom}px` }} aria-hidden="true" />
              </Show>
            </div>
          </FloatingSurface>
        </KSelect.Content>
      </KSelect.Portal>
    </KSelect>
  );
}

import { ChevronRight } from 'lucide-solid';
import {
  For,
  Show,
  createMemo,
  createSignal,
  splitProps,
  type Component,
} from 'solid-js';
import { cn } from '../lib/cn';
import { inputShellClass } from '../lib/input-variants';
import type { InputShellVariantProps } from '../lib/input-variants';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';

export type CascaderOption = {
  value: string;
  label: string;
  disabled?: boolean;
  children?: CascaderOption[];
};

export type CascaderProps = InputShellVariantProps & {
  options: CascaderOption[];
  value?: string[];
  defaultValue?: string[];
  onChange?: (value: string[], selectedOptions: CascaderOption[]) => void;
  placeholder?: string;
  disabled?: boolean;
  expandTrigger?: 'click' | 'hover';
  changeOnSelect?: boolean;
  class?: string;
  displayRender?: (labels: string[]) => string;
  'data-testid'?: string;
};

function findPath(options: CascaderOption[], values: string[]): CascaderOption[] {
  const path: CascaderOption[] = [];
  let current = options;
  for (const value of values) {
    const match = current.find((option) => option.value === value);
    if (!match) break;
    path.push(match);
    current = match.children ?? [];
  }
  return path;
}

/** 级联选择：多列菜单弹出层。 */
export const Cascader: Component<CascaderProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'options',
    'value',
    'defaultValue',
    'onChange',
    'placeholder',
    'disabled',
    'expandTrigger',
    'changeOnSelect',
    'class',
    'size',
    'variant',
    'status',
    'displayRender',
    'data-testid',
  ]);

  const [internal, setInternal] = createSignal<string[]>(local.defaultValue ?? []);
  const [open, setOpen] = createSignal(false);
  const [activePath, setActivePath] = createSignal<string[]>([]);

  const value = createMemo(() => local.value ?? internal());
  const selectedPath = createMemo(() => findPath(local.options, value()));
  const label = createMemo(() => {
    const labels = selectedPath().map((option) => option.label);
    if (labels.length === 0) return local.placeholder ?? 'Select';
    return local.displayRender ? local.displayRender(labels) : labels.join(' / ');
  });

  const commit = (next: string[], options: CascaderOption[]) => {
    if (local.value === undefined) setInternal(next);
    local.onChange?.(next, options);
  };

  const columns = createMemo(() => {
    const cols: CascaderOption[][] = [local.options];
    let current = local.options;
    for (const segment of activePath()) {
      const match = current.find((option) => option.value === segment);
      if (!match?.children?.length) break;
      cols.push(match.children);
      current = match.children;
    }
    return cols;
  });

  const selectOption = (columnIndex: number, option: CascaderOption) => {
    const nextPath = [...activePath().slice(0, columnIndex), option.value];
    setActivePath(nextPath);
    const selected = findPath(local.options, nextPath);
    if (!option.children?.length || local.changeOnSelect) {
      commit(nextPath, selected);
      if (!option.children?.length) setOpen(false);
    }
  };

  const trigger = local.expandTrigger ?? 'click';

  return (
    <Popover open={open()} onOpenChange={setOpen}>
      <PopoverTrigger
        as="button"
        type="button"
        disabled={local.disabled}
        data-testid={local['data-testid']}
        class={inputShellClass({
          size: local.size,
          variant: local.variant,
          status: local.status,
          class: cn('justify-between text-left', local.class),
        })}
        {...rest}
      >
        <span class={cn('min-w-0 truncate', selectedPath().length === 0 && 'text-text-faint')}>
          {label()}
        </span>
        <ChevronRight size={14} class="shrink-0 rotate-90 text-content-muted" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent class="w-auto p-0">
        <div class="flex max-h-(--container-search-results) overflow-hidden">
          <For each={columns()}>
            {(column, columnIndex) => (
              <div class="min-w-(--container-menu-min) border-r border-border-subtle last:border-r-0">
                <For each={column}>
                  {(option) => (
                    <button
                      type="button"
                      disabled={option.disabled}
                      class={cn(
                        'flex w-full min-h-36 items-center justify-between gap-8 px-12 py-8 text-left text-13 text-content-primary',
                        'hover:bg-interaction-hover disabled:cursor-not-allowed disabled:opacity-45',
                        activePath()[columnIndex()] === option.value && 'bg-interaction-hover font-medium',
                      )}
                      onClick={() => selectOption(columnIndex(), option)}
                      onMouseEnter={() => {
                        if (trigger === 'hover' && option.children?.length) {
                          const next = [...activePath().slice(0, columnIndex()), option.value];
                          setActivePath(next);
                        }
                      }}
                    >
                      <span class="truncate">{option.label}</span>
                      <Show when={option.children?.length}>
                        <ChevronRight size={14} class="shrink-0 text-content-muted" aria-hidden="true" />
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </PopoverContent>
    </Popover>
  );
};

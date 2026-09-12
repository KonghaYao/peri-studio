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
import { FloatingSurface } from './FloatingSurface';

export type MentionsOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type MentionsProps = InputShellVariantProps & {
  options: MentionsOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onSelect?: (option: MentionsOption, prefix: string) => void;
  placeholder?: string;
  disabled?: boolean;
  prefix?: string | string[];
  split?: string;
  rows?: number;
  class?: string;
  filterOption?: (input: string, option: MentionsOption) => boolean;
  notFoundContent?: string;
  'data-testid'?: string;
};

const defaultFilter = (input: string, option: MentionsOption) =>
  option.label.toLowerCase().includes(input.toLowerCase())
  || option.value.toLowerCase().includes(input.toLowerCase());

function getActiveMention(value: string, prefixes: string[]) {
  for (const prefix of prefixes) {
    const index = value.lastIndexOf(prefix);
    if (index === -1) continue;
    const tail = value.slice(index + prefix.length);
    if (tail.includes(' ') || tail.includes('\n')) continue;
    return { prefix, query: tail, start: index };
  }
  return null;
}

/** @ 提及输入：检测 prefix 后弹出建议列表。 */
export const Mentions: Component<MentionsProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'options',
    'value',
    'defaultValue',
    'onChange',
    'onSelect',
    'placeholder',
    'disabled',
    'prefix',
    'split',
    'rows',
    'class',
    'size',
    'variant',
    'status',
    'filterOption',
    'notFoundContent',
    'data-testid',
  ]);

  const [internal, setInternal] = createSignal(local.defaultValue ?? '');
  const [open, setOpen] = createSignal(false);
  const [highlight, setHighlight] = createSignal(0);

  const value = createMemo(() => local.value ?? internal());
  const prefixes = createMemo(() => {
    const raw = local.prefix ?? '@';
    return Array.isArray(raw) ? raw : [raw];
  });

  const active = createMemo(() => getActiveMention(value(), prefixes()));
  const filtered = createMemo(() => {
    const mention = active();
    if (!mention) return [];
    const filter = local.filterOption ?? defaultFilter;
    return local.options.filter((option) => filter(mention.query, option) && !option.disabled);
  });

  const commitValue = (next: string) => {
    if (local.value === undefined) setInternal(next);
    local.onChange?.(next);
  };

  const selectOption = (option: MentionsOption) => {
    const mention = active();
    if (!mention) return;
    const split = local.split ?? ' ';
    const before = value().slice(0, mention.start);
    const afterStart = mention.start + mention.prefix.length + mention.query.length;
    const next = `${before}${mention.prefix}${option.value}${split}${value().slice(afterStart)}`;
    commitValue(next);
    local.onSelect?.(option, mention.prefix);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!open() || filtered().length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((index) => (index + 1) % filtered().length);
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((index) => (index - 1 + filtered().length) % filtered().length);
    }
    if (event.key === 'Enter' && open()) {
      event.preventDefault();
      const option = filtered()[highlight()];
      if (option) selectOption(option);
    }
    if (event.key === 'Escape') setOpen(false);
  };

  return (
    <div class="relative w-full" data-testid={local['data-testid']}>
      <textarea
        {...rest}
        rows={local.rows ?? 3}
        disabled={local.disabled}
        placeholder={local.placeholder}
        value={value()}
        class={cn(
          inputShellClass({
            size: local.size,
            variant: local.variant,
            status: local.status,
            class: cn('block min-h-36 resize-y py-8', local.class),
          }),
          'field-sizing-content',
        )}
        onInput={(event) => {
          commitValue(event.currentTarget.value);
          setOpen(!!getActiveMention(event.currentTarget.value, prefixes()));
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      />
      <Show when={open() && filtered().length > 0}>
        <FloatingSurface
          class={cn(
            'absolute inset-x-0 top-full z-(--z-overlay) mt-4 overflow-hidden rounded-8 border border-border-subtle bg-surface p-4 shadow-popover',
          )}
        >
          <For each={filtered()}>
            {(option, index) => (
              <button
                type="button"
                class={cn(
                  'flex w-full min-h-32 items-center rounded-6 px-12 py-6 text-left text-13 text-content-primary',
                  'hover:bg-interaction-hover',
                  highlight() === index() && 'bg-interaction-hover',
                )}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectOption(option);
                }}
              >
                {option.label}
              </button>
            )}
          </For>
        </FloatingSurface>
      </Show>
      <Show when={open() && filtered().length === 0}>
        <div class="absolute inset-x-0 top-full z-(--z-overlay) mt-4 rounded-8 border border-border-subtle bg-surface px-12 py-8 text-12 text-text-muted shadow-popover">
          {local.notFoundContent ?? 'No suggestions'}
        </div>
      </Show>
    </div>
  );
};

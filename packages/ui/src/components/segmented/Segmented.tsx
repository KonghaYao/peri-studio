import { cva, type VariantProps } from 'class-variance-authority';
import { For, splitProps, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';

const segmentedVariants = cva(
  'inline-flex rounded-8 bg-surface-muted p-2 text-13 text-content-secondary',
  {
    variants: {
      size: {
        sm: 'text-12',
        md: 'text-13',
        lg: 'text-14',
      },
      block: {
        true: 'flex w-full',
        false: 'inline-flex',
      },
      vertical: {
        true: 'flex-col',
        false: 'flex-row',
      },
    },
    defaultVariants: {
      size: 'md',
      block: false,
      vertical: false,
    },
  },
);

const itemVariants = cva(
  'relative inline-flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-6 rounded-6 border border-transparent px-12 py-6 font-medium transition-colors outline-none focus-visible:outline-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-45',
  {
    variants: {
      selected: {
        true: 'bg-surface text-content-primary shadow-sm',
        false: 'hover:text-content-primary',
      },
      size: {
        sm: 'h-28 px-10 py-4 text-12',
        md: 'h-32 px-12 py-6 text-13',
        lg: 'h-40 px-14 py-8 text-14',
      },
    },
    defaultVariants: {
      selected: false,
      size: 'md',
    },
  },
);

type SegmentedVariantProps = VariantProps<typeof segmentedVariants>;

export type SegmentedOption<T extends string | number = string> = {
  label: JSX.Element;
  value: T;
  disabled?: boolean;
  icon?: JSX.Element;
};

export type SegmentedProps<T extends string | number = string> = SegmentedVariantProps & {
  class?: string;
  options: SegmentedOption<T>[];
  value?: T;
  defaultValue?: T;
  disabled?: boolean;
  onChange?: (value: T) => void;
};

/** 分段控制器：与 ButtonGroup 不同，用于互斥选项切换。 */
export function Segmented<T extends string | number = string>(props: SegmentedProps<T>) {
  const [local, rest] = splitProps(props, [
    'class',
    'options',
    'value',
    'defaultValue',
    'disabled',
    'onChange',
    'size',
    'block',
    'vertical',
  ]);

  const current = () => local.value ?? local.defaultValue ?? local.options[0]?.value;

  return (
    <div
      role="radiogroup"
      data-slot="segmented"
      class={cn(segmentedVariants({ size: local.size, block: local.block, vertical: local.vertical }), local.class)}
      {...rest}
    >
      <For each={local.options}>
        {(option) => {
          const selected = () => current() === option.value;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={selected()}
              disabled={local.disabled || option.disabled}
              class={cn(itemVariants({ selected: selected(), size: local.size }))}
              onClick={() => {
                if (!selected()) local.onChange?.(option.value);
              }}
            >
              <ShowIcon icon={option.icon} />
              <span class="truncate">{option.label}</span>
            </button>
          );
        }}
      </For>
    </div>
  );
}

function ShowIcon(props: { icon?: JSX.Element }) {
  return props.icon ? <span class="shrink-0" aria-hidden="true">{props.icon}</span> : null;
}

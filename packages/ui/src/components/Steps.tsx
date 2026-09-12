import { Check, X } from 'lucide-solid';
import { cva } from 'class-variance-authority';
import { For, Show, splitProps, type Component, type ComponentProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';

export type StepStatus = 'wait' | 'process' | 'finish' | 'error';

export type StepItem = {
  key?: string | number;
  title?: JSX.Element;
  description?: JSX.Element;
  content?: JSX.Element;
  icon?: JSX.Element;
  status?: StepStatus;
  disabled?: boolean;
};

type StepsProps = ComponentProps<'div'> & {
  items?: StepItem[];
  current?: number;
  direction?: 'horizontal' | 'vertical';
  size?: 'default' | 'small';
  status?: StepStatus;
  variant?: 'default' | 'dot';
  onChange?: (current: number) => void;
};

const iconVariants = cva(
  'flex shrink-0 items-center justify-center rounded-full border text-12 font-medium transition-colors',
  {
    variants: {
      status: {
        wait: 'border-border-strong bg-surface text-content-muted',
        process: 'border-accent-solid bg-accent-solid text-content-on-accent',
        finish: 'border-accent-solid bg-surface text-accent-solid',
        error: 'border-danger bg-danger-soft text-danger',
      },
      size: {
        default: 'size-28',
        small: 'size-24 text-11',
      },
      dot: {
        true: 'size-8 border-0 p-0',
        false: '',
      },
    },
    compoundVariants: [
      { dot: true, status: 'wait', class: 'bg-border-strong' },
      { dot: true, status: 'process', class: 'bg-accent-solid' },
      { dot: true, status: 'finish', class: 'bg-accent-solid' },
      { dot: true, status: 'error', class: 'bg-danger' },
    ],
    defaultVariants: { status: 'wait', size: 'default', dot: false },
  },
);

function resolveItemStatus(
  index: number,
  current: number,
  item: StepItem,
  rootStatus?: StepStatus,
): StepStatus {
  if (item.status) return item.status;
  if (index < current) return 'finish';
  if (index === current) return rootStatus ?? 'process';
  return 'wait';
}

function StepIcon(props: { status: StepStatus; size: 'default' | 'small'; dot: boolean; icon?: JSX.Element; index: number }) {
  return (
    <span
      data-slot="steps-icon"
      class={iconVariants({ status: props.status, size: props.size, dot: props.dot })}
      aria-hidden="true"
    >
      <Show when={props.dot} fallback={
        <Show
          when={props.icon}
          fallback={
            <Show when={props.status === 'finish'} fallback={
              <Show when={props.status === 'error'} fallback={<span>{props.index + 1}</span>}>
                <X size={14} />
              </Show>
            }>
              <Check size={14} />
            </Show>
          }
        >
          {props.icon}
        </Show>
      }>
        <span class="size-full rounded-full" />
      </Show>
    </span>
  );
}

export const Steps: Component<StepsProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'items',
    'current',
    'direction',
    'size',
    'status',
    'variant',
    'onChange',
  ]);

  const direction = () => local.direction ?? 'horizontal';
  const size = () => local.size ?? 'default';
  const current = () => local.current ?? 0;
  const isDot = () => local.variant === 'dot';

  return (
    <div
      data-slot="steps"
      data-direction={direction()}
      data-variant={local.variant ?? 'default'}
      class={cn(
        'flex w-full',
        direction() === 'vertical' ? 'flex-col gap-16' : 'flex-row items-start',
        local.class,
      )}
      {...rest}
    >
      <For each={local.items}>
        {(item, index) => {
          const status = () => resolveItemStatus(index(), current(), item, local.status);
          const isLast = () => index() === (local.items?.length ?? 0) - 1;

          return (
            <div
              data-slot="steps-item"
              data-status={status()}
              class={cn(
                'relative flex min-w-0',
                direction() === 'vertical' ? 'flex-row gap-12' : 'flex-1 flex-col items-center text-center',
                item.disabled && 'opacity-45',
              )}
            >
              <div
                class={cn(
                  'flex items-center',
                  direction() === 'vertical' ? 'flex-col' : 'w-full flex-col gap-8',
                )}
              >
                <button
                  type="button"
                  class={cn(
                    'inline-flex items-center gap-8',
                    direction() === 'horizontal' && 'flex-col',
                    !item.disabled && 'cursor-pointer',
                  )}
                  disabled={item.disabled}
                  onClick={() => !item.disabled && local.onChange?.(index())}
                >
                  <StepIcon
                    status={status()}
                    size={size()}
                    dot={isDot()}
                    icon={item.icon}
                    index={index()}
                  />
                  <div class={cn('min-w-0', direction() === 'horizontal' && 'px-8')}>
                    {item.title && (
                      <div data-slot="steps-title" class="text-13 font-medium text-content-primary">
                        {item.title}
                      </div>
                    )}
                    {(item.description ?? item.content) && (
                      <div data-slot="steps-description" class="mt-2 text-12 text-content-muted">
                        {item.description ?? item.content}
                      </div>
                    )}
                  </div>
                </button>
                <Show when={!isLast()}>
                  <span
                    data-slot="steps-rail"
                    class={cn(
                      'bg-border-subtle',
                      direction() === 'vertical'
                        ? 'ml-12 h-full min-h-16 w-px flex-1'
                        : 'mt-8 h-px w-full max-w-full flex-1',
                    )}
                    aria-hidden="true"
                  />
                </Show>
              </div>
            </div>
          );
        }}
      </For>
      {local.children}
    </div>
  );
};

import { cva, type VariantProps } from 'class-variance-authority';
import { For, Show, splitProps, type Component, type ComponentProps, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';

const timelineVariants = cva('relative m-0 list-none p-0', {
  variants: {
    mode: {
      left: '',
      alternate: '',
      right: '',
    },
    pending: {
      true: '',
      false: '',
    },
  },
  defaultVariants: {
    mode: 'left',
  },
});

type TimelineVariantProps = VariantProps<typeof timelineVariants>;

export type TimelineItem = {
  key?: string;
  label?: JSX.Element;
  children: JSX.Element;
  color?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  dot?: JSX.Element;
  pending?: boolean;
};

export type TimelineProps = ComponentProps<'ul'> &
  TimelineVariantProps & {
    items?: TimelineItem[];
    pending?: boolean | JSX.Element;
    pendingDot?: JSX.Element;
  };

const dotColorClass: Record<string, string> = {
  success: 'border-success bg-success',
  warning: 'border-warning bg-warning',
  danger: 'border-danger bg-danger',
  info: 'border-accent bg-accent-solid',
  neutral: 'border-border-strong bg-surface-muted',
};

/** 时间轴：支持 pending、alternate 与自定义 dot。 */
export const Timeline: Component<TimelineProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'items', 'mode', 'pending', 'pendingDot']);
  const items = () => local.items ?? [];

  return (
    <ul
      data-slot="timeline"
      class={cn(timelineVariants({ mode: local.mode }), local.class)}
      {...rest}
    >
      <For each={items()}>
        {(item, index) => (
          <li
            data-slot="timeline-item"
            class={cn(
              'relative pb-20 pl-24 last:pb-0',
              local.mode === 'alternate' && index() % 2 === 1 ? 'pl-0 pr-24 text-right' : '',
            )}
          >
            <span
              class="absolute top-4 left-0 flex size-12 items-center justify-center"
              aria-hidden="true"
            >
              <Show
                when={item.dot}
                fallback={(
                  <span
                    class={cn(
                      'size-10 rounded-full border-2',
                      dotColorClass[item.color ?? 'info'],
                      item.pending ? 'border-dashed bg-transparent' : '',
                    )}
                  />
                )}
              >
                {item.dot}
              </Show>
            </span>
            <span
              class="absolute top-16 left-5 h-full w-px bg-border-subtle last:hidden"
              aria-hidden="true"
            />
            <Show when={item.label}>
              <div class="mb-4 text-12 text-content-muted">{item.label}</div>
            </Show>
            <div class="text-13 text-content-primary">{item.children}</div>
          </li>
        )}
      </For>
      <Show when={local.pending}>
        <li data-slot="timeline-pending" class="relative pl-24 text-12 text-content-muted">
          <span class="absolute top-2 left-0 flex size-12 items-center justify-center" aria-hidden="true">
            {typeof local.pending === 'boolean' ? (
              <span class="size-10 rounded-full border-2 border-dashed border-border-strong" />
            ) : (
              local.pendingDot ?? local.pending
            )}
          </span>
          {typeof local.pending === 'boolean' ? 'Pending…' : local.pending}
        </li>
      </Show>
    </ul>
  );
};

export const TimelineItem: Component<TimelineItem & ComponentProps<'li'>> = (props) => {
  const [local, rest] = splitProps(props, ['children', 'label', 'class']);
  return (
    <li class={local.class} {...rest}>
      <Show when={local.label}>
        <div class="mb-4 text-12 text-content-muted">{local.label}</div>
      </Show>
      <div>{local.children}</div>
    </li>
  );
};

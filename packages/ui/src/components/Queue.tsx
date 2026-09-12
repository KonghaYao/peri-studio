import { splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../lib/cn';

type QueueRootProps = ComponentProps<'ul'>;

export const Queue: Component<QueueRootProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <ul
      data-slot="queue"
      role="list"
      class={cn(
        'm-0 flex w-full list-none flex-col gap-4 rounded-8 border border-border-subtle bg-surface p-8',
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </ul>
  );
};

export const QueueItem: Component<ComponentProps<'li'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <li
      data-slot="queue-item"
      class={cn(
        'flex min-w-0 items-center gap-10 rounded-6 px-8 py-6 text-13 text-content-primary',
        'transition-colors duration-120 hover:bg-interaction-hover',
        local.class,
      )}
      {...rest}
    />
  );
};

type QueueItemIndicatorProps = ComponentProps<'span'> & {
  completed?: boolean;
};

export const QueueItemIndicator: Component<QueueItemIndicatorProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'completed']);
  const completed = () => local.completed ?? false;

  return (
    <span
      data-slot="queue-item-indicator"
      data-completed={completed() ? 'true' : 'false'}
      class={cn(
        'size-8 shrink-0 rounded-full',
        completed() ? 'bg-success' : 'border-2 border-border-strong bg-transparent',
        local.class,
      )}
      aria-hidden="true"
      {...rest}
    />
  );
};

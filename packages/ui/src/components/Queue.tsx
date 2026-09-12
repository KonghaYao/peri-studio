import { ChevronDown, Paperclip } from 'lucide-solid';
import { splitProps, type Component, type ComponentProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './Collapsible';
import { ScrollArea, ScrollAreaViewport } from './ScrollArea';

export interface QueueMessagePart {
  type: string;
  text?: string;
  url?: string;
  filename?: string;
  mediaType?: string;
}

export interface QueueMessage {
  id: string;
  parts: QueueMessagePart[];
}

export interface QueueTodo {
  id: string;
  title: string;
  description?: string;
  status?: 'pending' | 'completed';
}

/** 队列面板根容器。 */
export const Queue: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="queue"
      class={cn(
        'flex flex-col gap-8 rounded-12 border border-border-subtle bg-surface px-12 pt-8 pb-8',
        local.class,
      )}
      {...rest}
    />
  );
};

export const QueueItem: Component<ComponentProps<'li'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <li
      data-slot="queue-item"
      class={cn(
        'group flex flex-col gap-4 rounded-6 px-12 py-4 text-13 transition-colors duration-120 hover:bg-interaction-hover',
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
        'mt-2 inline-block size-10 shrink-0 rounded-full border',
        completed()
          ? 'border-content-muted/20 bg-content-muted/10'
          : 'border-content-muted/50 bg-transparent',
        local.class,
      )}
      aria-hidden="true"
      {...rest}
    />
  );
};

type QueueItemContentProps = ComponentProps<'span'> & {
  completed?: boolean;
};

export const QueueItemContent: Component<QueueItemContentProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'completed']);
  const completed = () => local.completed ?? false;

  return (
    <span
      data-slot="queue-item-content"
      class={cn(
        'ui-line-clamp-2 min-w-0 grow break-words',
        completed() ? 'text-content-muted/50 line-through' : 'text-content-secondary',
        local.class,
      )}
      {...rest}
    />
  );
};

type QueueItemDescriptionProps = ComponentProps<'div'> & {
  completed?: boolean;
};

export const QueueItemDescription: Component<QueueItemDescriptionProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'completed']);
  const completed = () => local.completed ?? false;

  return (
    <div
      data-slot="queue-item-description"
      class={cn(
        'ml-24 text-12',
        completed() ? 'text-content-muted/40 line-through' : 'text-content-muted',
        local.class,
      )}
      {...rest}
    />
  );
};

export const QueueItemActions: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="queue-item-actions"
      class={cn('flex gap-4', local.class)}
      {...rest}
    />
  );
};

export const QueueItemAction: Component<Omit<ComponentProps<typeof Button>, 'variant' | 'size'>> = (
  props,
) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      class={cn(
        'size-auto rounded-4 p-4 text-content-muted opacity-0 transition-opacity duration-120 hover:bg-content-muted/10 hover:text-content-primary group-hover:opacity-100',
        local.class,
      )}
      {...rest}
    />
  );
};

export const QueueItemAttachment: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="queue-item-attachment"
      class={cn('mt-4 flex flex-wrap gap-8', local.class)}
      {...rest}
    />
  );
};

export const QueueItemImage: Component<ComponentProps<'img'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <img
      alt=""
      height={32}
      width={32}
      class={cn('size-32 rounded-4 border border-border-subtle object-cover', local.class)}
      {...rest}
    />
  );
};

export const QueueItemFile: Component<ComponentProps<'span'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <span
      data-slot="queue-item-file"
      class={cn(
        'inline-flex max-w-full items-center gap-4 rounded-6 border border-border-subtle bg-surface-overlay px-8 py-4 text-12 text-content-primary',
        local.class,
      )}
      {...rest}
    >
      <Paperclip size={12} aria-hidden="true" />
      <span class="max-w-100 truncate">{local.children}</span>
    </span>
  );
};

export const QueueList: Component<ComponentProps<typeof ScrollArea>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <ScrollArea data-slot="queue-list" class={cn('mt-8 -mb-4', local.class)} {...rest}>
      <ScrollAreaViewport class="max-h-(--container-menu-min) pr-16">
        <ul class="m-0 list-none p-0">{local.children}</ul>
      </ScrollAreaViewport>
    </ScrollArea>
  );
};

export const QueueSection: Component<ComponentProps<typeof Collapsible>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'defaultOpen']);
  return (
    <Collapsible
      data-slot="queue-section"
      defaultOpen={local.defaultOpen ?? true}
      class={cn(local.class)}
      {...rest}
    />
  );
};

export const QueueSectionTrigger: Component<ComponentProps<typeof CollapsibleTrigger>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <CollapsibleTrigger
      data-slot="queue-section-trigger"
      class={cn(
        'ui-queue-section-trigger group flex w-full cursor-pointer items-center justify-between rounded-6 border-0 bg-surface-overlay/40 px-12 py-8 text-left text-13 font-medium text-content-secondary transition-colors duration-120 hover:bg-interaction-hover',
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </CollapsibleTrigger>
  );
};

type QueueSectionLabelProps = ComponentProps<'span'> & {
  count?: number;
  label: string;
  icon?: JSX.Element;
};

export const QueueSectionLabel: Component<QueueSectionLabelProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'count', 'label', 'icon']);
  return (
    <span
      data-slot="queue-section-label"
      class={cn('flex min-w-0 items-center gap-8', local.class)}
      {...rest}
    >
      <ChevronDown
        size={14}
        strokeWidth={1.7}
        class="ui-queue-section-chevron shrink-0 transition-transform duration-120"
        aria-hidden="true"
      />
      {local.icon}
      <span class="truncate">
        {local.count} {local.label}
      </span>
    </span>
  );
};

export const QueueSectionContent: Component<ComponentProps<typeof CollapsibleContent>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <CollapsibleContent
      data-slot="queue-section-content"
      class={cn('overflow-hidden transition-all duration-120 ease-in-out', local.class)}
      {...rest}
    />
  );
};

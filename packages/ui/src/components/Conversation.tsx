import { splitProps, type Component, type ComponentProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from './Empty';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
  type MessageScrollerProviderProps,
} from './MessageScroller';

export type ConversationProps = ComponentProps<'div'> & MessageScrollerProviderProps;

/** 会话根：组合 MessageScrollerProvider 与滚动外框。 */
export const Conversation: Component<ConversationProps> = (props) => {
  const [providerProps, frameProps] = splitProps(props, [
    'autoScroll',
    'defaultScrollPosition',
    'scrollEdgeThreshold',
    'scrollMargin',
    'scrollPreviousItemPeek',
  ]);
  const [local, rest] = splitProps(frameProps, ['class', 'children']);

  return (
    <MessageScrollerProvider {...providerProps}>
      <MessageScroller class={cn('flex-1', local.class)} {...rest}>
        {local.children}
      </MessageScroller>
    </MessageScrollerProvider>
  );
};

/** 会话内容区：视口 + 列表容器。 */
export const ConversationContent: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <MessageScrollerViewport>
      <MessageScrollerContent class={local.class} {...rest}>
        {local.children}
      </MessageScrollerContent>
    </MessageScrollerViewport>
  );
};

type ConversationEmptyStateProps = ComponentProps<'div'> & {
  title?: string;
  description?: string;
  icon?: JSX.Element;
};

/** 空会话占位，基于 Empty 复合组件。 */
export const ConversationEmptyState: Component<ConversationEmptyStateProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'title', 'description', 'icon', 'children']);

  return (
    <Empty
      data-slot="conversation-empty-state"
      class={cn('size-full border-0 bg-transparent p-32', local.class)}
      {...rest}
    >
      {local.children ?? (
        <>
          {local.icon && <EmptyMedia variant="icon">{local.icon}</EmptyMedia>}
          <EmptyHeader>
            <EmptyTitle>{local.title ?? 'No messages yet'}</EmptyTitle>
            {local.description && (
              <EmptyDescription>{local.description}</EmptyDescription>
            )}
          </EmptyHeader>
        </>
      )}
    </Empty>
  );
};

/** 会话滚动按钮，默认跳至末尾。 */
export const ConversationScrollButton: Component<ComponentProps<'button'>> = (props) => (
  <MessageScrollerButton direction="end" {...props} />
);

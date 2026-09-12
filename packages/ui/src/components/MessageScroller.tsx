import { ArrowDown } from 'lucide-solid';
import {
  createEffect,
  onCleanup,
  splitProps,
  type Component,
  type ComponentProps,
} from 'solid-js';
import { cn } from '../lib/cn';
import { IconButton } from './Button';
import {
  createMessageScrollerContext,
  MessageScrollerContext,
  useMessageScrollerContext,
  type MessageScrollerProviderProps,
  type MessageScrollerScrollOptions,
} from './message-scroller-context';

export type { MessageScrollerProviderProps, MessageScrollerScrollOptions };

/** 聊天滚动根：管理吸底、锚定与历史 prepend 时的滚动补偿。 */
export const MessageScrollerProvider: Component<
  MessageScrollerProviderProps & { children?: import('solid-js').JSX.Element }
> = (props) => {
  const [local] = splitProps(props, [
    'autoScroll',
    'defaultScrollPosition',
    'scrollEdgeThreshold',
    'scrollMargin',
    'scrollPreviousItemPeek',
    'children',
  ]);

  const context = createMessageScrollerContext(() => ({
    autoScroll: local.autoScroll,
    defaultScrollPosition: local.defaultScrollPosition,
    scrollEdgeThreshold: local.scrollEdgeThreshold,
    scrollMargin: local.scrollMargin,
    scrollPreviousItemPeek: local.scrollPreviousItemPeek,
  }));

  return (
    <MessageScrollerContext.Provider value={context}>
      {local.children}
    </MessageScrollerContext.Provider>
  );
};

/** 滚动区域外框。 */
export const MessageScroller: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <div
      data-slot="message-scroller"
      class={cn(
        'group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden',
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </div>
  );
};

/** 可滚动视口；挂载 scroll-fade 类名供主题后续接入。 */
export const MessageScrollerViewport: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'role',
    'aria-label',
    'tabIndex',
  ]);
  const { registerViewport } = useMessageScrollerContext('MessageScrollerViewport');

  return (
    <div
      ref={registerViewport}
      data-slot="message-scroller-viewport"
      role={local.role ?? 'region'}
      aria-label={local['aria-label'] ?? 'Messages'}
      tabIndex={local.tabIndex ?? 0}
      data-scrollable-start={undefined}
      data-scrollable-end={undefined}
      class={cn(
        'size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain contain-content ui-scrollbar scroll-fade-b',
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </div>
  );
};

type MessageScrollerContentProps = ComponentProps<'div'> & {
  /** 为 false 时不在内容层重复声明 log（由外层 Conversation 承担）。 */
  semanticLog?: boolean;
};

/** 消息列表内容容器。 */
export const MessageScrollerContent: Component<MessageScrollerContentProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'role',
    'aria-relevant',
    'aria-busy',
    'semanticLog',
  ]);
  const { registerContent } = useMessageScrollerContext('MessageScrollerContent');
  const semanticLog = () => local.semanticLog ?? true;

  return (
    <div
      ref={registerContent}
      data-slot="message-scroller-content"
      role={local.role ?? (semanticLog() ? 'log' : undefined)}
      aria-relevant={semanticLog() ? local['aria-relevant'] ?? 'additions' : local['aria-relevant']}
      aria-busy={local['aria-busy']}
      class={cn('flex h-max min-h-full flex-col gap-8', local.class)}
      {...rest}
    >
      {local.children}
    </div>
  );
};

type MessageScrollerItemProps = ComponentProps<'div'> & {
  messageId?: string;
  scrollAnchor?: boolean;
};

/** 单条消息行边界，供滚动测量与锚定。 */
export const MessageScrollerItem: Component<MessageScrollerItemProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'messageId', 'scrollAnchor']);
  const { registerItem, unregisterItem } = useMessageScrollerContext('MessageScrollerItem');

  return (
    <div
      ref={(node) => {
        const id = local.messageId;
        if (!id) return;
        if (node) {
          registerItem(id, node, local.scrollAnchor ?? false);
        } else {
          unregisterItem(id);
        }
      }}
      data-slot="message-scroller-item"
      data-message-id={local.messageId}
      data-scroll-anchor={local.scrollAnchor ? 'true' : 'false'}
      class={cn(
        'min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]',
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </div>
  );
};

type MessageScrollerButtonProps = ComponentProps<'button'> & {
  direction?: 'start' | 'end';
};

/** 跳转到开头或末尾的浮动按钮。 */
export const MessageScrollerButton: Component<MessageScrollerButtonProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'direction']);
  const direction = () => local.direction ?? 'end';
  const { isAtStart, isAtEnd, scrollToEnd, scrollToStart } = useMessageScrollerContext(
    'MessageScrollerButton',
  );

  const active = () => (direction() === 'end' ? !isAtEnd() : !isAtStart());
  const label = () => (direction() === 'end' ? 'Scroll to end' : 'Scroll to start');

  return (
    <IconButton
      type="button"
      variant="default"
      size="sm"
      label={label()}
      showTooltip={false}
      data-slot="message-scroller-button"
      data-direction={direction()}
      data-active={active() ? 'true' : 'false'}
      inert={!active()}
      tabIndex={active() ? 0 : -1}
      class={cn(
        'absolute left-1/2 -translate-x-1/2 border border-border-strong bg-surface-overlay text-content-primary transition-[translate,scale,opacity] duration-200 hover:bg-interaction-hover',
        'data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0',
        'data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100',
        direction() === 'end'
          ? 'bottom-16 data-[active=false]:translate-y-full'
          : 'top-16 data-[active=false]:-translate-y-full',
        local.class,
      )}
      onClick={() => {
        if (direction() === 'end') {
          scrollToEnd();
          return;
        }
        scrollToStart();
      }}
      {...rest}
    >
      {local.children ?? (
        <ArrowDown
          size={16}
          strokeWidth={1.7}
          class={cn('shrink-0', direction() === 'start' && 'rotate-180')}
          aria-hidden="true"
        />
      )}
    </IconButton>
  );
};

export function useMessageScroller() {
  const context = useMessageScrollerContext('useMessageScroller');
  return {
    scrollToMessage: context.scrollToMessage,
    scrollToEnd: context.scrollToEnd,
    scrollToStart: context.scrollToStart,
    isFollowing: context.isFollowing,
  };
}

export function useMessageScrollerScrollable() {
  const context = useMessageScrollerContext('useMessageScrollerScrollable');
  return {
    start: () => !context.isAtStart(),
    end: () => !context.isAtEnd(),
  };
}

export function useMessageScrollerVisibility() {
  const context = useMessageScrollerContext('useMessageScrollerVisibility');

  createEffect(() => {
    context.subscribeVisibility();
    onCleanup(() => context.unsubscribeVisibility());
  });

  return {
    currentAnchorId: context.currentAnchorId,
    visibleMessageIds: context.visibleMessageIds,
  };
}

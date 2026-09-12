import { DownloadIcon } from 'lucide-solid';
import { splitProps, type Component, type ComponentProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import { IconButton } from './Button';
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
      <MessageScroller role="log" class={cn('relative flex-1 overflow-y-hidden', local.class)} {...rest}>
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
      <MessageScrollerContent
        semanticLog={false}
        class={cn('p-16', local.class)}
        {...rest}
      >
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
  const title = () => local.title ?? 'No messages yet';
  const description = () =>
    local.description === undefined ? 'Start a conversation to see messages here' : local.description;

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
            <EmptyTitle>{title()}</EmptyTitle>
            {description() && <EmptyDescription>{description()}</EmptyDescription>}
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

export type ConversationMessagePart = {
  type: string;
  text?: string;
};

export type ConversationMessage = {
  role: string;
  parts?: ConversationMessagePart[];
  content?: string;
};

const getMessageText = (message: ConversationMessage): string => {
  if (message.content) return message.content;
  return (message.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('');
};

const defaultFormatMessage = (message: ConversationMessage): string => {
  const roleLabel = message.role.charAt(0).toUpperCase() + message.role.slice(1);
  return `**${roleLabel}:** ${getMessageText(message)}`;
};

/** 将消息列表格式化为 Markdown 文本。 */
export const messagesToMarkdown = (
  messages: ConversationMessage[],
  formatMessage: (message: ConversationMessage, index: number) => string = defaultFormatMessage,
): string => messages.map((message, index) => formatMessage(message, index)).join('\n\n');

type ConversationDownloadProps = Omit<ComponentProps<'button'>, 'onClick'> & {
  messages: ConversationMessage[];
  filename?: string;
  formatMessage?: (message: ConversationMessage, index: number) => string;
};

/** 导出会话为 Markdown 文件的浮动按钮。 */
export const ConversationDownload: Component<ConversationDownloadProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'messages', 'filename', 'formatMessage']);

  const handleDownload = () => {
    const markdown = messagesToMarkdown(
      local.messages,
      local.formatMessage ?? defaultFormatMessage,
    );
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = local.filename ?? 'conversation.md';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <IconButton
      type="button"
      variant="default"
      size="sm"
      label="Download conversation"
      showTooltip={false}
      data-slot="conversation-download"
      class={cn(
        'absolute top-16 right-16 border border-border-strong bg-surface-overlay text-content-primary hover:bg-interaction-hover',
        local.class,
      )}
      onClick={handleDownload}
      {...rest}
    >
      {local.children ?? (
        <DownloadIcon size={16} strokeWidth={1.7} class="shrink-0" aria-hidden="true" />
      )}
    </IconButton>
  );
};

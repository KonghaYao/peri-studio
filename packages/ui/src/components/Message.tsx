import {
  createContext,
  splitProps,
  useContext,
  type Component,
  type ComponentProps,
} from 'solid-js';
import { cn } from '../lib/cn';

export type MessageAlign = 'start' | 'end';

type MessageContextValue = {
  align: () => MessageAlign;
};

const MessageContext = createContext<MessageContextValue>();

function useMessageContext(component: string): MessageContextValue {
  const context = useContext(MessageContext);
  if (!context) {
    throw new Error(`${component} must be used within Message`);
  }
  return context;
}

type MessageProps = ComponentProps<'div'> & {
  align?: MessageAlign;
};

/** 会话消息行：头像、对齐、头尾元数据与气泡内容。 */
export const Message: Component<MessageProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'align']);
  const align = () => local.align ?? 'start';
  return (
    <MessageContext.Provider value={{ align }}>
      <div
        data-slot="message"
        data-align={align()}
        class={cn(
          'flex w-full min-w-0 gap-8',
          align() === 'end' ? 'flex-row-reverse' : 'flex-row',
          local.class,
        )}
        {...rest}
      />
    </MessageContext.Provider>
  );
};

/** 同一发送者的连续消息分组。 */
export const MessageGroup: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="message-group"
      class={cn('flex min-w-0 flex-col gap-8', local.class)}
      {...rest}
    />
  );
};

/** 消息头像槽位，锚定在气泡底部。 */
export const MessageAvatar: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  useMessageContext('MessageAvatar');
  return (
    <div
      data-slot="message-avatar"
      class={cn('flex shrink-0 self-end', local.class)}
      {...rest}
    />
  );
};

/** 包裹 header、气泡表面与 footer。 */
export const MessageContent: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  const { align } = useMessageContext('MessageContent');
  return (
    <div
      data-slot="message-content"
      class={cn(
        'flex min-w-0 flex-1 flex-col gap-4',
        align() === 'end' ? 'items-end' : 'items-start',
        local.class,
      )}
      {...rest}
    />
  );
};

/** 消息上方元数据（如发送者名称），始终左对齐。 */
export const MessageHeader: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  useMessageContext('MessageHeader');
  return (
    <div
      data-slot="message-header"
      class={cn('self-start text-11 text-content-muted', local.class)}
      {...rest}
    />
  );
};

/** 消息下方元数据或操作，跟随消息侧对齐。 */
export const MessageFooter: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  const { align } = useMessageContext('MessageFooter');
  return (
    <div
      data-slot="message-footer"
      class={cn(
        'flex items-center gap-8 text-11 text-content-muted',
        align() === 'end' ? 'self-end' : 'self-start',
        local.class,
      )}
      {...rest}
    />
  );
};

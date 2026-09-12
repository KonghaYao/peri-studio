import { splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../../lib/cn';
import type { MessageRole } from '../Message';

export type MessageArticleShellProps = Omit<ComponentProps<'article'>, 'role'> & {
  from: MessageRole;
};

/** T3 · 单条会话消息 article 壳：角色修饰、分组 hover 与 transcript 密度。 */
export const MessageArticleShell: Component<MessageArticleShellProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'from', 'children']);

  return (
    <article
      data-testid="conversation-message"
      class={cn(
        'conversation-message',
        `conversation-message--${local.from}`,
        'group/message relative mb-8 flex min-w-0 flex-col gap-8',
        local.from === 'user' ? 'items-end' : local.from === 'system' ? 'items-center' : undefined,
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </article>
  );
};

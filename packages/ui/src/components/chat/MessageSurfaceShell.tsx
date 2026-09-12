import { splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../../lib/cn';
import type { MessageRole } from '../Message';

export type MessageSurfaceShellProps = ComponentProps<'div'> & {
  from: Extract<MessageRole, 'assistant' | 'system'>;
};

/** T3 · 助手/系统消息内容表面：宽度约束与 system pill 样式。 */
export const MessageSurfaceShell: Component<MessageSurfaceShellProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'from', 'children']);

  return (
    <div
      data-testid="conversation-message-surface"
      class={cn(
        'conversation-message__surface flex max-w-(--chat-content-max) min-w-0 flex-col gap-8',
        local.from === 'system'
          ? 'max-w-(--chat-system-max) rounded-full bg-surface-muted px-12 py-4 text-12 text-content-secondary'
          : 'w-full',
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </div>
  );
};

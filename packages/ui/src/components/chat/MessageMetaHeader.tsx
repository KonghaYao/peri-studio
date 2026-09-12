import { splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../../lib/cn';

/** T3 · 用户消息上方元数据行（时间等），hover/focus 时淡入。 */
export const MessageMetaHeader: Component<ComponentProps<'header'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <header
      data-testid="conversation-message-meta"
      class={cn(
        'conversation-message__meta pointer-events-none flex items-center gap-8 text-10 text-content-muted opacity-0 transition-opacity duration-150 group-hover/message:opacity-100 group-focus-within/message:opacity-100',
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </header>
  );
};

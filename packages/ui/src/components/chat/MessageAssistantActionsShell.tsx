import { splitProps, type Component, type JSX } from 'solid-js';
import { MoreHorizontal } from 'lucide-solid';
import { cn } from '../../lib/cn';
import { IconButton } from '../Button';
import { MessageActions } from '../Message';

export type MessageAssistantActionsShellProps = {
  open: boolean;
  actionsId: string;
  onToggleOpen: () => void;
  class?: string;
  children: JSX.Element;
};

/** T3 · 助手消息浮层操作：粗指针显式触发器 + 贴底 MessageActions 面板。 */
export const MessageAssistantActionsShell: Component<MessageAssistantActionsShellProps> = (props) => {
  const [local, rest] = splitProps(props, ['open', 'actionsId', 'onToggleOpen', 'class', 'children']);

  return (
    <>
      <IconButton
        label="Message actions"
        size="sm"
        variant="ghost"
        class="conversation-message__actions-trigger absolute top-0 right-0 z-10 hidden border-0 bg-surface-overlay text-content-muted shadow-subtle pointer-coarse:inline-flex"
        aria-expanded={local.open}
        aria-controls={local.actionsId}
        onClick={local.onToggleOpen}
      >
        <MoreHorizontal size={17} strokeWidth={1.7} />
      </IconButton>
      <MessageActions
        id={local.actionsId}
        data-testid="conversation-message-actions"
        class={cn(
          'conversation-message__actions absolute top-full left-0 z-20 min-h-28 gap-8 rounded-lg border border-border-subtle bg-surface-overlay px-8 py-4 text-content-muted shadow-overlay transition-opacity duration-150',
          local.open
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0 group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100',
          local.class,
        )}
        {...rest}
      >
        {local.children}
      </MessageActions>
    </>
  );
};

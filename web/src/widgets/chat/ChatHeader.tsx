import { chatHead, projectSessions, selectedSessionId } from '@/store';
import { ChatHeader as ChatHeaderBase } from '@peri/ui';
import { sessionDisplayTitle } from '@/features/session/recovery-state';

export type ChatHeaderProps = { launch?: boolean; onOpenNavigation?: () => void; onOpenResources?: () => void };

export function ChatHeader(props: ChatHeaderProps) {
  const logical = () => projectSessions().find((s) => s.id === selectedSessionId());
  const title = () => logical()
    ? sessionDisplayTitle(logical()!.title, logical()!.id)
    : chatHead()?.chat?.title || 'New conversation';

  return (
    <ChatHeaderBase
      title={title()}
      launch={props.launch}
      class={`chat-header ${props.launch ? 'chat-header--launch' : ''}`}
      titleClass="chat-title"
      navButtonClass="mobile-nav-button hidden"
      showMobileNav
      showMobileResources
      onOpenNavigation={props.onOpenNavigation}
      onOpenResources={props.onOpenResources}
    />
  );
}

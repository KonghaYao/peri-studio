import { ChatHeader as ChatHeaderBase } from '@peri/ui';

export function ChatHeader(props: { title: string }) {
  return (
    <ChatHeaderBase
      title={props.title}
      showMobileResources
      resourcesButtonClass=""
    />
  );
}

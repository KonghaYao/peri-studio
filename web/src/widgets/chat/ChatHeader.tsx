import { Show } from 'solid-js';
import { chatHead, projectSessions, selectedSessionId } from '@/store';
import { IconButton } from '@/shared/ui';
import { sessionDisplayTitle } from '@/features/session/recovery-state';
import { FileText, Menu, PanelRight } from 'lucide-solid';

export type ChatHeaderProps = { launch?: boolean; onOpenNavigation?: () => void; onOpenResources?: () => void };

export function ChatHeader(props: ChatHeaderProps) {
  const logical = () => projectSessions().find((s) => s.id === selectedSessionId());
  const title = () => logical()
    ? sessionDisplayTitle(logical()!.title, logical()!.id)
    : chatHead()?.chat?.title || 'New conversation';
  return <header class={`chat-header relative flex h-52 items-center gap-8 border-b border-border-subtle bg-surface-overlay px-16 ${props.launch ? 'chat-header--launch justify-end' : ''}`}>
    <IconButton tooltipPlacement="start" label="Open navigation" size="sm" class="mobile-nav-button hidden max-desk:inline-flex" onClick={props.onOpenNavigation}>
      <Menu size={16} strokeWidth={1.7} />
    </IconButton>
    <Show when={!props.launch}>
      <IconButton tooltipPlacement="end" label="Open workspace resources" size="sm" class="hidden max-desk:inline-flex" onClick={props.onOpenResources}>
        <FileText size={16} strokeWidth={1.7} />
      </IconButton>
      <strong class="chat-title min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-14 font-semibold text-content-primary">{title()}</strong>
    </Show>
    <Show when={props.launch}>
      <IconButton tooltipPlacement="end" label="Toggle side panel" title="Side panel is not connected yet" disabled class="disabled:opacity-100"><PanelRight size={18} strokeWidth={1.7} /></IconButton>
    </Show>
  </header>;
}

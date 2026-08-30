import { Show } from 'solid-js';
import { chatHead, chatStatusSignal, openingSessionId, permissions, projectSessions, runtimeDocsHydrated, selectedCid, selectedSessionId, turnActive } from '../../panel/store';
import { connState } from '../../panel/lib/connection';
import { IconButton, Status } from '@/shared/ui';
import { connectedRuntimeState } from '../../panel/lib/runtime-state.ts';
import { sessionDisplayTitle } from '../../panel/lib/recovery-state.ts';
import { FileText, Menu, PanelRight } from 'lucide-solid';

export type ChatHeaderProps = { launch?: boolean; onOpenNavigation?: () => void; onOpenResources?: () => void };

export function ChatHeader(props: ChatHeaderProps) {
  const logical = () => projectSessions().find((s) => s.id === selectedSessionId());
  const title = () => logical()
    ? sessionDisplayTitle(logical()!.title, logical()!.id)
    : chatHead()?.chat?.title || 'New conversation';
  const runtime = () => connectedRuntimeState({
    hasSession: !!logical(),
    lifecycle: logical()?.lifecycle,
    isOpening: openingSessionId() === logical()?.id,
    hasRuntime: !!selectedCid(),
    isSelected: true,
    isHydrated: runtimeDocsHydrated(),
    chatStatus: chatStatusSignal()[selectedCid() ?? ''],
    hasPendingPermission: permissions().some((permission) => permission.status === 'pending'),
    turnActive: turnActive(),
  }, connState());
  const connection = () => {
    const current = connState();
    if (current.kind === 'ok') return { label: 'Online', detail: current.text };
    if (current.kind === 'warn') return { label: 'Reconnecting', detail: current.text };
    if (current.kind === 'err') return { label: 'Offline', detail: current.text };
    if (current.text.includes('Connecting')) return { label: 'Connecting', detail: current.text };
    return { label: 'Offline', detail: current.text };
  };
  const showRuntimeStatus = () => runtime().label && !['Ready', 'Working', 'Approval'].includes(runtime().label);
  return <header class={`chat-header relative flex h-52 items-center gap-8 border-b border-border-subtle bg-surface-overlay px-16 ${props.launch ? 'chat-header--launch justify-end' : ''}`}>
    <IconButton tooltipPlacement="start" label="Open navigation" size="sm" class="mobile-nav-button hidden max-desk:inline-flex" onClick={props.onOpenNavigation}>
      <Menu size={16} strokeWidth={1.7} />
    </IconButton>
    <Show when={!props.launch}><IconButton tooltipPlacement="end" label="Open workspace resources" size="sm" class="hidden max-desk:inline-flex" onClick={props.onOpenResources}>
      <FileText size={16} strokeWidth={1.7} />
    </IconButton></Show>
    <Show when={!props.launch} fallback={<Status live labelHidden tone={connState().kind || 'idle'} title={connection().detail} aria-label={connection().detail} class="connection-pill mr-2">{connection().label}</Status>}>
      <strong class="chat-title min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-14 font-semibold text-content-primary">{title()}</strong>
      <Show when={showRuntimeStatus()}><span title={runtime().detail} aria-label={runtime().detail || runtime().label} class={`runtime-status runtime-status--${runtime().tone} inline-flex size-7 items-center justify-center rounded-full hover:bg-interaction-hover`}><i aria-hidden="true" class="size-1.5 rounded-full bg-content-faint" /><span class="sr-only">{runtime().label}</span></span></Show>
      <Status live labelHidden tone={connState().kind || 'idle'} title={connection().detail} aria-label={connection().detail} class="connection-pill">{connection().label}</Status>
    </Show>
    <Show when={props.launch}>
      <IconButton tooltipPlacement="end" label="Toggle side panel" title="Side panel is not connected yet" disabled class="disabled:opacity-100"><PanelRight size={18} strokeWidth={1.7} /></IconButton>
    </Show>
  </header>;
}

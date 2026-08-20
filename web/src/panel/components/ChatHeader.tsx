import { createEffect, createSignal, Show } from 'solid-js';
import { chatHead, chatStatusSignal, closeChat, navigateProjectSession, openingSessionId, permissions, projectSessions, runtimeDocsHydrated, selectedCid, selectedSessionId, turnActive } from '../store';
import { isTerminal } from '../lib/action-state';
import { connState } from '../lib/connection';
import { canRewindCurrentChat, openRewindFlow } from '../lib/rewind-assembly';
import { readOnly } from '../lib/auth-state';
import { Dialog, DialogContent, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Icon, IconButton, Status } from '../../components/ui';
import { connectedRuntimeState } from '../lib/runtime-state.ts';
import { sessionDisplayTitle } from '../lib/recovery-state.ts';
import { runtimeControlFor } from '../lib/runtime-control';
import { McpPanel } from './McpPanel';
import { RewindDialog } from './RewindDialog';
import { ConfirmDialog } from './shared/ConfirmDialog';

export type ChatHeaderProps = { launch?: boolean; onOpenNavigation?: () => void; onOpenSystem?: () => void };

export function ChatHeader(props: ChatHeaderProps) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [confirmClose, setConfirmClose] = createSignal(false);
  const [mcpOpen, setMcpOpen] = createSignal(false);
  const [rewindOpen, setRewindOpen] = createSignal(false);
  const logical = () => projectSessions().find((s) => s.id === selectedSessionId());
  const title = () => logical()
    ? sessionDisplayTitle(logical()!.title, logical()!.acpSessionId || logical()!.id)
    : chatHead()?.chat?.title || 'New conversation';
  const terminal = () => isTerminal(chatStatusSignal()[selectedCid() ?? '']);
  const runtimeControl = () => runtimeControlFor(selectedCid());
  const closing = () => runtimeControl()?.kind === 'close' ? runtimeControl() : null;
  const runtimeControlLocked = () => !!runtimeControl() && runtimeControl()?.phase !== 'failed';
  const closeLocked = () => !!closing() && closing()?.phase !== 'failed';
  createEffect(() => {
    if (terminal()) setConfirmClose(false);
  });
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
  const menuId = 'chat-session-menu';
  return <header class={`chat-header relative flex items-center gap-12 h-60 px-20 bg-transparent desk:max-wide:h-56 desk:max-wide:px-16 max-desk:h-56 max-desk:px-12 ${props.launch ? 'chat-header--launch justify-end' : 'border-b border-divider'}`}>
    <IconButton tooltipPlacement="start" label="Open navigation" class="mobile-nav-button hidden max-desk:inline-flex" onClick={props.onOpenNavigation}>
      <Icon><path d="M3 5h14M3 10h14M3 15h14" /></Icon>
    </IconButton>
    <Show when={!props.launch} fallback={<Status live tone={connState().kind || 'idle'} title={connection().detail} aria-label={connection().detail} class="connection-pill mr-2 [&_.ui-status__dot]:size-6 [&_.ui-status__label]:sr-only">{connection().label}</Status>}><div class="chat-title min-w-0 flex-1 flex flex-col justify-center gap-3"><strong class="overflow-hidden text-ellipsis whitespace-nowrap text-14 leading-115">{title()}</strong><Show when={runtime().label && runtime().tone !== 'ready'}><span title={runtime().detail} aria-label={runtime().detail || runtime().label} class={`runtime-status runtime-status--${runtime().tone} flex items-center gap-6 overflow-hidden text-muted text-11 leading-12 text-ellipsis whitespace-nowrap ${runtime().tone === 'ready' ? '[&_i]:bg-success' : runtime().tone === 'busy' ? '[&_i]:bg-accent [&_i]:animate-pulse' : runtime().tone === 'attention' ? 'text-warning [&_i]:bg-warning' : runtime().tone === 'danger' ? 'text-danger [&_i]:bg-danger' : '[&_i]:bg-text-faint'}`}><i aria-hidden="true" class="w-6 h-6 shrink-0 rounded-full bg-text-faint" />{runtime().label}</span></Show></div>
    <Status live tone={connState().kind || 'idle'} title={connection().detail} aria-label={connection().detail} class="connection-pill [&_.ui-status__dot]:size-6 max-desk:[&_.ui-status__label]:hidden max-desk:[&_.ui-status__dot]:size-8">{connection().label}</Status></Show>
    <Show when={props.launch} fallback={<IconButton tooltipPlacement="end" label="Open system information" onClick={props.onOpenSystem}><Icon><circle cx="10" cy="10" r="2.6" /><path d="M10 3.4v2M10 14.6v2M3.4 10h2M14.6 10h2M5.3 5.3l1.4 1.4M13.3 13.3l1.4 1.4M14.7 5.3l-1.4 1.4M6.7 13.3l-1.4 1.4" /></Icon></IconButton>}>
      <IconButton tooltipPlacement="end" label="Toggle side panel" title="Side panel is not connected yet" disabled class="disabled:opacity-100"><Icon><rect x="4" y="4" width="12" height="12" rx="2" /><path d="M12.5 4v12" /></Icon></IconButton>
    </Show>
    <Show when={logical() && selectedCid()}>
      <div class="chat-actions relative">
        <DropdownMenu open={menuOpen()} onOpenChange={setMenuOpen} placement="bottom-end">
          <DropdownMenuTrigger as={IconButton} tooltipPlacement="end" label="Conversation actions">
            <Icon><circle cx="4" cy="10" r="1" /><circle cx="10" cy="10" r="1" /><circle cx="16" cy="10" r="1" /></Icon>
          </DropdownMenuTrigger>
          <DropdownMenuContent id={menuId} aria-label="Conversation actions" class="ui-menu min-w-[190px]">
            <Show when={chatHead()?.agent?.extensions?.includes('peri.oauth')}>
              <DropdownMenuItem onSelect={() => setMcpOpen(true)}>MCP connections</DropdownMenuItem>
            </Show>
            <Show when={chatHead()?.agent?.extensions?.includes('peri.rewind') && !terminal()}>
              <DropdownMenuItem disabled={!canRewindCurrentChat()} onSelect={() => {
                if (openRewindFlow()) setRewindOpen(true);
              }}>Rewind session…</DropdownMenuItem>
            </Show>
            <Show when={terminal()} fallback={
              <DropdownMenuItem class="text-danger focus:text-danger" disabled={readOnly() || runtimeControlLocked()} onSelect={() => setConfirmClose(true)}>Close running instance</DropdownMenuItem>
            }>
              <DropdownMenuItem disabled={readOnly() || !!openingSessionId()} onSelect={() => { const id = logical()?.id; if (id) navigateProjectSession(id); }}>Reopen session</DropdownMenuItem>
            </Show>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Show>
    <Dialog open={confirmClose()} onOpenChange={(open) => { if (!open && !closeLocked()) setConfirmClose(false); }}><DialogContent dismissible={!closeLocked()}><DialogTitle class="sr-only">Close current running instance</DialogTitle>
      <ConfirmDialog
        title="Close the current running instance?"
        description="Sessions and history on the left are kept. Next time you open it, Peri Studio starts a new runtime instance and loads the same ACP session."
        warning={turnActive() ? 'Agent is still working. Closing the instance will stop the current generation and running tools.' : undefined}
        cancelDisabled={closeLocked()}
        confirmLabel="Close instance"
        confirmDisabled={runtimeControlLocked()}
        confirmBusy={closing()?.phase === 'sending' || closing()?.phase === 'accepted'}
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => closeChat(() => setConfirmClose(false))}
      />
    </DialogContent></Dialog>
    <McpPanel open={mcpOpen()} onClose={() => setMcpOpen(false)} />
    <RewindDialog open={rewindOpen()} onClose={() => setRewindOpen(false)} />
  </header>;
}

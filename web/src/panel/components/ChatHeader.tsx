import { createEffect, createSignal, Show } from 'solid-js';
import { chatHead, chatStatusSignal, closeChat, navigateProjectSession, openingSessionId, permissions, projectSessions, runtimeDocsHydrated, selectedCid, selectedSessionId, turnActive } from '../store';
import { isTerminal } from '../lib/action-state';
import { connState } from '../lib/connection';
import { canRewindCurrentChat, openRewindFlow } from '../lib/rewind-assembly';
import { readOnly } from '../lib/auth-state';
import { Dialog, Icon, IconButton, Menu, MenuItem, Status } from '../../ui';
import { connectedRuntimeState } from '../lib/runtime-state.ts';
import { sessionDisplayTitle } from '../lib/recovery-state.ts';
import { runtimeControlFor } from '../lib/runtime-control';
import { McpPanel } from './McpPanel';
import { RewindDialog } from './RewindDialog';
import { SettingsDialog } from './SettingsDialog';
import { ConfirmDialog } from './shared/ConfirmDialog';

export type ChatHeaderProps = { onOpenNavigation?: () => void; onOpenStatus?: () => void };

export function ChatHeader(props: ChatHeaderProps) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [confirmClose, setConfirmClose] = createSignal(false);
  const [mcpOpen, setMcpOpen] = createSignal(false);
  const [rewindOpen, setRewindOpen] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  let menuTrigger: HTMLButtonElement | undefined;
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
  const menuId = 'chat-session-menu';
  return <header class="chat-header relative flex items-center gap-12 h-60 px-20 border-b border-divider bg-surface-header desk:max-wide:h-56 desk:max-wide:px-16 max-desk:h-56 max-desk:px-12">
    <IconButton tooltipPlacement="start" label="Open navigation" class="mobile-nav-button hidden max-desk:inline-flex" onClick={props.onOpenNavigation}>
      <Icon><path d="M3 5h14M3 10h14M3 15h14" /></Icon>
    </IconButton>
    <div class="chat-title min-w-0 flex-1 flex flex-col justify-center gap-3"><strong class="overflow-hidden text-ellipsis whitespace-nowrap text-15 leading-115">{title()}</strong><Show when={runtime().label}><span class={`runtime-status runtime-status--${runtime().tone} flex items-center gap-6 overflow-hidden text-muted text-11 leading-12 text-ellipsis whitespace-nowrap ${runtime().tone === 'attention' ? 'text-warning' : runtime().tone === 'danger' ? 'text-danger' : ''}`}><i aria-hidden="true" class={`w-6 h-6 shrink-0 rounded-full ${runtime().tone === 'ready' ? 'bg-success' : runtime().tone === 'busy' ? 'bg-accent' : runtime().tone === 'attention' ? 'bg-warning' : runtime().tone === 'danger' ? 'bg-danger' : 'bg-text-faint'}`} />{runtime().label}</span></Show></div>
    <Status live tone={connState().kind || 'idle'} class="connection-pill">{connState().text}</Status>
    <IconButton tooltipPlacement="end" label="Settings" onClick={() => setSettingsOpen(true)}>
      <Icon><circle cx="10" cy="10" r="2.6" /><path d="M10 3.4v2M10 14.6v2M3.4 10h2M14.6 10h2M5.3 5.3l1.4 1.4M13.3 13.3l1.4 1.4M14.7 5.3l-1.4 1.4M6.7 13.3l-1.4 1.4" /></Icon>
    </IconButton>
    <Show when={logical() && selectedCid()}>
      <div class="chat-actions relative">
        <IconButton tooltipPlacement="end" ref={menuTrigger} label="Conversation actions" aria-haspopup="menu" aria-expanded={menuOpen()} aria-controls={menuOpen() ? menuId : undefined} onClick={() => setMenuOpen((value) => !value)}>
          <Icon><circle cx="4" cy="10" r="1" /><circle cx="10" cy="10" r="1" /><circle cx="16" cy="10" r="1" /></Icon>
        </IconButton>
        <Menu open={menuOpen()} id={menuId} label="Conversation actions" trigger={() => menuTrigger} onClose={() => setMenuOpen(false)}>
          <Show when={chatHead()?.agent?.extensions?.includes('peri.oauth')}>
            <MenuItem onClick={() => { setMenuOpen(false); setMcpOpen(true); }}>MCP connections</MenuItem>
          </Show>
          <Show when={chatHead()?.agent?.extensions?.includes('peri.rewind') && !terminal()}>
            <MenuItem disabled={!canRewindCurrentChat()} onClick={() => {
              setMenuOpen(false);
              if (openRewindFlow()) setRewindOpen(true);
            }}>Rewind session…</MenuItem>
          </Show>
          <Show when={terminal()} fallback={
            <MenuItem tone="danger" disabled={readOnly() || runtimeControlLocked()} onClick={() => { setMenuOpen(false); setConfirmClose(true); }}>Close running instance</MenuItem>
          }>
            <MenuItem disabled={readOnly() || !!openingSessionId()} onClick={() => { const id = logical()?.id; setMenuOpen(false); if (id) navigateProjectSession(id); }}>Reopen session</MenuItem>
          </Show>
        </Menu>
      </div>
    </Show>
    <Dialog open={confirmClose()} title="Close current running instance" dismissible={!closeLocked()} onClose={() => setConfirmClose(false)}>
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
    </Dialog>
    <McpPanel open={mcpOpen()} onClose={() => setMcpOpen(false)} />
    <RewindDialog open={rewindOpen()} onClose={() => setRewindOpen(false)} />
    <SettingsDialog open={settingsOpen()} onClose={() => setSettingsOpen(false)} />
  </header>;
}

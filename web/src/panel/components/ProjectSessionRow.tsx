import { createEffect, createSignal, Show } from 'solid-js';
import type { ProjectSessionInfo } from '../lib/registry-view';
import { Button, Icon, IconButton, Menu, MenuItem, Popover, Spinner, TextField } from '../../ui';
import { formatRelativeTime, sessionDisplayTitle } from '../lib/recovery-state.ts';
import { runConfirmedMutation } from '../lib/form-mutation';

export interface SessionRowState {
  label: string;
  tone: string;
}

export interface ProjectSessionRowProps {
  session: ProjectSessionInfo;
  state: SessionRowState;
  selected: boolean;
  opening: boolean;
  navigationBusy: boolean;
  readOnly: boolean;
  renameOpen: boolean;
  menuOpen: boolean;
  runtimeActive: boolean;
  replacementBusy: boolean;
  onNavigate: () => void;
  onOpen: (sessionId: string, onCommitted: () => void) => void;
  onSelectRuntime: (sessionId: string, chatId: string) => void;
  onRenameOpenChange: (open: boolean) => void;
  onMenuOpenChange: (open: boolean) => void;
  onRename: (
    sessionId: string,
    name: string,
    onCommitted: () => void,
    onFailed: () => void,
  ) => boolean;
  onCreateReplacement: (title: string) => void;
  onArchiveRequest: (sessionId: string) => void;
}

function ChatIcon() {
  return <Icon><path d="M4 4.5h12v9H8l-4 3v-12Z" /></Icon>;
}

function MoreIcon() { return <Icon class="size-17!"><circle cx="4" cy="10" r="1" /><circle cx="10" cy="10" r="1" /><circle cx="16" cy="10" r="1" /></Icon>; }

export function ProjectSessionRow(props: ProjectSessionRowProps) {
  const [draft, setDraft] = createSignal(props.session.title);
  const [submitting, setSubmitting] = createSignal(false);
  let menuTrigger: HTMLButtonElement | undefined;
  const renameId = () => `rename-session-${props.session.id}`;
  const displayTitle = () => sessionDisplayTitle(
    props.session.title,
    props.session.acpSessionId || props.session.id,
  );
  const renameValid = () => !!draft().trim();

  createEffect(() => {
    if (props.renameOpen) setDraft(props.session.title);
  });

  const open = () => {
    if (props.readOnly && props.session.activeChatId) {
      props.onSelectRuntime(props.session.id, props.session.activeChatId);
      props.onNavigate();
      return;
    }
    props.onOpen(props.session.id, props.onNavigate);
  };

  const submitRename = (event: SubmitEvent) => {
    event.preventDefault();
    if (!renameValid() || submitting()) return;
    runConfirmedMutation(
      () => { setSubmitting(true); },
      () => { setSubmitting(false); },
      (committed, failed) => props.onRename(
        props.session.id,
        draft().trim(),
        committed,
        failed,
      ),
      () => props.onRenameOpenChange(false),
    );
  };

  return <div class={`session-row group relative rounded-9 hover:bg-selected ${props.selected ? 'is-selected bg-selected' : ''}`}>
    <button
      type="button"
      class="session-main flex w-full min-h-48 cursor-pointer items-center gap-9 rounded-9 border-0 bg-transparent py-6 pr-34 pl-9 text-left text-14 disabled:cursor-wait disabled:text-text-muted desk:min-h-46 desk:gap-7 desk:pl-7 wide:min-h-48 wide:gap-9 wide:pl-9 pointer-coarse:min-h-52 pointer-coarse:pr-42"
      aria-current={props.selected ? 'page' : undefined}
      title={props.readOnly && !props.session.activeChatId ? 'Full permission required to start this session' : undefined}
      onClick={open}
      disabled={(props.readOnly && !props.session.activeChatId) || props.session.lifecycle !== 'ready' || props.navigationBusy}
    >
      <ChatIcon />
      <span class="session-copy flex min-w-0 flex-1 flex-col gap-2">
        <strong class="overflow-hidden text-ellipsis whitespace-nowrap text-13 font-medium text-text-primary">{displayTitle()}</strong>
        <small class={`session-state session-state--${props.state.tone} overflow-hidden text-ellipsis whitespace-nowrap text-10p5 text-text-muted ${props.state.tone === 'attention' ? 'text-warning' : props.state.tone === 'danger' ? 'text-danger' : ''}`}>{props.state.label} · {formatRelativeTime(props.session.lastOpenedAt || props.session.updatedAt)}</small>
      </span>
      <Show when={props.opening || ['activating', 'pending'].includes(props.session.lifecycle)}><Spinner label="Opening…" /></Show>
    </button>
    <IconButton
      tooltipPlacement="end"
      class="session-menu absolute right-0 top-6 grid! size-36! cursor-pointer place-items-center rounded-8! border-0! bg-transparent opacity-0 group-hover:opacity-100! group-[.is-selected]:opacity-100! focus-visible:opacity-100! pointer-coarse:-right-4 pointer-coarse:top-4 pointer-coarse:size-44! pointer-coarse:opacity-100"
      ref={menuTrigger}
      disabled={props.readOnly || submitting()}
      label={`Session actions: ${displayTitle()}`}
      aria-haspopup="menu"
      aria-expanded={props.menuOpen}
      aria-controls={props.menuOpen ? `${renameId()}-menu` : undefined}
      onClick={() => props.onMenuOpenChange(!props.menuOpen)}
    >
      <MoreIcon />
    </IconButton>
    <Menu open={props.menuOpen} id={`${renameId()}-menu`} label={`Session actions: ${displayTitle()}`} trigger={() => menuTrigger} onClose={() => props.onMenuOpenChange(false)}>
      <MenuItem onClick={() => { props.onMenuOpenChange(false); props.onRenameOpenChange(true); }}>Rename session</MenuItem>
      <MenuItem tone="danger" disabled={props.runtimeActive} title={props.runtimeActive ? 'Close this session’s running instance first' : undefined} onClick={() => {
        props.onMenuOpenChange(false);
        props.onArchiveRequest(props.session.id);
      }}>Archive session</MenuItem>
    </Menu>
    <Popover
      open={props.renameOpen}
      id={renameId()}
      label={`Rename ${displayTitle()}`}
      trigger={() => menuTrigger}
      dismissible={!submitting()}
      onClose={() => props.onRenameOpenChange(false)}
    >
      <form class="rename-popover w-240 rounded-12 border border-border-subtle bg-surface p-10 shadow-popover" onSubmit={submitRename}>
        <TextField aria-label="Session name" value={draft()} error={!renameValid() ? 'Name cannot be empty' : undefined} onInput={(event) => setDraft(event.currentTarget.value)} autofocus />
        <div class="form-actions">
          <Button disabled={submitting()} onClick={() => props.onRenameOpenChange(false)}>Cancel</Button>
          <Button variant="primary" type="submit" busy={submitting()} disabled={!renameValid()}>Save</Button>
        </div>
      </form>
    </Popover>
    <Show when={props.session.lifecycle === 'failed'}>
      <div class="session-problem px-9 pb-7 pl-36 text-11 text-danger">Failed to open · <Button size="compact" class="cursor-pointer border-0! bg-transparent p-0! text-inherit underline" busy={props.replacementBusy} disabled={props.readOnly || props.replacementBusy} onClick={() => props.onCreateReplacement(props.session.title)}>Create replacement session</Button></div>
    </Show>
    <Show when={props.session.lifecycle === 'reconciliation_required'}>
      <div class="session-problem session-problem--warn px-9 pb-7 pl-36 text-11 text-warning">Server-side reconciliation required, retry not available</div>
    </Show>
  </div>;
}

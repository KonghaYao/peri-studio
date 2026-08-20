import { createEffect, createSignal, Show } from 'solid-js';
import type { ProjectSessionInfo } from '../lib/registry-view';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Icon, IconButton, Popover, PopoverContent, PopoverTrigger, Spinner, TextField } from '../../components/ui';
import { sessionDisplayTitle } from '../lib/recovery-state.ts';
import { runConfirmedMutation } from '../lib/form-mutation';

export interface SessionRowState {
  label: string;
  tone: string;
  detail?: string;
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
function RenameIcon() { return <Icon class="size-16!"><path d="m5 14-1 3 3-1 8.5-8.5-2-2L5 14Z" /><path d="m12.5 6.5 2 2" /></Icon>; }
function ArchiveIcon() { return <Icon class="size-16!"><path d="M3.5 6.5h13v10h-13zM2.5 3.5h15v3h-15zM8 10h4" /></Icon>; }

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

  return <div data-session-id={props.session.id} class={`session-row group relative rounded-8 border-l-2 border-transparent hover:bg-selected ${props.selected ? 'is-selected border-accent bg-selected' : ''}`}>
    <Button
      class="session-main relative flex min-h-32 w-full min-w-0 items-center justify-start gap-8 rounded-8 border-0 bg-transparent px-8 pr-[68px] text-left text-13 font-normal text-text-secondary cursor-pointer disabled:cursor-wait pointer-coarse:min-h-52 pointer-coarse:pr-[68px]"
      aria-current={props.selected ? 'page' : undefined}
      title={props.readOnly && !props.session.activeChatId ? 'Full permission required to start this session' : undefined}
      onClick={open}
      disabled={(props.readOnly && !props.session.activeChatId) || props.session.lifecycle !== 'ready' || props.navigationBusy}
    >
      <ChatIcon />
      <span class="session-copy min-w-0 flex-1"><strong class="block overflow-hidden text-ellipsis whitespace-nowrap text-13 font-normal text-inherit">{displayTitle()}</strong></span>
      <span class="absolute right-[10px] grid size-7 place-items-center"><Show when={props.opening || ['activating', 'pending'].includes(props.session.lifecycle)} fallback={<span class={`session-status-dot session-status-dot--${props.state.tone} size-7 shrink-0 rounded-full ${props.state.tone === 'idle' ? 'bg-text-faint' : props.state.tone === 'attention' ? 'bg-warning' : props.state.tone === 'danger' ? 'bg-danger' : 'bg-success'}`} role="img" aria-label={`Runtime status: ${props.state.detail || props.state.label}`} />}><Spinner label="Opening…" /></Show></span>
    </Button>
    <DropdownMenu open={props.menuOpen} onOpenChange={props.onMenuOpenChange} placement="bottom-end">
      <DropdownMenuTrigger as={IconButton}
        tooltipPlacement="end"
        class="session-menu absolute top-0 right-[20px] size-32 min-h-32 border-0 bg-transparent opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 pointer-coarse:size-44 pointer-coarse:min-h-44 pointer-coarse:opacity-100"
        ref={menuTrigger}
        disabled={props.readOnly || submitting()}
        label={`Session actions: ${displayTitle()}`}
      >
        <MoreIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent id={`${renameId()}-menu`} aria-label={`Session actions: ${displayTitle()}`} class="ui-menu">
        <DropdownMenuItem onSelect={() => props.onRenameOpenChange(true)}><RenameIcon />Rename session</DropdownMenuItem>
        <DropdownMenuItem class="text-danger focus:text-danger" disabled={props.runtimeActive} title={props.runtimeActive ? 'Close this session’s running instance first' : undefined} onClick={() => {
          props.onMenuOpenChange(false);
          props.onArchiveRequest(props.session.id);
        }}><ArchiveIcon />Archive session</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Popover open={props.renameOpen} onOpenChange={(open) => props.onRenameOpenChange(open)} placement="bottom-end">
      <PopoverTrigger as="span" class="sr-only" aria-label={`Rename ${displayTitle()}`} />
      <PopoverContent
        id={renameId()}
        aria-label={`Rename ${displayTitle()}`}
        class="ui-popover w-240 p-0"
        onEscapeKeyDown={(event) => submitting() && event.preventDefault()}
        onPointerDownOutside={(event) => submitting() && event.preventDefault()}
      >
        <form class="rename-popover w-240 p-10" onSubmit={submitRename}>
          <TextField aria-label="Session name" value={draft()} error={!renameValid() ? 'Name cannot be empty' : undefined} onInput={(event) => setDraft(event.currentTarget.value)} autofocus />
          <div class="form-actions">
            <Button disabled={submitting()} onClick={() => props.onRenameOpenChange(false)}>Cancel</Button>
            <Button variant="primary" type="submit" busy={submitting()} disabled={!renameValid()}>Save</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
    <Show when={props.session.lifecycle === 'failed'}>
      <div class="session-problem px-9 pb-7 pl-36 text-11 text-danger">Failed to open · <Button size="compact" class="cursor-pointer border-0! bg-transparent p-0! text-inherit underline" busy={props.replacementBusy} disabled={props.readOnly || props.replacementBusy} onClick={() => props.onCreateReplacement(props.session.title)}>Create replacement session</Button></div>
    </Show>
    <Show when={props.session.lifecycle === 'reconciliation_required'}>
      <div class="session-problem session-problem--warn px-9 pb-7 pl-36 text-11 text-warning">Server-side reconciliation required, retry not available</div>
    </Show>
  </div>;
}

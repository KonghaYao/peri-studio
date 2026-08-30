import { createEffect, createSignal, Show } from 'solid-js';
import type { ProjectSessionInfo } from '@/entities/registry/registry-view';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton, Popover, PopoverContent, PopoverTrigger, TextField } from '../../components/ui';
import { Archive, MoreHorizontal, Pencil } from 'lucide-solid';
import { sessionDisplayTitle } from '../../panel/lib/recovery-state.ts';
import { runConfirmedMutation } from '../../panel/lib/form-mutation';

export interface SessionRowState {
  label: string;
  tone: string;
  detail?: string;
}

export interface ProjectSessionRowProps {
  session: ProjectSessionInfo;
  state: SessionRowState;
  selected: boolean;
  navigationBusy: boolean;
  readOnly: boolean;
  renameOpen: boolean;
  menuOpen: boolean;
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

function MoreIcon() { return <MoreHorizontal size={17} strokeWidth={1.7} />; }
function RenameIcon() { return <Pencil size={16} strokeWidth={1.7} />; }
function ArchiveIcon() { return <Archive size={16} strokeWidth={1.7} />; }

export function ProjectSessionRow(props: ProjectSessionRowProps) {
  const [draft, setDraft] = createSignal(props.session.title);
  const [submitting, setSubmitting] = createSignal(false);
  let menuTrigger: HTMLButtonElement | undefined;
  const renameId = () => `rename-session-${props.session.id}`;
  const displayTitle = () => sessionDisplayTitle(
    props.session.title,
    props.session.id,
  );
  const renameValid = () => !!draft().trim();
  const loading = () => props.state.tone === 'busy';

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

  return <div data-session-id={props.session.id} class={`session-row group relative rounded-8 hover:bg-hover ${props.selected ? 'is-selected bg-selected' : ''}`}>
    <Button
      class="session-main relative flex min-h-34 w-full min-w-0 items-center justify-start gap-8 rounded-8 border-0 bg-transparent px-8 pr-36 text-left text-13 font-normal text-text-secondary cursor-pointer disabled:cursor-wait pointer-coarse:min-h-44 pointer-coarse:pr-36"
      aria-current={props.selected ? 'page' : undefined}
      title={props.readOnly && !props.session.activeChatId ? 'Full permission required to start this session' : undefined}
      onClick={open}
      disabled={(props.readOnly && !props.session.activeChatId) || props.session.lifecycle !== 'ready' || props.navigationBusy}
    >
      <span class="session-copy min-w-0 flex-1"><strong class="block overflow-hidden text-ellipsis whitespace-nowrap text-13 font-600 text-text-primary">{displayTitle()}</strong></span>
      <Show when={loading()}><span class="session-loading-wave absolute right-[6px] grid size-12 place-items-center" role="status" aria-label={props.state.detail || props.state.label}><span class="session-loading-wave__halo absolute size-10 rounded-full border border-success/45 animate-ping motion-reduce:animate-none" aria-hidden="true" /><span class="session-loading-wave__core relative size-6 rounded-full border border-success bg-surface" aria-hidden="true" /></span></Show>
    </Button>
    <DropdownMenu open={props.menuOpen} onOpenChange={props.onMenuOpenChange} placement="bottom-end">
      <DropdownMenuTrigger as={IconButton}
        tooltipPlacement="end"
        class="session-menu absolute top-1/2 right-6 -translate-y-1/2 border-0 bg-transparent opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 data-[expanded]:opacity-100"
        ref={menuTrigger}
        disabled={props.readOnly || submitting()}
        label="Session actions"
      >
        <MoreIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent id={`${renameId()}-menu`} aria-label={`Session actions: ${displayTitle()}`} class="ui-menu">
        <DropdownMenuItem onSelect={() => props.onRenameOpenChange(true)}><RenameIcon />Rename session</DropdownMenuItem>
        <DropdownMenuItem class="text-danger focus:text-danger" onClick={() => {
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
      <div class="session-problem px-9 pb-7 text-11 text-danger">Failed to open · <Button size="compact" class="cursor-pointer border-0! bg-transparent p-0! text-inherit underline" busy={props.replacementBusy} disabled={props.readOnly || props.replacementBusy} onClick={() => props.onCreateReplacement(props.session.title)}>Create replacement session</Button></div>
    </Show>
    <Show when={props.session.lifecycle === 'reconciliation_required'}>
      <div class="session-problem session-problem--warn px-9 pb-7 text-11 text-warning">Server-side reconciliation required, retry not available</div>
    </Show>
  </div>;
}

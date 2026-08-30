import { createEffect, createSignal, Show } from 'solid-js';
import type { ProjectSessionInfo } from '@/entities/registry/registry-view';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  TextField,
  Button,
} from '../../components/ui';
import { Archive, Pencil } from 'lucide-solid';
import { formatCompactRelativeTime, sessionDisplayTitle } from '../../panel/lib/recovery-state.ts';
import { runConfirmedMutation } from '../../panel/lib/form-mutation';
import { cn } from '../../lib/cn';
import { SessionMenuIcon, SessionRowTail } from './sidebar-parts';

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
  pinned?: boolean;
  indent?: number;
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

function RenameIcon() { return <Pencil size={16} strokeWidth={1.7} />; }
function ArchiveIcon() { return <Archive size={16} strokeWidth={1.7} />; }

export function ProjectSessionRow(props: ProjectSessionRowProps) {
  const [draft, setDraft] = createSignal(props.session.title);
  const [submitting, setSubmitting] = createSignal(false);
  const renameId = () => `rename-session-${props.session.id}`;
  const displayTitle = () => sessionDisplayTitle(
    props.session.title,
    props.session.id,
  );
  const renameValid = () => !!draft().trim();
  const loading = () => props.state.tone === 'busy';
  const relativeTime = () => formatCompactRelativeTime(props.session.lastOpenedAt || props.session.updatedAt);

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

  return (
    <div
      data-session-id={props.session.id}
      class={cn(
        'session-row group/row relative flex min-w-0 items-center rounded-md transition-colors duration-(--duration-fast)',
        props.selected ? 'bg-sidebar-selected' : 'hover:bg-interaction-hover',
      )}
      style={{
        'min-height': '32px',
        'padding-left': props.indent ? `calc(10px + ${props.indent}px)` : undefined,
      }}
    >
      <button
        type="button"
        class="flex min-h-8 min-w-0 flex-1 items-center rounded-md px-2.5 pr-12 text-left pointer-coarse:min-h-44"
        aria-current={props.selected ? 'page' : undefined}
        aria-label={displayTitle()}
        title={props.readOnly && !props.session.activeChatId ? 'Full permission required to start this session' : undefined}
        onClick={open}
        disabled={(props.readOnly && !props.session.activeChatId) || props.session.lifecycle !== 'ready' || props.navigationBusy}
      >
        <span class="session-copy min-w-0 flex-1 truncate text-13 text-content-primary">{displayTitle()}</span>
        <SessionRowTail
          time={relativeTime()}
          live={loading()}
          liveLabel={props.state.detail || props.state.label}
          pinOnHover={props.pinned}
        />
      </button>
      <Show when={!props.pinned}>
        <DropdownMenu open={props.menuOpen} onOpenChange={props.onMenuOpenChange} placement="bottom-end">
          <DropdownMenuTrigger
            as={IconButton}
            tooltipPlacement="end"
            class="session-menu absolute top-1/2 right-1.5 -translate-y-1/2 border-0 bg-surface-overlay/90 text-content-muted opacity-0 shadow-sm transition-opacity duration-(--duration-fast) group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 data-[expanded]:opacity-100"
            disabled={props.readOnly || submitting()}
            label="Session actions"
          >
            <SessionMenuIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent id={`${renameId()}-menu`} aria-label={`Session actions: ${displayTitle()}`} class="ui-menu">
            <DropdownMenuItem onSelect={() => props.onRenameOpenChange(true)}><RenameIcon />Rename session</DropdownMenuItem>
            <DropdownMenuItem class="text-danger focus:text-danger" onClick={() => {
              props.onMenuOpenChange(false);
              props.onArchiveRequest(props.session.id);
            }}><ArchiveIcon />Archive session</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Show>
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
        <div class="session-problem basis-full px-2.5 pb-1 text-11 text-danger">Failed to open · <Button size="compact" class="cursor-pointer border-0! bg-transparent p-0! text-inherit underline" busy={props.replacementBusy} disabled={props.readOnly || props.replacementBusy} onClick={() => props.onCreateReplacement(props.session.title)}>Create replacement session</Button></div>
      </Show>
      <Show when={props.session.lifecycle === 'reconciliation_required'}>
        <div class="session-problem session-problem--warn basis-full px-2.5 pb-1 text-11 text-warning">Server-side reconciliation required, retry not available</div>
      </Show>
    </div>
  );
}

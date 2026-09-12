import { createEffect, createSignal, Show } from 'solid-js';
import type { ProjectSessionInfo } from '@/entities/registry/registry-view';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  TextField,
  Button,
  SidebarMenuButton,
} from '@peri/ui';
import { Pencil } from 'lucide-solid';
import { formatCompactRelativeTime, sessionDisplayTitle } from '@/features/session/recovery-state';
import { runConfirmedMutation } from '@/features/session/form-mutation';
import { SessionRowAccessory } from '@peri/ui';

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
  pinned: boolean;
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
  onTogglePin: () => void;
}

function RenameIcon() { return <Pencil size={16} strokeWidth={1.7} />; }

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
      data-testid="session-row"
      class="session-row group/row relative flex min-h-36 min-w-0 items-center rounded-md"
      style={{
        'padding-left': props.indent ? `calc(10px + ${props.indent}px)` : undefined,
      }}
    >
      <SidebarMenuButton
        isActive={props.selected}
        class="min-h-36 w-full min-w-0 rounded-md p-0 pl-10 pr-(--sidebar-row-accessory-pr-session) pointer-coarse:min-h-44"
        aria-current={props.selected ? 'page' : undefined}
        aria-label={displayTitle()}
        onClick={open}
        disabled={(props.readOnly && !props.session.activeChatId) || props.session.lifecycle !== 'ready' || props.navigationBusy}
      >
        <span data-testid="session-copy" class="session-copy min-w-0 flex-1 truncate text-13 text-content-primary">{displayTitle()}</span>
      </SidebarMenuButton>
      <SessionRowAccessory
        time={relativeTime()}
        live={loading()}
        liveLabel={props.state.detail || props.state.label}
        pinned={props.pinned}
        readOnly={props.readOnly}
        menuOpen={props.menuOpen}
        onMenuOpenChange={props.onMenuOpenChange}
        onTogglePin={props.onTogglePin}
        onArchive={() => props.onArchiveRequest(props.session.id)}
        menuId={`${renameId()}-menu`}
        menuLabel={`Session actions: ${displayTitle()}`}
        menuItems={[{
          id: 'rename',
          label: 'Rename session',
          icon: <RenameIcon />,
          disabled: props.readOnly || submitting(),
        }]}
        onMenuSelect={(id) => {
          if (id === 'rename') props.onRenameOpenChange(true);
        }}
      />
      <Popover open={props.renameOpen} onOpenChange={(open) => props.onRenameOpenChange(open)} placement="bottom-end">
        <PopoverTrigger as="span" class="sr-only" aria-label={`Rename ${displayTitle()}`} />
        <PopoverContent
          id={renameId()}
          aria-label={`Rename ${displayTitle()}`}
          class="ui-popover w-240 p-0"
          onEscapeKeyDown={(event) => submitting() && event.preventDefault()}
          onPointerDownOutside={(event) => submitting() && event.preventDefault()}
        >
          <form data-testid="rename-popover" class="rename-popover w-240 p-10" onSubmit={submitRename}>
            <TextField aria-label="Session name" value={draft()} error={!renameValid() ? 'Name cannot be empty' : undefined} onInput={(event) => setDraft(event.currentTarget.value)} autofocus />
            <div class="form-actions">
              <Button disabled={submitting()} onClick={() => props.onRenameOpenChange(false)}>Cancel</Button>
              <Button variant="primary" type="submit" busy={submitting()} disabled={!renameValid()}>Save</Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
      <Show when={props.session.lifecycle === 'failed'}>
        <div data-testid="session-problem" class="basis-full px-10 pb-4 text-11 text-danger">Failed to open · <Button size="compact" class="cursor-pointer border-0! bg-transparent p-0! text-inherit underline" busy={props.replacementBusy} disabled={props.readOnly || props.replacementBusy} onClick={() => props.onCreateReplacement(props.session.title)}>Create replacement session</Button></div>
      </Show>
      <Show when={props.session.lifecycle === 'reconciliation_required'}>
        <div data-testid="session-problem-warn" class="basis-full px-10 pb-4 text-11 text-warning">Server-side reconciliation required, retry not available</div>
      </Show>
    </div>
  );
}

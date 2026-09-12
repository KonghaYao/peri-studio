import { createEffect, createSignal, Show } from 'solid-js';
import type { ProjectSessionInfo } from '@/entities/registry/registry-view';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  TextField,
  Button,
  cn,
  SessionLiveIndicator,
  SessionRowAccessory,
  type SessionLiveIndicatorTone,
} from '@peri/ui';
import { Pencil } from 'lucide-solid';
import { sessionDisplayTitle } from '@/features/session/recovery-state';
import { runConfirmedMutation } from '@/features/session/form-mutation';

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
  const lampTone = (): SessionLiveIndicatorTone | null => {
    const tone = props.state.tone;
    return tone === 'busy' || tone === 'attention' || tone === 'danger' ? tone : null;
  };

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
      data-selected={props.selected ? 'true' : undefined}
      class={cn(
        'group/row relative flex min-w-0 items-center rounded-md',
        props.selected
          ? 'bg-sidebar-selected'
          : 'hover:bg-interaction-hover focus-within:bg-interaction-hover',
      )}
      style={{
        'padding-left': props.indent ? `calc(5px + ${props.indent}px)` : undefined,
      }}
    >
      <Show when={lampTone()}>
        {(tone) => (
          <SessionLiveIndicator
            tone={tone()}
            label={props.state.detail || props.state.label}
            class="pointer-events-none absolute top-1/2 left-8 -translate-y-1/2"
          />
        )}
      </Show>
      <div class="relative flex w-full min-w-0 items-center">
        <button
          type="button"
          data-sidebar="menu-button"
          data-active={props.selected ? 'true' : undefined}
          class={cn(
            'flex w-full min-w-0 items-center overflow-hidden rounded-md bg-transparent py-4 pl-5 pr-0 text-left outline-none pointer-coarse:py-6',
            'focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2',
            'disabled:pointer-events-none disabled:opacity-45',
            props.selected && 'font-medium',
          )}
          aria-current={props.selected ? 'page' : undefined}
          aria-label={displayTitle()}
          onClick={open}
          disabled={(props.readOnly && !props.session.activeChatId) || props.session.lifecycle !== 'ready' || props.navigationBusy}
        >
          <span data-testid="session-copy" class="block min-w-0 w-full truncate text-13 leading-20 text-content-primary">{displayTitle()}</span>
        </button>
        <SessionRowAccessory
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
      </div>
      <Popover open={props.renameOpen} onOpenChange={(open) => props.onRenameOpenChange(open)} placement="bottom-end">
        <PopoverTrigger as="span" class="sr-only" aria-label={`Rename ${displayTitle()}`} />
        <PopoverContent
          id={renameId()}
          aria-label={`Rename ${displayTitle()}`}
          class="ui-popover w-240 p-0"
          onEscapeKeyDown={(event) => submitting() && event.preventDefault()}
          onPointerDownOutside={(event) => submitting() && event.preventDefault()}
        >
          <form data-testid="rename-popover" class="w-240 p-10" onSubmit={submitRename}>
            <TextField aria-label="Session name" value={draft()} error={!renameValid() ? 'Name cannot be empty' : undefined} onInput={(event) => setDraft(event.currentTarget.value)} autofocus />
            <div class="mt-10 flex justify-end gap-8">
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

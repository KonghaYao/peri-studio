import { createEffect, createSignal, Show } from 'solid-js';
import type { ProjectSessionInfo } from '@/entities/registry/registry-view';
import { read, type MaybeAccessor } from '@/shared/lib/maybe-accessor';
import {
  Button,
  cn,
  fileTreeInlineNameInputClass,
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
  session: MaybeAccessor<ProjectSessionInfo>;
  state: MaybeAccessor<SessionRowState>;
  selected: MaybeAccessor<boolean>;
  readOnly: MaybeAccessor<boolean>;
  renameOpen: MaybeAccessor<boolean>;
  menuOpen: MaybeAccessor<boolean>;
  replacementBusy: MaybeAccessor<boolean>;
  pinned: MaybeAccessor<boolean>;
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
  const session = () => read(props.session);
  const selected = () => read(props.selected);
  const state = () => read(props.state);
  const readOnly = () => read(props.readOnly);
  const renameOpen = () => read(props.renameOpen);
  const menuOpen = () => read(props.menuOpen);
  const replacementBusy = () => read(props.replacementBusy);
  const pinned = () => read(props.pinned);

  const [draft, setDraft] = createSignal(session().title);
  const [submitting, setSubmitting] = createSignal(false);
  let lastTitleClickAt = 0;
  let renameInputRef: HTMLInputElement | undefined;
  const renameId = () => `rename-session-${session().id}`;
  const displayTitle = () => sessionDisplayTitle(
    session().title,
    session().id,
  );
  const renameValid = () => !!draft().trim();
  const canRename = () => !readOnly() && !submitting();
  const lampTone = (): SessionLiveIndicatorTone | null => {
    const tone = state().tone;
    return tone === 'busy' || tone === 'attention' || tone === 'danger' ? tone : null;
  };

  createEffect(() => {
    if (!renameOpen()) return;
    setDraft(session().title);
    queueMicrotask(() => {
      renameInputRef?.focus();
      renameInputRef?.select();
    });
  });

  const open = () => {
    const activeChatId = session().activeChatId;
    if (readOnly() && activeChatId) {
      props.onSelectRuntime(session().id, activeChatId);
      props.onNavigate();
      return;
    }
    props.onOpen(session().id, props.onNavigate);
  };

  const handleTitleClick = () => {
    const now = Date.now();
    if (now - lastTitleClickAt < 400) {
      lastTitleClickAt = 0;
      return;
    }
    lastTitleClickAt = now;
    open();
  };

  const handleTitleDoubleClick = (event: MouseEvent) => {
    event.preventDefault();
    lastTitleClickAt = 0;
    if (!canRename()) return;
    props.onRenameOpenChange(true);
  };

  const cancelRename = () => {
    if (submitting()) return;
    setDraft(session().title);
    props.onRenameOpenChange(false);
  };

  const commitRename = () => {
    if (submitting()) return;
    const trimmed = draft().trim();
    if (!trimmed) {
      cancelRename();
      return;
    }
    if (trimmed === session().title.trim()) {
      props.onRenameOpenChange(false);
      return;
    }
    runConfirmedMutation(
      () => { setSubmitting(true); },
      () => { setSubmitting(false); },
      (committed, failed) => props.onRename(
        session().id,
        trimmed,
        committed,
        failed,
      ),
      () => props.onRenameOpenChange(false),
    );
  };

  const handleRenameKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRename();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelRename();
    }
  };

  const titleFieldBaseClass = 'flex w-full min-w-0 items-center overflow-hidden rounded-md bg-transparent py-4 pl-2 pr-0 pointer-coarse:py-6';

  return (
    <div
      data-session-id={session().id}
      data-testid="session-row"
      data-selected={selected() ? 'true' : undefined}
      class={cn(
        'group/row relative flex min-w-0 items-center rounded-md',
        selected()
          ? 'bg-sidebar-selected'
          : 'hover:bg-interaction-hover focus-within:bg-interaction-hover',
      )}
    >
      <div
        data-testid="session-live-gutter"
        class="ml-13 mr-7 flex w-8 shrink-0 items-center justify-center self-stretch"
        aria-hidden={lampTone() ? undefined : 'true'}
      >
        <Show when={lampTone()}>
          {(tone) => (
            <SessionLiveIndicator
              tone={tone()}
              label={state().detail || state().label}
              class="pointer-events-none"
            />
          )}
        </Show>
      </div>
      <div class="relative flex min-w-0 flex-1 items-center">
        <Show
          when={renameOpen()}
          fallback={(
            <button
              type="button"
              data-sidebar="menu-button"
              data-active={selected() ? 'true' : undefined}
              class={cn(
                titleFieldBaseClass,
                selected() && 'font-medium',
                'text-left outline-none',
                'focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2',
                'disabled:pointer-events-none disabled:opacity-45',
              )}
              aria-current={selected() ? 'page' : undefined}
              aria-label={displayTitle()}
              onClick={handleTitleClick}
              onDblClick={handleTitleDoubleClick}
              disabled={(readOnly() && !session().activeChatId) || session().lifecycle !== 'ready'}
            >
              <span data-testid="session-copy" class="block min-w-0 w-full truncate text-13 leading-20 text-content-primary">{displayTitle()}</span>
            </button>
          )}
        >
          <div class={cn(titleFieldBaseClass, selected() && 'font-medium', 'bg-selected')}>
            <input
              ref={(element) => { renameInputRef = element; }}
              id={renameId()}
              data-testid="session-rename-input"
              class={cn(
                fileTreeInlineNameInputClass,
                'block min-w-0 w-full text-13 leading-20 text-content-primary',
                !renameValid() && 'outline-1 outline-danger-border outline-offset-neg-1',
              )}
              value={draft()}
              aria-label="Session name"
              aria-invalid={!renameValid() || undefined}
              disabled={submitting()}
              onInput={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={commitRename}
            />
          </div>
        </Show>
        <SessionRowAccessory
          pinned={pinned}
          readOnly={readOnly}
          menuOpen={menuOpen}
          onMenuOpenChange={props.onMenuOpenChange}
          onTogglePin={props.onTogglePin}
          onArchive={() => props.onArchiveRequest(session().id)}
          menuId={`${renameId()}-menu`}
          menuLabel={`Session actions: ${displayTitle()}`}
          menuItems={[{
            id: 'rename',
            label: 'Rename session',
            icon: <RenameIcon />,
            disabled: !canRename(),
          }]}
          onMenuSelect={(id) => {
            if (id === 'rename') props.onRenameOpenChange(true);
          }}
        />
      </div>
      <Show when={session().lifecycle === 'failed'}>
        <div data-testid="session-problem" class="basis-full px-10 pb-4 text-11 text-danger">Failed to open · <Button size="compact" class="cursor-pointer border-0! bg-transparent p-0! text-inherit underline" busy={replacementBusy()} disabled={readOnly() || replacementBusy()} onClick={() => props.onCreateReplacement(session().title)}>Create replacement session</Button></div>
      </Show>
      <Show when={session().lifecycle === 'reconciliation_required'}>
        <div data-testid="session-problem-warn" class="basis-full px-10 pb-4 text-11 text-warning">Server-side reconciliation required, retry not available</div>
      </Show>
    </div>
  );
}

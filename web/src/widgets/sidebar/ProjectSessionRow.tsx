import { createEffect, createSignal, Show } from 'solid-js';
import type { ProjectSessionInfo } from '@/entities/registry/registry-view';
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
  session: ProjectSessionInfo;
  state: SessionRowState;
  selected: boolean;
  navigationBusy: boolean;
  readOnly: boolean;
  renameOpen: boolean;
  menuOpen: boolean;
  replacementBusy: boolean;
  pinned: boolean;
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
  let lastTitleClickAt = 0;
  let renameInputRef: HTMLInputElement | undefined;
  const renameId = () => `rename-session-${props.session.id}`;
  const displayTitle = () => sessionDisplayTitle(
    props.session.title,
    props.session.id,
  );
  const renameValid = () => !!draft().trim();
  const canRename = () => !props.readOnly && !submitting();
  const lampTone = (): SessionLiveIndicatorTone | null => {
    const tone = props.state.tone;
    return tone === 'busy' || tone === 'attention' || tone === 'danger' ? tone : null;
  };

  createEffect(() => {
    if (!props.renameOpen) return;
    setDraft(props.session.title);
    queueMicrotask(() => {
      renameInputRef?.focus();
      renameInputRef?.select();
    });
  });

  const open = () => {
    if (props.readOnly && props.session.activeChatId) {
      props.onSelectRuntime(props.session.id, props.session.activeChatId);
      props.onNavigate();
      return;
    }
    props.onOpen(props.session.id, props.onNavigate);
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
    setDraft(props.session.title);
    props.onRenameOpenChange(false);
  };

  const commitRename = () => {
    if (submitting()) return;
    const trimmed = draft().trim();
    if (!trimmed) {
      cancelRename();
      return;
    }
    if (trimmed === props.session.title.trim()) {
      props.onRenameOpenChange(false);
      return;
    }
    runConfirmedMutation(
      () => { setSubmitting(true); },
      () => { setSubmitting(false); },
      (committed, failed) => props.onRename(
        props.session.id,
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

  const titleFieldClass = cn(
    'flex w-full min-w-0 items-center overflow-hidden rounded-md bg-transparent py-4 pl-2 pr-0 pointer-coarse:py-6',
    props.selected && 'font-medium',
  );

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
              label={props.state.detail || props.state.label}
              class="pointer-events-none"
            />
          )}
        </Show>
      </div>
      <div class="relative flex min-w-0 flex-1 items-center">
        <Show
          when={props.renameOpen}
          fallback={(
            <button
              type="button"
              data-sidebar="menu-button"
              data-active={props.selected ? 'true' : undefined}
              class={cn(
                titleFieldClass,
                'text-left outline-none',
                'focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2',
                'disabled:pointer-events-none disabled:opacity-45',
              )}
              aria-current={props.selected ? 'page' : undefined}
              aria-label={displayTitle()}
              onClick={handleTitleClick}
              onDblClick={handleTitleDoubleClick}
              disabled={(props.readOnly && !props.session.activeChatId) || props.session.lifecycle !== 'ready'}
            >
              <span data-testid="session-copy" class="block min-w-0 w-full truncate text-13 leading-20 text-content-primary">{displayTitle()}</span>
            </button>
          )}
        >
          <div class={cn(titleFieldClass, 'bg-selected')}>
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
            disabled: !canRename(),
          }]}
          onMenuSelect={(id) => {
            if (id === 'rename') props.onRenameOpenChange(true);
          }}
        />
      </div>
      <Show when={props.session.lifecycle === 'failed'}>
        <div data-testid="session-problem" class="basis-full px-10 pb-4 text-11 text-danger">Failed to open · <Button size="compact" class="cursor-pointer border-0! bg-transparent p-0! text-inherit underline" busy={props.replacementBusy} disabled={props.readOnly || props.replacementBusy} onClick={() => props.onCreateReplacement(props.session.title)}>Create replacement session</Button></div>
      </Show>
      <Show when={props.session.lifecycle === 'reconciliation_required'}>
        <div data-testid="session-problem-warn" class="basis-full px-10 pb-4 text-11 text-warning">Server-side reconciliation required, retry not available</div>
      </Show>
    </div>
  );
}

import type { ProjectSessionInfo } from '@/entities/registry/registry-view';
import { read, type MaybeAccessor } from '@/shared/lib/maybe-accessor';
import {
  chatStatusSignal,
  chatTurnActiveSignal,
  createProjectSession,
  creatingSessionProjectId,
  navigateProjectSession,
  openingSessionId,
  permissions,
  readOnly,
  renameProjectSession,
  selectedCid,
  selectedSessionId,
  turnActive,
} from '@/store';
import { runtimeState } from '@/features/runtime/runtime-state';
import { sessionHasLiveRuntime } from '@/features/session/recovery-state';
import { ProjectSessionRow } from './ProjectSessionRow';
import type { ProjectSidebarModel } from './project-sidebar-model';

export interface ProjectSidebarRowProps {
  model: ProjectSidebarModel;
  session: MaybeAccessor<ProjectSessionInfo>;
  projectId: MaybeAccessor<string>;
  options?: { pinned?: boolean };
  onNavigate?: () => void;
}

export function ProjectSidebarRow(props: ProjectSidebarRowProps) {
  const session = () => read(props.session);
  const sessionId = () => session().id;
  const menuKey = () => `${props.options?.pinned ? 'pinned' : 'workspace'}:${sessionId()}`;
  const selected = () => selectedSessionId() === sessionId();
  const chatId = () => session().activeChatId;
  const liveRuntime = () => sessionHasLiveRuntime(session(), chatStatusSignal());
  const state = () => runtimeState({
    hasSession: true,
    lifecycle: session().lifecycle,
    isOpening: openingSessionId() === sessionId() && !liveRuntime(),
    hasRuntime: !!chatId(),
    isSelected: selected(),
    chatStatus: chatId() ? chatStatusSignal()[chatId()!] ?? null : null,
    hasPendingPermission: selected() && permissions().some((permission) => permission.status === 'pending'),
    turnActive: liveRuntime() && (
      chatTurnActiveSignal()[chatId()!] === true
      || (selected() && selectedCid() === chatId() && turnActive())
    ),
  });

  return (
    <ProjectSessionRow
      session={session}
      state={state}
      selected={selected}
      readOnly={readOnly}
      renameOpen={() => props.model.editing() === sessionId()}
      menuOpen={() => props.model.sessionMenu() === menuKey()}
      replacementBusy={() => creatingSessionProjectId() === read(props.projectId)}
      pinned={() => props.model.isSessionPinned(session())}
      onNavigate={() => props.onNavigate?.()}
      onOpen={(sessionId, onCommitted) => { navigateProjectSession(sessionId, { onCommitted }); }}
      onSelectRuntime={(id) => { navigateProjectSession(id); }}
      onRenameOpenChange={(open) => props.model.setEditing(open ? sessionId() : null)}
      onMenuOpenChange={(open) => props.model.setSessionMenu(open ? menuKey() : null)}
      onRename={renameProjectSession}
      onCreateReplacement={(title) => { createProjectSession(read(props.projectId), title); }}
      onArchiveRequest={props.model.requestArchiveSession}
      onTogglePin={() => props.model.toggleSessionPin(sessionId())}
    />
  );
}

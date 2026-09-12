import type { ProjectSessionInfo } from '@/entities/registry/registry-view';
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
  session: ProjectSessionInfo;
  projectId: string;
  options?: { pinned?: boolean; indent?: number };
  onNavigate?: () => void;
}

export function ProjectSidebarRow(props: ProjectSidebarRowProps) {
  const { model } = props;
  const sessionId = props.session.id;
  const menuKey = `${props.options?.pinned ? 'pinned' : 'workspace'}:${sessionId}`;
  const selected = () => selectedSessionId() === sessionId;
  const chatId = () => props.session.activeChatId;
  const liveRuntime = () => sessionHasLiveRuntime(props.session, chatStatusSignal());
  const state = () => runtimeState({
    hasSession: true,
    lifecycle: props.session.lifecycle,
    isOpening: openingSessionId() === sessionId && !liveRuntime(),
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
      session={props.session}
      state={state()}
      selected={selected()}
      navigationBusy={!!openingSessionId()}
      readOnly={readOnly()}
      renameOpen={model.editing() === sessionId}
      menuOpen={model.sessionMenu() === menuKey}
      replacementBusy={creatingSessionProjectId() === props.projectId}
      pinned={model.isSessionPinned(props.session)}
      indent={props.options?.indent}
      onNavigate={() => props.onNavigate?.()}
      onOpen={(sessionId, onCommitted) => { navigateProjectSession(sessionId, { onCommitted }); }}
      onSelectRuntime={(id) => { navigateProjectSession(id); }}
      onRenameOpenChange={(open) => model.setEditing(open ? sessionId : null)}
      onMenuOpenChange={(open) => model.setSessionMenu(open ? menuKey : null)}
      onRename={renameProjectSession}
      onCreateReplacement={(title) => { createProjectSession(props.projectId, title); }}
      onArchiveRequest={model.requestArchiveSession}
      onTogglePin={() => model.toggleSessionPin(sessionId)}
    />
  );
}

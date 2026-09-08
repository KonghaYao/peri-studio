import type { ProjectSessionInfo } from '@/entities/registry/registry-view';
import {
  chatStatusSignal,
  createProjectSession,
  creatingSessionProjectId,
  navigateProjectSession,
  openingSessionId,
  permissions,
  readOnly,
  renameProjectSession,
  runtimeDocsHydrated,
  selectedCid,
  selectedSessionId,
  turnActive,
} from '@/store';
import { runtimeState } from '@/features/runtime/runtime-state';
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
  const state = () => runtimeState({
    hasSession: true,
    lifecycle: props.session.lifecycle,
    isOpening: openingSessionId() === sessionId,
    hasRuntime: !!props.session.activeChatId,
    isSelected: selected(),
    isHydrated: selected() ? runtimeDocsHydrated() : undefined,
    chatStatus: selected() ? chatStatusSignal()[selectedCid() ?? ''] : null,
    hasPendingPermission: selected() && permissions().some((permission) => permission.status === 'pending'),
    turnActive: selected() && turnActive(),
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
      onArchiveRequest={model.setArchiveSessionCandidate}
      onTogglePin={() => model.toggleSessionPin(sessionId)}
    />
  );
}

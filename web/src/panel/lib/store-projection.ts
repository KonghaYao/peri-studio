import type { Setter } from 'solid-js';
import * as H from './protocol';
import type { DocStore } from './doc-store';
import type { ChatEntry } from './chat-view';
import { ChatProjection } from './chat-projection';
import { renderControl, type ControlView } from './control-view';
import type { ChatInfo, InstanceInfo, ProjectInfo, ProjectSessionInfo, SessionSummaryInfo } from './registry-view';
import { RegistryProjection } from './registry-projection';
import { unimportedSessions } from './session-import';
import { isTerminal } from './action-state';
import { retainLiveRuntimeHints } from './recovery-state';
import { reconcileMessageProjection } from './message-delivery';
import { reconcileRuntimeControl } from './runtime-control';
import { retainProjectedPermissions } from './permission-delivery';
import { retainProjectedElicitations } from './elicitation-delivery';

export interface RuntimeDocsState { chat: boolean; control: boolean }

interface ProjectionSignals {
  setChatEntries: Setter<ChatEntry[]>;
  setChatHead: Setter<ControlView | null>;
  setPermissions: Setter<ControlView['pendingPermissions']>;
  setElicitations: Setter<NonNullable<ControlView['pendingElicitations']>>;
  setProjects: Setter<ProjectInfo[]>;
  setRegistryHydrated: Setter<boolean>;
  setProjectSessions: Setter<ProjectSessionInfo[]>;
  setImportableSessions: Setter<SessionSummaryInfo[]>;
  setInstances: Setter<InstanceInfo[]>;
  setChatCatalog: Setter<ChatInfo[]>;
  setGlobalStatus: Setter<string>;
  setSchemaVersion: Setter<unknown>;
  setChatStatusSignal: Setter<Record<string, string>>;
  setRuntimeDocsState: Setter<RuntimeDocsState>;
}

export function installStoreProjection(
  store: DocStore,
  currentCid: () => string | null,
  signals: ProjectionSignals,
  reconcileSessionNavigation: (sessions: ProjectSessionInfo[]) => void,
  reconcileCurrentRuntimeControl: (control?: ControlView) => void,
  onRuntimeProgress: (chatId: string) => void,
): void {
  const chatProjection = new ChatProjection();
  const registryProjection = new RegistryProjection();
  let projectedChatDocId: string | null = null;
  let projectedProjectSessions: ProjectSessionInfo[] = [];
  store.observeRemoval((docId) => {
    if (docId === null || docId === H.DOC_REGISTRY) {
      registryProjection.dispose();
      projectedProjectSessions = [];
    }
    if (docId === null || docId === projectedChatDocId) {
      chatProjection.dispose();
      projectedChatDocId = null;
    }
  });
  store.onUpdate = (docId: string): void => {
    if (docId === H.DOC_REGISTRY) {
      const registry = registryProjection.project(store.docFor(docId));
      const statusMap: Record<string, string> = {};
      registry.chats.forEach((chat) => {
        statusMap[chat.id] = chat.status || '';
        if (isTerminal(chat.status || undefined)) reconcileRuntimeControl(chat.id, true, true);
      });
      signals.setChatStatusSignal(statusMap);
      signals.setInstances(registry.instances);
      signals.setChatCatalog(registry.chats);
      signals.setGlobalStatus(registry.globalStatus);
      signals.setSchemaVersion(registry.schemaVersion);
      signals.setProjects(registry.projects);
      const sessions = retainLiveRuntimeHints(
        registry.projectSessions,
        registry.chats,
        projectedProjectSessions,
      ) as ProjectSessionInfo[];
      projectedProjectSessions = sessions;
      signals.setProjectSessions(sessions);
      signals.setImportableSessions(unimportedSessions(registry.sessions, registry.projectSessions));
      signals.setRegistryHydrated(true);
      reconcileSessionNavigation(sessions);
      return;
    }
    const cid = currentCid();
    if (cid && docId === H.chatDoc(cid)) {
      projectedChatDocId = docId;
      const conversation = chatProjection.project(store.docFor(docId)).view;
      onRuntimeProgress(cid);
      signals.setChatEntries(conversation.entries);
      reconcileMessageProjection(new Set(conversation.entries
        .map((entry) => entry.sourceCommandId)
        .filter((commandId): commandId is string => commandId !== null)));
      signals.setRuntimeDocsState((state) => ({ ...state, chat: true }));
      return;
    }
    if (cid && docId === H.sessionDoc(cid)) {
      const control = renderControl(store.docFor(docId));
      onRuntimeProgress(cid);
      signals.setChatHead(control);
      signals.setPermissions(control.pendingPermissions);
      const elicitations = control.pendingElicitations ?? [];
      signals.setElicitations(elicitations);
      retainProjectedElicitations(elicitations);
      signals.setRuntimeDocsState((state) => ({ ...state, control: true }));
      retainProjectedPermissions(new Set(control.pendingPermissions
        .map((item) => item.permissionId)
        .filter((id): id is string => !!id)));
      reconcileCurrentRuntimeControl(control);
    }
  };
}

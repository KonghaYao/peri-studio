import * as Y from 'yjs';
import { asMap, getStr } from '@/shared/yjs/yjs-values';
import { compareSessionsForSidebar } from './session-order';

export interface InstanceInfo {
  id: string;
  hostname: string | null;
  status: string | null;
  tokenId: string | null;
  registeredAt: string | null;
  lastHeartbeat: string | null;
  chatCount: unknown;
  resourceProtocolVersion?: number | null;
  resourceWrite?: boolean;
  resourceStructuralMutations?: boolean;
}

export interface ChatInfo {
  id: string;
  instanceId: string | null;
  title: string | null;
  status: string | null;
  gap: unknown;
  updatedAt: string | null;
  cwd: string | null;
  workspaceId: string | null;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  cwd: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ProjectInfo {
  id: string;
  name: string;
  cwd: string;
  instanceId: string;
  createdAt: string | null;
  updatedAt: string | null;
  archivedAt: string | null;
}

export interface MachineInfo {
  instanceId: string;
  kind: string;
  displayName: string;
  sshDestination: string | null;
  sshPort: number | null;
  phase: string;
  errorCode: string | null;
  hasIdentityFile: boolean;
  autoReconnect: boolean;
  hostKeySha256: string | null;
  updatedAt: string | null;
  archivedAt: string | null;
}

/** ACP 权威会话目录项：`id` 即 ACP durable session id（ADR-0003）。 */
export interface ProjectSessionInfo {
  /** ACP durable session id；与 Registry `project_sessions` map 键同值。 */
  id: string;
  projectId: string;
  title: string;
  lifecycle: string;
  updatedAt: string | null;
  lastOpenedAt: string | null;
  /** ChatRegistry 运行态投影；非 SQLite 持久字段。 */
  activeChatId: string | null;
  /** Web IndexedDB 用户偏好合并结果；registry 投影不携带。 */
  archivedAt?: string | null;
}

export interface SessionSummaryInfo {
  sessionId: string;
  title: string | null;
  status: string | null;
  updatedAt: string | null;
  cwd: string | null;
  boundChatId?: string | null;
}

export interface RegistryView {
  instances: InstanceInfo[];
  chats: ChatInfo[];
  sessions: SessionSummaryInfo[];
  workspaces: WorkspaceInfo[];
  projects: ProjectInfo[];
  machines: MachineInfo[];
  projectSessions: ProjectSessionInfo[];
  globalStatus: string;
  schemaVersion: unknown;
  projectionVersion: unknown;
}

/** Read-only browser projection of the hub:registry document. */
export function renderRegistry(doc: Y.Doc): RegistryView {
  const root = doc.getMap<unknown>('root');
  const instances: InstanceInfo[] = [];
  const chats: ChatInfo[] = [];
  const sessions: SessionSummaryInfo[] = [];
  const workspaces: WorkspaceInfo[] = [];
  const projects: ProjectInfo[] = [];
  const machines: MachineInfo[] = [];
  const projectSessions: ProjectSessionInfo[] = [];

  asMap(root.get('instances'))?.forEach((value, id) => {
    const map = asMap(value);
    instances.push({
      id,
      hostname: getStr(map, 'hostname'),
      status: getStr(map, 'status'),
      tokenId: getStr(map, 'token_id'),
      registeredAt: getStr(map, 'registered_at'),
      lastHeartbeat: getStr(map, 'last_heartbeat'),
      chatCount: map?.get('chat_count') ?? null,
      resourceProtocolVersion: typeof map?.get('resource_protocol_version') === 'number'
        ? map.get('resource_protocol_version') as number
        : null,
      resourceWrite: map?.get('resource_write') === true,
      resourceStructuralMutations: map?.get('resource_structural_mutations') === true,
    });
  });

  asMap(root.get('chats'))?.forEach((value, id) => {
    const map = asMap(value);
    chats.push({
      id,
      instanceId: getStr(map, 'instance_id'),
      title: getStr(map, 'title'),
      status: getStr(map, 'status'),
      gap: map?.get('gap') ?? null,
      updatedAt: getStr(map, 'updated_at'),
      cwd: getStr(map, 'cwd'),
      workspaceId: getStr(map, 'workspace_id'),
    });
  });

  asMap(root.get('workspaces'))?.forEach((value, id) => {
    const map = asMap(value);
    workspaces.push({
      id,
      name: getStr(map, 'name') || '',
      cwd: getStr(map, 'cwd') || '',
      createdAt: getStr(map, 'created_at'),
      updatedAt: getStr(map, 'updated_at'),
    });
  });
  workspaces.sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));

  asMap(root.get('projects'))?.forEach((value, id) => {
    const map = asMap(value);
    if (!map) return;
    projects.push({
      id,
      name: getStr(map, 'name') || id,
      cwd: getStr(map, 'cwd') || '',
      instanceId: getStr(map, 'instance_id') || '',
      createdAt: getStr(map, 'created_at'),
      updatedAt: getStr(map, 'updated_at'),
      archivedAt: getStr(map, 'archived_at'),
    });
  });
  projects.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));

  asMap(root.get('project_sessions'))?.forEach((value, mapKey) => {
    const map = asMap(value);
    if (!map) return;
    const acpId = getStr(map, 'acp_session_id') || mapKey;
    projectSessions.push({
      id: acpId,
      projectId: getStr(map, 'project_id') || '',
      title: getStr(map, 'title') || 'New conversation',
      lifecycle: getStr(map, 'lifecycle') || 'pending',
      updatedAt: getStr(map, 'updated_at'),
      lastOpenedAt: getStr(map, 'last_opened_at'),
      activeChatId: getStr(map, 'active_chat_id'),
      archivedAt: getStr(map, 'archived_at'),
    });
  });
  projectSessions.sort(compareSessionsForSidebar);

  const seen = new Set<string>();
  asMap(root.get('sessions'))?.forEach((value) => {
    const map = asMap(value);
    const sessionId = getStr(map, 'session_id') || '';
    if (!map || !sessionId || seen.has(sessionId)) return;
    seen.add(sessionId);
    sessions.push({
      sessionId,
      title: getStr(map, 'title'),
      status: getStr(map, 'status'),
      updatedAt: getStr(map, 'updated_at'),
      cwd: getStr(map, 'cwd'),
    });
  });
  sessions.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));

  asMap(root.get('machines'))?.forEach((value, id) => {
    const map = asMap(value);
    if (!map) return;
  const portRaw = map.get('ssh_port');
    machines.push({
      instanceId: getStr(map, 'instance_id') || id,
      kind: getStr(map, 'kind') || 'ssh',
      displayName: getStr(map, 'display_name') || id,
      sshDestination: getStr(map, 'ssh_destination'),
      sshPort: typeof portRaw === 'number' ? portRaw : null,
      phase: getStr(map, 'phase') || 'offline',
      errorCode: getStr(map, 'error_code'),
      hasIdentityFile: map.get('has_identity_file') === true,
      autoReconnect: map.get('auto_reconnect') === true,
      hostKeySha256: getStr(map, 'host_key_sha256'),
      updatedAt: getStr(map, 'updated_at'),
      archivedAt: getStr(map, 'archived_at'),
    });
  });
  machines.sort((left, right) => {
    if (left.kind === 'local') return -1;
    if (right.kind === 'local') return 1;
    return String(left.displayName).localeCompare(String(right.displayName));
  });

  return {
    instances,
    chats,
    sessions,
    workspaces,
    projects,
    machines,
    projectSessions,
    globalStatus: getStr(asMap(root.get('global')), 'status') || 'unknown',
    schemaVersion: root.get('schema_version'),
    projectionVersion: root.get('projection_version'),
  };
}

// peri-studio Web 面板 —— 帧协议模块（移植自原 protocol.js，TS 化）。
//
// 与 server 的 client 面协议逐字对齐（M3 方案 §1）：
//   - payload 字段 camelCase；`t` 为顶层判别字段；
//   - `action_ack.status` 为小写 snake_case（accepted/committed/duplicate）；
//   - `action_error.code` 为 SCREAMING_SNAKE_CASE；
//   - ysync 订阅字段名是 `docs`（DocId 透明字符串）；
//   - 快照帧带 `projectionVersion`，增量帧不带（serde skip，不输出 null）。
//
// 本模块只负责帧的构造/解析与 base64 工具，不持有任何连接状态
// （连接状态机见 ws-client.ts）。

import { isResourceResult, type ResourceResultFrame } from './resource-protocol';
import {
  decodeTerminalFrame,
  type TerminalErrorFrame,
  type TerminalExitFrame,
  type TerminalOpenedFrame,
  type TerminalOutputFrame,
} from '@/shared/protocol/terminal';
import { isActionResourceResult, isDeleteConfirmResultFrame } from '@/shared/protocol/resource-fs-mutation';
import { isServerDocId } from './doc-id';

/** 注册表 doc id（与 proto/src/conn.rs 的 DocId::REGISTRY 对齐），常驻订阅。 */
export { DOC_REGISTRY, isServerDocId } from './doc-id';
export const CAP_PROMPT_DELIVERY_V2 = 'prompt-delivery-v2';

/** chat 派生 doc id（订阅字段透明字符串，前缀区分投影）。 */
export const chatDoc = (sid: string): string => `chat:${sid}`;
export const sessionDoc = (sid: string): string => `session:${sid}`;

/** action 幂等键：crypto.randomUUID（浏览器全局；localhost/https 下可用）。 */
export const newCommandId = (): string => crypto.randomUUID();

// ── 上行帧 ──────────────────────────────────────────────────────────────

/** 认证帧：ws 握手后第一帧必须是它（否则 server 以 1011 关闭）。client 面
 *  无 HMAC（§9.2 仅覆盖 instance 连接），token 为 44 字符 base64，顶层字段。
 *  认证失败 → server 以 4502 关闭。 */
export const auth = (token: string) => ({ t: 'auth', token });

/** ysync 订阅：字段名 `docs`；首个订阅后 server 推各 doc 快照 + ready。 */
export const subscribe = (docs: string[]) => ({
  t: 'ysync.subscribe',
  docs,
  clientCapabilities: [CAP_PROMPT_DELIVERY_V2],
});

/** ysync 退订：幂等，重复退订无副作用。 */
export const unsubscribe = (docs: string[]) => ({ t: 'ysync.unsubscribe', docs });

/** 心跳应答：server 每 5s 发 keep_alive，15s（3×间隔）内不回 → 4501 关闭。 */
export const pong = () => ({ t: 'pong' });

// ── action 帧 ───────────────────────────────────────────────────────────

/** 外层包装：t/commandId/type/payload 四字段；commandId 为幂等键
 *  （重试复用同一 commandId，server 幂等去重 → duplicate ack）。 */
export const action = (type: string, payload: Record<string, unknown>) => ({
  t: 'action',
  commandId: newCommandId(),
  type,
  payload,
});

/** 新建对话：三字段全可选（缺省 = 本机）。committed ack 携带的 chatId
 *  是 server 生成 id 的唯一告知路径 → main 据此自动补订阅并选中。
 *
 *  `acpSessionId`（ACP 历史会话 id，session/list 返回）：携带时 create 走
 *  `session/load`（§8.5 历史恢复）——回放 ACP agent 磁盘会话内容到新对话。
 *
 *  `workspaceId`（归属工作区，§6.3 workspace 扩展）：携带时 cwd 继承自
 *  workspace 定义（server 侧解析，不信任客户端直传 cwd）。 */
export const createChat = (title?: string, acpSessionId?: string, workspaceId?: string) => {
  const payload: Record<string, unknown> = {};
  if (title) payload.title = title;
  if (acpSessionId) payload.acpSessionId = acpSessionId;
  if (workspaceId) payload.workspaceId = workspaceId;
  return action('chat/create', payload);
};

/** 新建工作区：定义本地目录 cwd，其下新建对话继承该目录（§6.3 workspace
 *  扩展）。管理面命令（独立于 chat）：accepted → committed 直通，无队列。 */
export const workspaceCreate = (name: string, cwd: string) =>
  action('workspace/create', { name, cwd });

/** 删除工作区定义（不影响已建对话/会话；仅移除 Registry Doc 条目）。 */
export const workspaceRemove = (workspaceId: string) =>
  action('workspace/remove', { workspaceId });

export const projectCreate = (name: string, cwd: string, instanceId?: string) => {
  const payload: Record<string, unknown> = { name, cwd };
  if (instanceId) payload.instanceId = instanceId;
  return action('project/create', payload);
};

export const projectArchive = (projectId: string) =>
  action('project/archive', { projectId });

export const projectRestore = (projectId: string) =>
  action('project/restore', { projectId });

export const projectRename = (projectId: string, name: string) =>
  action('project/rename', { projectId, name });

export const machineAdd = (
  destination: string,
  displayName?: string,
  port?: number,
  identityFile?: string,
) => {
  const payload: Record<string, unknown> = { destination };
  if (displayName) payload.displayName = displayName;
  if (port != null) payload.port = port;
  if (identityFile) payload.identityFile = identityFile;
  return action('machine/add', payload);
};

export const machineConnect = (instanceId: string) =>
  action('machine/connect', { instanceId });

export const machineDisconnect = (instanceId: string) =>
  action('machine/disconnect', { instanceId });

export const machineStop = (instanceId: string) =>
  action('machine/stop', { instanceId });

export const machineCancel = (instanceId: string) =>
  action('machine/cancel', { instanceId });

export const machineRetry = (instanceId: string) =>
  action('machine/retry', { instanceId });

export const machineTrustHost = (instanceId: string, fingerprint: string) =>
  action('machine/trust-host', { instanceId, fingerprint });

export const machineConfirmReplace = (instanceId: string) =>
  action('machine/confirm-replace', { instanceId });

export const machineRename = (instanceId: string, name: string) =>
  action('machine/rename', { instanceId, name });

export const machineSetAutoReconnect = (instanceId: string, enabled: boolean) =>
  action('machine/set-auto-reconnect', { instanceId, enabled });

export const machineRemove = (instanceId: string) =>
  action('machine/remove', { instanceId });

export const machineRestore = (instanceId: string) =>
  action('machine/restore', { instanceId });

export const persistedSessionCreate = (projectId: string, title?: string) => {
  const payload: Record<string, unknown> = { projectId };
  if (title) payload.title = title;
  return action('session/create', payload);
};

export const persistedSessionOpen = (sessionId: string) =>
  action('session/open', { sessionId });

export const persistedSessionRename = (sessionId: string, name: string) =>
  action('session/rename', { sessionId, name });

export const persistedSessionArchive = (sessionId: string) =>
  action('session/archive', { sessionId });

export const persistedSessionRestore = (sessionId: string) =>
  action('session/restore', { sessionId });

export const persistedSessionImport = (projectId: string, acpSessionId: string) =>
  action('session/import', { projectId, acpSessionId });

export const persistedSessionDiscover = (projectId: string) =>
  action('session/discover', { projectId });

export const persistedSessionPromptStatus = (sessionId: string) =>
  action('session/prompt-status', { sessionId });

/** 按需查询指定对话的 ACP 会话列表（§6.3）：server 从 chat record 解析
 *  cwd 向 agent 侧发 session/list RPC，结果经 `session_list` 下行帧回投
 *  （agent 侧是真实数据源，非轮询投影过滤）。 */
export const sessionList = (chatId: string) => action('session/list', { chatId });

export const mcpList = (chatId: string) => action('mcp/list', { chatId });
export const mcpOAuthStart = (chatId: string, serverName: string) =>
  action('mcp/oauth-start', { chatId, serverName });
export const mcpOAuthAuthorization = (chatId: string, flowId: string) =>
  action('mcp/oauth-authorization', { chatId, flowId });
export const mcpOAuthCancel = (chatId: string, flowId: string) =>
  action('mcp/oauth-cancel', { chatId, flowId });

export const mcpAppOpen = (chatId: string, toolCallId: string) =>
  action('mcp/app-open', { chatId, toolCallId });
export const mcpAppResource = (chatId: string, appSessionId: string) =>
  action('mcp/app-resource', { chatId, appSessionId });
export const mcpAppCall = (chatId: string, appSessionId: string, payload: Record<string, unknown>) =>
  action('mcp/app-call', { chatId, appSessionId, payload });

/** §8.5 会话切换：在当前对话（其 ACP 进程）内 load 目标历史会话——
 *  不新建对话/进程（会话是进程内实体；点击 SessionList 历史会话即切换）。 */
export const loadChat = (chatId: string, acpSessionId: string) =>
  action('chat/load', { chatId, acpSessionId });

/** 发送消息（两阶段 ack：accepted → committed）。effort 为可选推理强度
 *  （low|medium|high），非空才写入 payload（跨任务契约 §2）。 */
export const prompt = (chatId: string, message: string, effort?: string) => {
  const payload: Record<string, unknown> = { chatId, message };
  if (effort) payload.effort = effort;
  return action('chat/prompt', payload);
};

/** Change one Agent-advertised ACP session config option. */
export const configSet = (chatId: string, configId: string, value: string) =>
  action('chat/config-set', { chatId, configId, value });

/** Peri-only rewind is deliberately a three-step, preview-bound flow. */
export const rewindCandidates = (chatId: string) =>
  action('chat/rewind-candidates', { chatId });

export const rewindPreview = (chatId: string, targetMessageId: string) =>
  action('chat/rewind-preview', { chatId, targetMessageId });

export const rewind = (chatId: string, targetMessageId: string, previewFingerprint: string) =>
  action('chat/rewind', { chatId, targetMessageId, previewFingerprint, revertFiles: true });

/** 取消当前 turn。 */
export const cancel = (chatId: string) => action('chat/cancel', { chatId });

/** 当前对话内新建 ACP 会话（§8.5 会话是进程内实体，不新建对话/进程）。
 *  committed ack 后前端应刷新会话列表（tooltip「当前」标记更新）。 */
export const sessionNew = (chatId: string) => action('chat/session-new', { chatId });

/** 关闭对话。 */
export const close = (chatId: string) => action('chat/close', { chatId });

/** 权限裁决：官方请求回显 Control Doc 投影的精确 ACP optionId。 */
export const resolvePermission = (chatId: string, permissionId: string, decision: string, optionId?: string) =>
  action('permission/resolve', { chatId, permissionId, decision, ...(optionId ? { optionId } : {}) });

export type ElicitationAnswer = string | string[];
export const respondElicitation = (
  chatId: string,
  elicitationId: string,
  responseAction: 'accept' | 'decline' | 'cancel',
  answers: Record<string, ElicitationAnswer> = {},
) => action('elicitation/respond', { chatId, elicitationId, action: responseAction, answers });

// ── 下行解析 ────────────────────────────────────────────────────────────

/** Parse one downstream envelope without trusting JSON shape.
 *
 * Unknown string tags remain valid so newer server frames can be ignored by an
 * older browser. JSON primitives, arrays and missing/empty tags are malformed:
 * letting `null` through would make ws-client's `frame.t` access throw inside
 * the browser message callback and silently stop processing that delivery. */
export type DownstreamFrame =
  | { t: 'keep_alive' }
  | { t: 'ready'; projectionVersions: Record<string, number>; negotiatedCapabilities?: string[]; maxPromptBytes?: number }
  | { t: 'ysync.update'; doc: string; update: string; projectionVersion?: number }
  | { t: 'action_ack'; commandId: string; status: 'accepted' | 'committed' | 'duplicate'; turnId?: string; chatId?: string; projectId?: string; sessionId?: string; acpSessionId?: string; committedProjectionVersion?: number; resourceResult?: import('@/shared/protocol/resource-fs-mutation').FsMutationAck['resourceResult'] }
  | { t: 'action_error'; commandId: string; code: string; message: string; retryable: boolean; retryAfterMs?: number }
  | { t: 'prompt_status'; commandId: string; sessionId: string; runtimeRestored: false; truncated: boolean; evidenceIncomplete: boolean; prompts: PromptStatusItem[] }
  | ({ t: 'rewind_candidates' } & RewindCandidatesFrame)
  | ({ t: 'rewind_preview' } & RewindPreviewFrame)
  | ({ t: 'mcp_servers' } & McpServersFrame)
  | ({ t: 'mcp_oauth' } & McpOAuthFrame)
  | ({ t: 'mcp_oauth_authorization' } & McpOAuthAuthorizationFrame)
  | ({ t: 'mcp_app_session' } & McpAppSessionFrame)
  | ({ t: 'mcp_app_resource' } & McpAppResourceFrame)
  | ({ t: 'mcp_app_call_result' } & McpAppCallResultFrame)
  | TerminalOpenedFrame
  | TerminalOutputFrame
  | TerminalExitFrame
  | TerminalErrorFrame
  | { t: 'auth_error'; [key: string]: unknown }
  | ResourceResultFrame
  | { t: string; [key: string]: unknown };

/**
 * Unknown tags remain forward-compatible. Known browser-consumed tags are
 * decoded strictly so malformed terminal identities cannot enter state machines.
 */
export const parse = (text: string): DownstreamFrame | null => {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const frame = value as Record<string, unknown>;
    if (typeof frame.t !== 'string' || !frame.t.trim()) return null;
    return decodeKnownFrame(frame);
  } catch {
    return null;
  }
};

function decodeKnownFrame(frame: Record<string, unknown>): DownstreamFrame | null {
  switch (frame.t) {
    case 'keep_alive':
      return { t: 'keep_alive' };
    case 'ready': {
      if (!isProjectionVersions(frame.projectionVersions)) return null;
      if (frame.negotiatedCapabilities !== undefined
        && (!Array.isArray(frame.negotiatedCapabilities)
          || !frame.negotiatedCapabilities.every(nonEmptyString))) return null;
      if (frame.maxPromptBytes !== undefined
        && (!Number.isSafeInteger(frame.maxPromptBytes) || Number(frame.maxPromptBytes) <= 0)) return null;
      return frame as DownstreamFrame;
    }
    case 'ysync.update':
      if (!isDocId(frame.doc) || !isBase64(frame.update)) return null;
      if (frame.projectionVersion !== undefined && !nonNegativeInteger(frame.projectionVersion)) return null;
      return frame as DownstreamFrame;
    case 'action_ack':
      if (!nonEmptyString(frame.commandId) || !['accepted', 'committed', 'duplicate'].includes(String(frame.status))) return null;
      if (!optionalNullishStrings(frame, ['turnId', 'chatId', 'projectId', 'sessionId', 'acpSessionId'])) return null;
      if (frame.committedProjectionVersion != null && !nonNegativeInteger(frame.committedProjectionVersion)) return null;
      if (frame.resourceResult !== undefined && !isActionResourceResult(frame.resourceResult)) return null;
      return omitNullish(frame, ['turnId', 'chatId', 'projectId', 'sessionId', 'acpSessionId', 'committedProjectionVersion']) as DownstreamFrame;
    case 'action_error':
      if (!nonEmptyString(frame.commandId) || !nonEmptyString(frame.code) || typeof frame.message !== 'string' || typeof frame.retryable !== 'boolean') return null;
      if (frame.retryAfterMs != null && !nonNegativeInteger(frame.retryAfterMs)) return null;
      return omitNullish(frame, ['retryAfterMs']) as DownstreamFrame;
    case 'prompt_status':
      if (!nonEmptyString(frame.commandId) || !nonEmptyString(frame.sessionId)) return null;
      if (['message', 'text', 'prompt', 'recovery'].some((key) => key in frame)) return null;
      if (frame.runtimeRestored !== false || typeof frame.truncated !== 'boolean' || typeof frame.evidenceIncomplete !== 'boolean' || !Array.isArray(frame.prompts)) return null;
      if (!frame.prompts.every(isPromptStatusItem)) return null;
      return {
        ...frame,
        prompts: frame.prompts.map((item) => omitNullish(item as unknown as Record<string, unknown>, ['turnId', 'errorCode'])),
      } as unknown as DownstreamFrame;
    case 'rewind_candidates':
      return isRewindCandidatesFrame(frame) ? frame as unknown as DownstreamFrame : null;
    case 'rewind_preview':
      return isRewindPreviewFrame(frame) ? frame as unknown as DownstreamFrame : null;
    case 'mcp_servers':
      return isMcpServersFrame(frame) ? frame as DownstreamFrame : null;
    case 'mcp_oauth':
      return isMcpOAuthFrame(frame) ? frame as DownstreamFrame : null;
    case 'mcp_oauth_authorization':
      return isMcpOAuthAuthorizationFrame(frame) ? frame as DownstreamFrame : null;
    case 'mcp_app_session':
      return isMcpAppSessionFrame(frame) ? frame as DownstreamFrame : null;
    case 'mcp_app_resource':
      if (isMcpAppResourceFrame(frame)) return frame as DownstreamFrame;
      console.warn('[mcp-apps] dropped mcp_app_resource', mcpAppResourceDropReason(frame));
      return null;
    case 'mcp_app_call_result':
      return isMcpAppCallResultFrame(frame) ? frame as DownstreamFrame : null;
    case 'terminal_opened':
    case 'terminal_output':
    case 'terminal_exit':
    case 'terminal_error':
      return decodeTerminalFrame(frame) as DownstreamFrame | null;
    case 'auth_error':
      return frame as DownstreamFrame;
    case 'resource_result':
      return isDeleteConfirmResultFrame(frame) || isResourceResult(frame) ? frame as DownstreamFrame : null;
    default:
      return frame as DownstreamFrame;
  }
}

export interface PromptStatusItem {
  commandId: string;
  turnId?: string;
  status: 'projected' | 'completed' | 'failed' | 'delivery_unknown';
  createdAt: string;
  updatedAt: string;
  errorCode?: string;
}

export interface RewindCandidate { messageId: string; preview: string }
export interface RewindCandidatesFrame {
  commandId: string;
  chatId: string;
  candidates: RewindCandidate[];
}
export interface RewindFileChange { path: string; kind: 'write' | 'edit' }
export interface RewindPreviewFrame {
  commandId: string;
  chatId: string;
  targetMessageId: string;
  previewFingerprint: string;
  fileChanges: RewindFileChange[];
}

function isRewindCandidatesFrame(frame: Record<string, unknown>): boolean {
  if (!nonEmptyString(frame.commandId) || !nonEmptyString(frame.chatId)
    || !Array.isArray(frame.candidates) || frame.candidates.length > 64) return false;
  return frame.candidates.every((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    return nonEmptyString(candidate.messageId) && candidate.messageId.length <= 128
      && typeof candidate.preview === 'string' && candidate.preview.length <= 1024;
  });
}

function isRewindPreviewFrame(frame: Record<string, unknown>): boolean {
  if (!nonEmptyString(frame.commandId) || !nonEmptyString(frame.chatId)
    || !nonEmptyString(frame.targetMessageId) || frame.targetMessageId.length > 128
    || typeof frame.previewFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(frame.previewFingerprint)
    || !Array.isArray(frame.fileChanges) || frame.fileChanges.length > 64) return false;
  return frame.fileChanges.every((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const change = value as Record<string, unknown>;
    return nonEmptyString(change.path) && change.path.length <= 1024
      && !change.path.startsWith('/') && !change.path.split('/').includes('..')
      && !/[\u0000-\u001f\u007f]/.test(change.path)
      && ['write', 'edit'].includes(String(change.kind));
  });
}

export type McpConnectionStatus = 'connected' | 'failed' | 'disconnected' | 'disabled' | 'uninitialized';
export type McpOAuthStatus = 'none' | 'authorized' | 'needs_authorization';
export interface McpServerInfo {
  name: string;
  transport: string;
  connectionStatus: McpConnectionStatus;
  oauthStatus: McpOAuthStatus;
  activeFlowId?: string;
  toolsCount: number;
  resourcesCount: number;
}
export interface McpServersFrame { commandId: string; chatId: string; servers: McpServerInfo[] }
export interface McpOAuthFrame {
  chatId: string;
  flowId: string;
  serverName: string;
  status: 'authorization_needed' | 'completed' | 'failed' | 'cancelled' | 'restored' | 'expired';
  failureClass?: 'callback_unavailable' | 'callback_timeout' | 'provider_rejected' | 'connection_failed' | 'internal';
  updatedAt: string;
}
export interface McpOAuthAuthorizationFrame {
  commandId: string;
  chatId: string;
  flowId: string;
  authorizationUrl: string;
  expiresAt: string;
}

export interface McpAppSessionFrame {
  commandId: string;
  chatId: string;
  toolCallId: string;
  appSessionId: string;
  serverId: string;
  resourceUri: string;
}

export interface McpAppResourceFrame {
  commandId: string;
  chatId: string;
  appSessionId: string;
  html: string;
  mimeType: string;
  csp?: string;
  /** 首屏 CallToolResult；嵌套 structuredContent，不得作为帧顶层键。 */
  toolResult?: unknown;
}

export interface McpAppCallResultFrame {
  commandId: string;
  chatId: string;
  appSessionId: string;
  result: unknown;
}

const forbiddenAppsKeys = ['invocationToken', 'ownerSessionId', 'structuredContent'];
const forbiddenOAuthKeys = ['callbackCode', 'code', 'state', 'rawError', 'headers', 'token'];
function hasForbiddenOAuthKeys(value: Record<string, unknown>): boolean {
  return forbiddenOAuthKeys.some((key) => key in value);
}

function isMcpServersFrame(frame: Record<string, unknown>): boolean {
  if (!nonEmptyString(frame.commandId) || !nonEmptyString(frame.chatId) || !Array.isArray(frame.servers) || frame.servers.length > 256 || hasForbiddenOAuthKeys(frame)) return false;
  return frame.servers.every((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const server = value as Record<string, unknown>;
    return !hasForbiddenOAuthKeys(server)
      && nonEmptyString(server.name) && server.name.length <= 128
      && nonEmptyString(server.transport) && server.transport.length <= 128
      && ['connected', 'failed', 'disconnected', 'disabled', 'uninitialized'].includes(String(server.connectionStatus))
      && ['none', 'authorized', 'needs_authorization'].includes(String(server.oauthStatus))
      && (server.activeFlowId == null || nonEmptyString(server.activeFlowId))
      && nonNegativeInteger(server.toolsCount) && nonNegativeInteger(server.resourcesCount);
  });
}

function isMcpOAuthFrame(frame: Record<string, unknown>): boolean {
  return !hasForbiddenOAuthKeys(frame) && !('authorizationUrl' in frame)
    && nonEmptyString(frame.chatId) && nonEmptyString(frame.flowId) && nonEmptyString(frame.serverName)
    && ['authorization_needed', 'completed', 'failed', 'cancelled', 'restored', 'expired'].includes(String(frame.status))
    && (frame.failureClass == null || ['callback_unavailable', 'callback_timeout', 'provider_rejected', 'connection_failed', 'internal'].includes(String(frame.failureClass)))
    && nonEmptyString(frame.updatedAt);
}

function isMcpOAuthAuthorizationFrame(frame: Record<string, unknown>): boolean {
  if (hasForbiddenOAuthKeys(frame) || !nonEmptyString(frame.commandId) || !nonEmptyString(frame.chatId)
    || !nonEmptyString(frame.flowId) || !nonEmptyString(frame.authorizationUrl)
    || !nonEmptyString(frame.expiresAt)) return false;
  try {
    const url = new URL(frame.authorizationUrl);
    const loopback = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return (url.protocol === 'https:' || loopback) && !url.username && !url.password && !url.hash;
  } catch { return false; }
}

function hasForbiddenAppsKeys(frame: Record<string, unknown>): boolean {
  return forbiddenAppsKeys.some((key) => key in frame);
}

function isMcpAppSessionFrame(frame: Record<string, unknown>): boolean {
  return !hasForbiddenAppsKeys(frame)
    && nonEmptyString(frame.commandId)
    && nonEmptyString(frame.chatId)
    && nonEmptyString(frame.toolCallId)
    && nonEmptyString(frame.appSessionId)
    && nonEmptyString(frame.serverId)
    && nonEmptyString(frame.resourceUri)
    && frame.resourceUri.startsWith('ui://');
}

function isMcpAppResourceFrame(frame: Record<string, unknown>): boolean {
  return mcpAppResourceDropReason(frame) == null;
}

function mcpAppResourceDropReason(frame: Record<string, unknown>): Record<string, unknown> | null {
  if (hasForbiddenAppsKeys(frame)) {
    return { reason: 'forbidden_top_level_key', keys: Object.keys(frame).filter((key) => forbiddenAppsKeys.includes(key)) };
  }
  if (!nonEmptyString(frame.commandId)) return { reason: 'commandId' };
  if (!nonEmptyString(frame.chatId)) return { reason: 'chatId' };
  if (!nonEmptyString(frame.appSessionId)) return { reason: 'appSessionId' };
  if (typeof frame.html !== 'string') return { reason: 'html_type' };
  if (frame.html.length > 1024 * 1024) return { reason: 'html_too_large', htmlChars: frame.html.length };
  if (!nonEmptyString(frame.mimeType) || frame.mimeType !== 'text/html;profile=mcp-app') {
    return { reason: 'mimeType', mimeType: frame.mimeType ?? null };
  }
  if (frame.csp != null && typeof frame.csp !== 'string') return { reason: 'csp_type' };
  if (frame.toolResult == null) return null;
  if (!isBoundedJsonObject(frame.toolResult)) {
    let jsonChars = -1;
    try {
      jsonChars = JSON.stringify(frame.toolResult).length;
    } catch {
      jsonChars = -1;
    }
    return {
      reason: 'toolResult_unbounded',
      jsonChars,
      kind: frame.toolResult && typeof frame.toolResult === 'object' ? (Array.isArray(frame.toolResult) ? 'array' : 'object') : typeof frame.toolResult,
    };
  }
  return null;
}

function isBoundedJsonObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    return JSON.stringify(value).length <= 1024 * 1024;
  } catch {
    return false;
  }
}

function isMcpAppCallResultFrame(frame: Record<string, unknown>): boolean {
  return !hasForbiddenAppsKeys(frame)
    && nonEmptyString(frame.commandId)
    && nonEmptyString(frame.chatId)
    && nonEmptyString(frame.appSessionId)
    && 'result' in frame;
}

function isPromptStatusItem(value: unknown): value is PromptStatusItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (['message', 'text', 'prompt', 'recovery'].some((key) => key in item)) return false;
  return nonEmptyString(item.commandId)
    && optionalNullishStrings(item, ['turnId', 'errorCode'])
    && ['projected', 'completed', 'failed', 'delivery_unknown'].includes(String(item.status))
    && nonEmptyString(item.createdAt)
    && nonEmptyString(item.updatedAt);
}

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const nonNegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

function optionalNullishStrings(frame: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => frame[key] == null || nonEmptyString(frame[key]));
}

/** Older bundled servers serialized absent Rust `Option` fields as `null`.
 * Validate that compatibility shape, then remove it before the frame reaches
 * browser state machines so the public TypeScript contract stays optional,
 * not `string | null`. */
function omitNullish(frame: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const normalized = { ...frame };
  for (const key of keys) {
    if (normalized[key] == null) delete normalized[key];
  }
  return normalized;
}

function isProjectionVersions(value: unknown): value is Record<string, number> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([key, item]) => isDocId(key) && nonNegativeInteger(item));
}

const isDocId = isServerDocId;

function isBase64(value: unknown): value is string {
  if (typeof value !== 'string' || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  try { atob(value); return true; } catch { return false; }
}

// ── base64 ↔ Uint8Array（浏览器内置 atob/btoa）──────────────────────────

/** base64 → Uint8Array：yrs v1 update 载荷（快照/增量同格式）。 */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

/** Uint8Array → base64（当前仅调试输出用）。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

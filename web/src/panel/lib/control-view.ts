import * as Y from 'yjs';
import { asArray, asMap, getNum, getStr } from './yjs-values';

export interface ChatHeadInfo {
  chatId: string;
  title: string | null;
  status: string | null;
  activeTurnId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
export interface AgentInfo {
  instanceId: string | null;
  sessionId: string | null;
  status: string | null;
  lastActivityAt: string | null;
  availableCommands: string[];
  commandCatalog: AgentCommandInfo[];
  extensions: string[];
  activities: AgentActivityInfo[];
  /** Full-replacement ACP plan; omitted by older fixtures/readers. */
  plan?: AgentPlanEntryInfo[];
  inputPrediction: AgentInputPredictionInfo | null;
  latestUsage: {
    inputTokens: number | null;
    outputTokens: number | null;
    cacheCreationTokens: number | null;
    cacheReadTokens: number | null;
    requestId: string | null;
    model: string | null;
    stopReason: string | null;
  } | null;
  model: string | null;
  effort: string | null;
  /** Additive Agent-authoritative ACP catalog; absent in older fixtures. */
  configOptions?: SessionConfigOptionInfo[];
  contextWindow: number | null;
  contextUsed: number | null;
}
export interface AgentPlanEntryInfo {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string | null;
}
export interface SessionConfigChoiceInfo {
  value: string;
  name: string;
  description: string | null;
}
export interface SessionConfigOptionInfo {
  id: string;
  name: string;
  description: string | null;
  category: 'mode' | 'model' | 'model_config' | 'thought_level' | null;
  currentValue: string;
  options: SessionConfigChoiceInfo[];
}
export interface AgentInputPredictionInfo {
  id: string;
  text: string;
  createdAt: string | null;
}
export type AgentActivityKind = 'subagent' | 'background_task' | 'compact' | 'context' | 'llm_retry' | 'workflow' | 'rewind' | 'diagnostics' | 'turn' | 'agent' | 'system' | 'oauth';
export type AgentActivityStatus = 'running' | 'completed' | 'failed' | 'warning' | 'suspended' | 'cancelled' | 'info';
export interface AgentActivityInfo {
  id: string;
  kind: AgentActivityKind;
  status: AgentActivityStatus;
  label: string | null;
  isBackground: boolean | null;
  metrics: Record<string, number>;
  attributes: Record<string, string>;
  createdAt: string | null;
  updatedAt: string | null;
}
export interface AgentCommandInfo {
  name: string;
  description: string;
  kind: 'command' | 'skill' | 'mcp_skill';
}
export interface ActiveTurnInfo { turnId: string | null; turnStatus: string | null; updatedAt: string | null }
export interface PendingPermission {
  permissionId: string | null;
  turnId: string | null;
  toolCallId: string | null;
  title: string | null;
  description: string | null;
  status: string | null;
  expiresAt: string | null;
  decision: string | null;
}
export type ElicitationFieldKind = 'text' | 'single_select' | 'multi_select';
export interface ElicitationOption {
  value: string;
  label: string;
  description: string | null;
}
export interface ElicitationField {
  id: string;
  title: string;
  description: string | null;
  kind: ElicitationFieldKind;
  required: boolean;
  options: ElicitationOption[];
}
export interface PendingElicitation {
  elicitationId: string;
  message: string;
  status: 'pending' | 'responding';
  responseAction: 'accept' | 'decline' | 'cancel' | null;
  fields: ElicitationField[];
  createdAt: string | null;
}
export interface ControlView {
  chat: ChatHeadInfo | null;
  agent: AgentInfo | null;
  activeTurn: ActiveTurnInfo | null;
  pendingPermissions: PendingPermission[];
  /** Additive Registry v2 surface; omitted by older fixtures/doc readers. */
  pendingElicitations?: PendingElicitation[];
}

/** Read-only browser projection of one session:{id} control document. */
export function renderControl(doc: Y.Doc): ControlView {
  const root = doc.getMap<unknown>('root');
  const pendingElicitations: PendingElicitation[] = [];
  const result: ControlView = { chat: null, agent: null, activeTurn: null, pendingPermissions: [], pendingElicitations };
  const session = asMap(root.get('session'));
  if (session) {
    result.chat = {
      chatId: getStr(session, 'session_id') || '',
      title: getStr(session, 'title'),
      status: getStr(session, 'status'),
      activeTurnId: getStr(session, 'active_turn_id'),
      createdAt: getStr(session, 'created_at'),
      updatedAt: getStr(session, 'updated_at'),
    };
    const turnId = getStr(session, 'active_turn_id');
    const turnStatus = getStr(session, 'active_turn_status');
    if (turnId || turnStatus) result.activeTurn = {
      turnId,
      turnStatus,
      updatedAt: getStr(session, 'active_turn_updated_at'),
    };
  }

  const agent = asMap(root.get('agent'));
  if (agent) {
    const latestUsage = asMap(agent.get('latest_usage'));
    const extensions = (asArray(agent.get('extensions'))?.toArray() ?? [])
      .filter((value): value is string => typeof value === 'string');
    const availableCommands = (asArray(agent.get('available_commands'))?.toArray()
      ?? asArray(agent.get('capabilities'))?.toArray()
      ?? []).filter((value): value is string => typeof value === 'string');
    const configOptions = readSessionConfigOptions(agent);
    const catalog = asMap(agent.get('command_catalog'));
    const commandCatalog: AgentCommandInfo[] = availableCommands.map((name) => {
      const entry = catalog ? asMap(catalog.get(name)) : null;
      const projectedKind = getStr(entry, 'kind');
      const kind: AgentCommandInfo['kind'] = projectedKind === 'mcp_skill'
        ? 'mcp_skill'
        : projectedKind === 'skill' && extensions.includes('peri.skillNames')
          ? 'skill'
          : 'command';
      return {
        name,
        description: getStr(entry, 'description') ?? '',
        kind,
      };
    });
    const activities: AgentActivityInfo[] = [];
    if (extensions.includes('peri.agentActivity')) {
      const activityMap = asMap(agent.get('activities'));
      const order = (asArray(agent.get('activity_order'))?.toArray() ?? [])
        .filter((value): value is string => typeof value === 'string');
      const seen = new Set<string>();
      for (const id of order.slice(-64)) {
        if (seen.has(id)) continue;
        seen.add(id);
        const item = activityMap ? asMap(activityMap.get(id)) : null;
        const kind = getStr(item, 'kind');
        const status = getStr(item, 'status');
        if (!item || !isAgentActivityKind(kind) || !isAgentActivityStatus(status)) continue;
        const metrics = Object.fromEntries(
          [...(asMap(item.get('metrics'))?.entries() ?? [])]
            .map(([key, value]) => [key, Number(value)] as const)
            .filter(([, value]) => Number.isFinite(value) && value >= 0),
        );
        const attributes = Object.fromEntries(
          [...(asMap(item.get('attributes'))?.entries() ?? [])]
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        );
        activities.push({
          id,
          kind,
          status,
          label: getStr(item, 'label'),
          isBackground: typeof item.get('is_background') === 'boolean' ? item.get('is_background') as boolean : null,
          metrics,
          attributes,
          createdAt: getStr(item, 'created_at'),
          updatedAt: getStr(item, 'updated_at'),
        });
      }
    }
    let inputPrediction: AgentInputPredictionInfo | null = null;
    if (extensions.includes('peri.prediction')) {
      const projected = asMap(agent.get('input_prediction'));
      const id = getStr(projected, 'id');
      const text = getStr(projected, 'text');
      if (id && text && [...text].length <= 200) {
        inputPrediction = { id, text, createdAt: getStr(projected, 'created_at') };
      }
    }
    const plan: AgentPlanEntryInfo[] = [];
    const planMap = asMap(agent.get('plan_entries'));
    const planOrder = (asArray(agent.get('plan_order'))?.toArray() ?? [])
      .filter((value): value is string => typeof value === 'string');
    for (const id of planOrder.slice(0, 64)) {
      const entry = planMap ? asMap(planMap.get(id)) : null;
      const content = getStr(entry, 'content');
      const status = getStr(entry, 'status');
      if (!content || !['pending', 'in_progress', 'completed'].includes(status ?? '')) continue;
      plan.push({
        id,
        content,
        status: status as AgentPlanEntryInfo['status'],
        activeForm: extensions.includes('peri.planEntryActiveForm')
          ? getStr(entry, 'active_form')
          : null,
      });
    }
    result.agent = {
    instanceId: getStr(agent, 'instance_id'),
    sessionId: getStr(agent, 'acp_session_id') ?? getStr(agent, 'session_id'),
    status: getStr(agent, 'status'),
    lastActivityAt: getStr(agent, 'last_activity_at'),
    availableCommands,
    commandCatalog,
    extensions,
    activities,
    plan,
    inputPrediction,
    latestUsage: latestUsage ? {
      inputTokens: getNum(latestUsage, 'input_tokens'),
      outputTokens: getNum(latestUsage, 'output_tokens'),
      cacheCreationTokens: getNum(latestUsage, 'cache_creation_tokens'),
      cacheReadTokens: getNum(latestUsage, 'cache_read_tokens'),
      requestId: getStr(latestUsage, 'request_id'),
      model: getStr(latestUsage, 'model'),
      stopReason: getStr(latestUsage, 'stop_reason'),
    } : null,
    model: getStr(agent, 'model'),
    effort: getStr(agent, 'effort'),
    configOptions,
    contextWindow: getNum(agent, 'context_window'),
    contextUsed: getNum(agent, 'context_used'),
    };
  }

  asMap(root.get('pending_permissions'))?.forEach((value) => {
    const permission = asMap(value);
    if (!permission || getStr(permission, 'status') !== 'pending') return;
    result.pendingPermissions.push({
      permissionId: getStr(permission, 'permission_id'),
      turnId: getStr(permission, 'turn_id'),
      toolCallId: getStr(permission, 'tool_call_id'),
      title: getStr(permission, 'title'),
      description: getStr(permission, 'description'),
      status: getStr(permission, 'status'),
      expiresAt: getStr(permission, 'expires_at'),
      decision: getStr(permission, 'decision'),
    });
  });
  result.pendingPermissions.sort((left, right) => {
    const leftExpiry = Date.parse(left.expiresAt || '');
    const rightExpiry = Date.parse(right.expiresAt || '');
    const expiryOrder = (Number.isFinite(leftExpiry) ? leftExpiry : Number.POSITIVE_INFINITY)
      - (Number.isFinite(rightExpiry) ? rightExpiry : Number.POSITIVE_INFINITY);
    if (expiryOrder) return expiryOrder;
    return (left.permissionId || '').localeCompare(right.permissionId || '');
  });
  asMap(root.get('pending_elicitations'))?.forEach((value) => {
    const item = asMap(value);
    const elicitationId = getStr(item, 'elicitation_id');
    const message = getStr(item, 'message');
    const status = getStr(item, 'status');
    if (!item || !elicitationId || !message || !['pending', 'responding'].includes(status || '')) return;
    const fieldsMap = asMap(item.get('fields'));
    const fieldOrder = (asArray(item.get('field_order'))?.toArray() ?? [])
      .filter((id): id is string => typeof id === 'string')
      .slice(0, 4);
    const fields: ElicitationField[] = [];
    for (const id of fieldOrder) {
      const field = fieldsMap ? asMap(fieldsMap.get(id)) : null;
      const title = getStr(field, 'title');
      const kind = getStr(field, 'kind');
      if (!field || !title || !isElicitationFieldKind(kind)) continue;
      const optionsMap = asMap(field.get('options'));
      const optionOrder = (asArray(field.get('option_order'))?.toArray() ?? [])
        .filter((option): option is string => typeof option === 'string')
        .slice(0, 16);
      const options = optionOrder.flatMap((optionId) => {
        const option = optionsMap ? asMap(optionsMap.get(optionId)) : null;
        const optionValue = getStr(option, 'value');
        const label = getStr(option, 'label');
        return option && optionValue && label ? [{
          value: optionValue,
          label,
          description: getStr(option, 'description'),
        }] : [];
      });
      if (kind !== 'text' && options.length === 0) continue;
      fields.push({
        id,
        title,
        description: getStr(field, 'description'),
        kind,
        required: field.get('required') === true,
        options,
      });
    }
    if (fields.length === 0) return;
    const responseAction = getStr(item, 'response_action');
    pendingElicitations.push({
      elicitationId,
      message,
      status: status as PendingElicitation['status'],
      responseAction: ['accept', 'decline', 'cancel'].includes(responseAction || '')
        ? responseAction as PendingElicitation['responseAction']
        : null,
      fields,
      createdAt: getStr(item, 'created_at'),
    });
  });
  pendingElicitations.sort((left, right) => (left.createdAt || '').localeCompare(right.createdAt || ''));
  return result;
}

function readSessionConfigOptions(agent: Y.Map<unknown>): SessionConfigOptionInfo[] {
  const catalog = asMap(agent.get('config_options'));
  const order = (asArray(agent.get('config_option_order'))?.toArray() ?? [])
    .filter((value): value is string => typeof value === 'string')
    .slice(0, 16);
  const seen = new Set<string>();
  const result: SessionConfigOptionInfo[] = [];
  for (const id of order) {
    if (seen.has(id) || id.length > 128) continue;
    seen.add(id);
    const item = catalog ? asMap(catalog.get(id)) : null;
    const name = getStr(item, 'name');
    const currentValue = getStr(item, 'current_value');
    if (!item || !name || !currentValue || name.length > 256 || currentValue.length > 128) continue;
    const choices = asMap(item.get('options'));
    const choiceOrder = (asArray(item.get('option_order'))?.toArray() ?? [])
      .filter((value): value is string => typeof value === 'string')
      .slice(0, 64);
    const optionSeen = new Set<string>();
    const options: SessionConfigChoiceInfo[] = [];
    for (const value of choiceOrder) {
      if (optionSeen.has(value) || value.length > 128) continue;
      optionSeen.add(value);
      const choice = choices ? asMap(choices.get(value)) : null;
      const choiceName = getStr(choice, 'name');
      if (!choice || !choiceName || choiceName.length > 256) continue;
      options.push({
        value,
        name: choiceName,
        description: getStr(choice, 'description'),
      });
    }
    if (!options.some((choice) => choice.value === currentValue)) continue;
    const projectedCategory = getStr(item, 'category');
    const category = ['mode', 'model', 'model_config', 'thought_level'].includes(projectedCategory ?? '')
      ? projectedCategory as SessionConfigOptionInfo['category']
      : null;
    result.push({
      id,
      name,
      description: getStr(item, 'description'),
      category,
      currentValue,
      options,
    });
  }
  return result;
}

const ACTIVITY_KINDS = new Set<AgentActivityKind>(['subagent', 'background_task', 'compact', 'context', 'llm_retry', 'workflow', 'rewind', 'diagnostics', 'turn', 'agent', 'system', 'oauth']);
const ACTIVITY_STATUSES = new Set<AgentActivityStatus>(['running', 'completed', 'failed', 'warning', 'suspended', 'cancelled', 'info']);

function isAgentActivityKind(value: string | null): value is AgentActivityKind {
  return !!value && ACTIVITY_KINDS.has(value as AgentActivityKind);
}

function isAgentActivityStatus(value: string | null): value is AgentActivityStatus {
  return !!value && ACTIVITY_STATUSES.has(value as AgentActivityStatus);
}

function isElicitationFieldKind(value: string | null): value is ElicitationFieldKind {
  return value === 'text' || value === 'single_select' || value === 'multi_select';
}

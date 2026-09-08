import * as Y from 'yjs';
import { parseStrictRfc3339 } from '@/shared/lib/rfc3339';
import { asArray, asMap, getNum, getStr } from '@/shared/yjs/yjs-values';
import { readPeriTasks, type PeriTaskInfo } from './peri-task-view';

export type { PeriTaskInfo, PeriTaskKind, PeriTaskStatus, PeriTaskSubtype } from './peri-task-view';

export interface ChatHeadInfo {
  chatId: string;
  title: string | null;
  status: string | null;
  activeTurnId: string | null;
  loading?: boolean;
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
  queueKey: string;
  permissionId: string | null;
  turnId: string | null;
  toolCallId: string | null;
  toolInputSummary?: string | null;
  title: string | null;
  description: string | null;
  options: Array<'allowOnce' | 'allowSession' | 'deny'>;
  optionIds?: Partial<Record<'allowOnce' | 'allowSession' | 'deny', string>>;
  status: string | null;
  expiresAt?: string | null;
  decision: string | null;
}

export function parsePermissionExpiration(value: string | null | undefined): number | null {
  if (value === undefined) return null;
  if (value === null) return Number.NaN;
  return parseStrictRfc3339(value) ?? Number.NaN;
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
export interface QuestionOption {
  label: string;
  description: string | null;
}
export interface PendingQuestionItem {
  question: string;
  header: string | null;
  options: QuestionOption[];
  multiSelect: boolean;
}
/** AskUserQuestion 投影；与 ACP form elicitation 分列，不共用 schema。 */
export interface PendingQuestion {
  questionId: string;
  status: 'pending' | 'responding';
  description: string | null;
  expiresAt: string | null;
  questions: PendingQuestionItem[];
}
export interface ControlView {
  chat: ChatHeadInfo | null;
  agent: AgentInfo | null;
  activeTurn: ActiveTurnInfo | null;
  pendingPermissions: PendingPermission[];
  /** Additive Registry v2 surface; omitted by older fixtures/doc readers. */
  pendingElicitations?: PendingElicitation[];
  /** Session Doc `pending_questions`；与 elicitation 独立。 */
  pendingQuestions?: PendingQuestion[];
  /** Session Doc `tasks` / `task_order`；旧快照缺省为空。 */
  tasks?: PeriTaskInfo[];
}

/** Read-only browser projection of one session:{id} control document. */
export function renderControl(doc: Y.Doc): ControlView {
  const root = doc.getMap<unknown>('root');
  const pendingElicitations: PendingElicitation[] = [];
  const pendingQuestions: PendingQuestion[] = [];
  const result: ControlView = {
    chat: null,
    agent: null,
    activeTurn: null,
    pendingPermissions: [],
    pendingElicitations,
    pendingQuestions,
    tasks: readPeriTasks(root),
  };
  const session = asMap(root.get('session'));
  if (session) {
    result.chat = {
      chatId: getStr(session, 'session_id') || '',
      title: getStr(session, 'title'),
      status: getStr(session, 'status'),
      activeTurnId: getStr(session, 'active_turn_id'),
      loading: session.get('loading') === true,
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

  asMap(root.get('pending_permissions'))?.forEach((value, queueKey) => {
    const permission = asMap(value);
    if (!permission || getStr(permission, 'status') !== 'pending') return;
    const options = (asArray(permission.get('options'))?.toArray() ?? [])
      .filter((option): option is 'allowOnce' | 'allowSession' | 'deny' =>
        option === 'allowOnce' || option === 'allowSession' || option === 'deny');
    const optionIdsMap = asMap(permission.get('option_ids'));
    const optionIds = optionIdsMap ? Object.fromEntries(['allowOnce', 'allowSession', 'deny'].flatMap((kind) => {
      const optionId = getStr(optionIdsMap, kind);
      return optionId ? [[kind, optionId]] : [];
    })) as PendingPermission['optionIds'] : undefined;
    const rawExpiresAt = permission.get('expires_at');
    const toolCallId = getStr(permission, 'tool_call_id');
    const evidenceToolCallId = getStr(permission, 'evidence_tool_call_id');
    const rawToolInputSummary = getStr(permission, 'tool_input_summary');
    const toolInputSummary = evidenceToolCallId === toolCallId
      && rawToolInputSummary !== null
      && rawToolInputSummary.length > 0
      && rawToolInputSummary.length <= 512
      && !/[\u0000-\u001f\u007f]/.test(rawToolInputSummary)
      ? rawToolInputSummary
      : null;
    result.pendingPermissions.push({
      queueKey,
      permissionId: getStr(permission, 'permission_id'),
      turnId: getStr(permission, 'turn_id'),
      toolCallId,
      toolInputSummary,
      title: getStr(permission, 'title'),
      description: getStr(permission, 'description'),
      options,
      optionIds,
      status: getStr(permission, 'status'),
      expiresAt: !permission.has('expires_at')
        ? undefined
        : typeof rawExpiresAt === 'string' ? rawExpiresAt : null,
      decision: getStr(permission, 'decision'),
    });
  });
  result.pendingPermissions.sort((left, right) => {
    const leftExpiry = parsePermissionExpiration(left.expiresAt);
    const rightExpiry = parsePermissionExpiration(right.expiresAt);
    const expiryOrder = (leftExpiry !== null && Number.isFinite(leftExpiry) ? leftExpiry : Number.POSITIVE_INFINITY)
      - (rightExpiry !== null && Number.isFinite(rightExpiry) ? rightExpiry : Number.POSITIVE_INFINITY);
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
  asMap(root.get('pending_questions'))?.forEach((value) => {
    const item = asMap(value);
    const questionId = getStr(item, 'question_id');
    const status = getStr(item, 'status');
    if (!item || !questionId || !['pending', 'responding'].includes(status || '')) return;
    const questionsMap = asMap(item.get('questions'));
    const questionOrder = (asArray(item.get('question_order'))?.toArray() ?? [])
      .filter((key): key is string => typeof key === 'string')
      .slice(0, 8);
    const questions: PendingQuestionItem[] = [];
    for (const key of questionOrder) {
      const questionItem = questionsMap ? asMap(questionsMap.get(key)) : null;
      const question = getStr(questionItem, 'question');
      if (!questionItem || !question) continue;
      const optionsMap = asMap(questionItem.get('options'));
      const optionOrder = (asArray(questionItem.get('option_order'))?.toArray() ?? [])
        .filter((optionKey): optionKey is string => typeof optionKey === 'string')
        .slice(0, 16);
      const options: QuestionOption[] = [];
      for (const optionKey of optionOrder) {
        const option = optionsMap ? asMap(optionsMap.get(optionKey)) : null;
        const label = getStr(option, 'label');
        if (!option || !label) continue;
        options.push({ label, description: getStr(option, 'description') });
      }
      if (options.length === 0) continue;
      questions.push({
        question,
        header: getStr(questionItem, 'header'),
        options,
        multiSelect: questionItem.get('multi_select') === true,
      });
    }
    if (questions.length === 0) return;
    pendingQuestions.push({
      questionId,
      status: status as PendingQuestion['status'],
      description: getStr(item, 'description'),
      expiresAt: getStr(item, 'expires_at'),
      questions,
    });
  });
  pendingQuestions.sort((left, right) => (left.expiresAt || '').localeCompare(right.expiresAt || '')
    || left.questionId.localeCompare(right.questionId));
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

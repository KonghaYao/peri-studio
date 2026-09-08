// 状态与行为契约（node:test，CI 快速门）：纯函数契约 + 状态机/模块行为契约。
// 按主题从原单文件（801 行超限）拆分为四个契约文件：
//   - 本文件：action-state/recovery-state/message-time/markdown/message-follow/
//     auth-feedback/session-search/runtime-state 等纯函数契约，
//     以及 store/connection/protocol/组件 的行为契约（断言意图与原文件一致）；
//   - auth-contracts.test.mjs：身份边界契约（invalidation 链路与
//     resetAuthenticatedSession 完整复位）；
//   - css-contracts.test.mjs：CSS 结构/token/媒体查询断言；
//   - fixture-contracts.test.mjs：visual fixture 隔离与几何断言。

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isTurnActive } from '../src/features/runtime/action-state.ts';
import { cleanSessionTitle, connectionProblemForClose, formatRelativeTime, retainLiveRuntimeHints, sessionDisplayTitle, shortSessionId } from '../src/features/session/recovery-state.ts';
import { messageTime } from '../src/shared/lib/message-time.ts';
import { parseMarkdown, safeHref } from '../src/shared/lib/markdown.ts';
import { messageActivity, nextFollowState } from '../src/features/message/message-follow.ts';
import { authFeedback } from '../src/features/auth/auth-feedback.ts';
import { searchProjectSessions } from '../src/features/session/session-search.ts';
import { connectedRuntimeState, runtimeState } from '../src/features/runtime/runtime-state.ts';

// principal 解析与变更策略（保持闭包默认语义，与 recovery-state 解耦）
const parsePrincipal = (v) => v && ['full','read-only'].includes(v.role) ? v.role : null;
const canMutate = (role) => role === 'full';

test('runtime status distinguishes durable session state from process state', () => {
  assert.equal(runtimeState({ hasSession: true, isOpening: false, hasRuntime: false, hasPendingPermission: false, turnActive: false }).label, 'Idle');
  assert.equal(runtimeState({ hasSession: true, isOpening: false, hasRuntime: true, chatStatus: 'active', hasPendingPermission: false, turnActive: false }).tone, 'ready');
  assert.equal(runtimeState({ hasSession: true, isOpening: false, hasRuntime: true, isSelected: false, chatStatus: null, hasPendingPermission: false, turnActive: false }).label, 'Running');
  assert.equal(runtimeState({ hasSession: true, isOpening: false, hasRuntime: true, isHydrated: false, chatStatus: 'active', hasPendingPermission: false, turnActive: false }).label, 'Loading');
  assert.equal(runtimeState({ hasSession: true, isOpening: false, hasRuntime: true, chatStatus: 'active', hasPendingPermission: true, turnActive: true }).label, 'Approval');
  assert.equal(runtimeState({ hasSession: true, isOpening: false, hasRuntime: true, chatStatus: 'crashed', hasPendingPermission: false, turnActive: false }).tone, 'danger');
  assert.equal(runtimeState({ hasSession: true, lifecycle: 'reconciliation_required', isOpening: false, hasRuntime: false, hasPendingPermission: false, turnActive: false }).tone, 'attention');
  assert.deepEqual(
    connectedRuntimeState({ hasSession: true, hasRuntime: true, chatStatus: 'active', hasPendingPermission: false, turnActive: false }, { text: 'Stopped (4501)', kind: 'err' }),
    { label: 'Offline', tone: 'danger', detail: 'Connection stopped · session saved' },
  );
  assert.equal(
    connectedRuntimeState({ hasSession: true, hasRuntime: true, chatStatus: 'crashed', hasPendingPermission: false, turnActive: false }, { text: 'Stopped (4501)', kind: 'err' }).label,
    'Crashed',
  );
  assert.equal(
    connectedRuntimeState({ hasSession: true, hasRuntime: true, chatStatus: 'active', hasPendingPermission: false, turnActive: false }, { text: 'Connecting…', kind: 'idle' }).label,
    'Connecting',
  );
  assert.equal(
    connectedRuntimeState({ hasSession: true, hasRuntime: true, chatStatus: 'active', hasPendingPermission: false, turnActive: false }, { text: 'Reconnecting (in 2s)', kind: 'warn' }).label,
    'Reconnecting',
  );
});

test('principal parsing and mutation policy are closed by default', async () => {
  assert.equal(parsePrincipal({ role: 'full' }), 'full');
  assert.equal(parsePrincipal({ role: 'read-only' }), 'read-only');
  assert.equal(parsePrincipal({ role: 'instance' }), null);
  assert.equal(canMutate('full'), true);
  assert.equal(canMutate('read-only'), false);
  assert.equal(canMutate(null), false);
});

test('prompt recovery is owned by CommandTracker rather than an ad-hoc frame cache', () => {
  const store = readFileSync(join(import.meta.dirname, '..', 'src', 'store', 'index.ts'), 'utf8');
  const actions = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'message', 'user-actions.ts'), 'utf8');
  const delivery = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'message', 'message-delivery.ts'), 'utf8');
  const activation = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'session', 'session-activation.ts'), 'utf8');
  assert.match(actions, /sendAction\(frame, 'prompt', \{\s*acceptedStartsInactivityLease: true,\s*retryOnUncertain: true/);
  assert.match(activation, /this\.deps\.send\(frame, 'session\/create', \{\s*retryOnUncertain: true/);
  assert.match(actions, /deps!\.retry\(current\.commandId\)/);
  assert.match(store, /retry: \(commandId\) => commands\.retry\(commandId, sendFrame\)/);
  assert.doesNotMatch(store, /retryableMessageFrame|retryableQuickStartFrame/);
  assert.match(delivery, /if \(messageSubmission\(sessionId\) \|\| messageSubmissionByCommand\(commandId\)\) return false/);
  assert.match(delivery, /sourceCommandIds\.has\(current\.commandId\)/);
  assert.doesNotMatch(delivery, /entry\.text\s*===\s*current\.text|current\.text\s*===\s*entry\.text/);
  assert.doesNotMatch(delivery, /export const composerDrafts/);
});

test('active turn excludes every terminal projection state', () => {
  assert.equal(isTurnActive({ turnStatus: 'streaming' }), true);
  assert.equal(isTurnActive({ turnStatus: 'awaiting_permission' }), true);
  for (const status of ['completed', 'interrupted', 'cancelled', 'failed', 'ended']) {
    assert.equal(isTurnActive({ turnStatus: status }), false, status);
  }
  assert.equal(isTurnActive(null), false);
});

test('permission delivery uncertainty remains locked in the security surface', () => {
  const store = readFileSync(join(import.meta.dirname, '..', 'src', 'store', 'index.ts'), 'utf8');
  const projection = readFileSync(join(import.meta.dirname, '..', 'src', 'store', 'store-projection.ts'), 'utf8');
  const actions = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'message', 'user-actions.ts'), 'utf8');
  const delivery = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'message', 'permission-delivery.ts'), 'utf8');
  assert.match(actions, /startPermissionDecision\(frame\.commandId, permissionId, decision\)/);
  assert.match(actions, /retryOnError: true/);
  assert.match(actions, /onTimeout:\s*\(\)\s*=>\s*\{[\s\S]*?markPermissionDecisionUncertain\(frame\.commandId\)[\s\S]*?do not submit the opposite decision/);
  assert.match(actions, /onError:\s*\(error\)\s*=>\s*error\.retryable[\s\S]*?markPermissionDecisionUncertain\(frame\.commandId, true\)[\s\S]*?failPermissionDecision\(frame\.commandId\)/);
  assert.match(delivery, /retryable:\s*boolean/);
  assert.match(delivery, /markPermissionDecisionUncertain\(commandId: string, retryable = false\)/);
  assert.match(projection, /retainProjectedPermissions\(new Set\(control\.pendingPermissions/);
  assert.doesNotMatch(store, /pendingPermissionDecisions|setPendingPermissionDecisions|lockPermissionDecision|unlockPermissionDecision/);
  assert.match(delivery, /if \(!permissionId \|\| decisions\(\)\.has\(permissionId\)\) return false/);
});

test('runtime hints survive only while Registry proves the chat is non-terminal', () => {
  // gap/closed 均视为终态（§8.3 对账语义，见 lib/recovery-state.ts 与
  // lib/recovery-state.test.ts）；accepting 才是非终态存活证据。
  const sessions = [
    { id: 'live', activeChatId: 'chat-live' },
    { id: 'closed', activeChatId: 'chat-closed' },
    { id: 'missing', activeChatId: 'chat-missing' },
    { id: 'idle', activeChatId: null },
  ];
  assert.deepEqual(retainLiveRuntimeHints(sessions, [
    { id: 'chat-live', status: 'accepting' },
    { id: 'chat-closed', status: 'closed' },
  ]).map((session) => session.activeChatId), ['chat-live', null, null, null]);
});

test('import presentation removes system reminders and formats stable metadata', () => {
  assert.equal(cleanSessionTitle('hello <system-reminder>secret instructions'), 'hello');
  assert.equal(cleanSessionTitle('<system-reminder>only internals'), 'Untitled session');
  assert.equal(formatRelativeTime('2026-08-13T00:00:00Z', Date.parse('2026-08-13T02:00:00Z')), '2 hours ago');
  assert.equal(sessionDisplayTitle('New conversation', 'acp-123456789'), 'New conversation · …23456789');
  assert.equal(sessionDisplayTitle('Fix login flow', 'acp-123456789'), 'Fix login flow');
  assert.equal(shortSessionId('session-1234567890'), '34567890');
});

test('message timestamps are human-readable, exact on hover, and absent when unknown', () => {
  const now = Date.parse('2026-08-13T12:00:00Z');
  const today = messageTime('2026-08-13T10:05:00Z', now);
  assert.match(today?.label || '', /05/);
  assert.match(today?.exact || '', /2026/);
  // en-US locale（全量英文化）：非同日 7 天内 label 为英文短星期（如 "Mon"）。
  assert.match(messageTime('2026-08-11T10:05:00Z', now)?.label || '', /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
  assert.match(messageTime('2025-12-01T10:05:00Z', now)?.label || '', /2025/);
  assert.equal(messageTime('—', now), null);
  assert.equal(messageTime('not-a-date', now), null);
});

test('fatal connection states prescribe one safe recovery action', () => {
  assert.equal(connectionProblemForClose(4500).action, 'reconnect');
  assert.equal(connectionProblemForClose(4501).action, 'reconnect');
  assert.equal(connectionProblemForClose(4502).action, 'login');
  assert.equal(connectionProblemForClose(9999).action, 'reconnect');
});

test('markdown links allow explicit public protocols and reject active content', () => {
  assert.equal(safeHref('https://example.com/a?q=1'), 'https://example.com/a?q=1');
  assert.equal(safeHref('mailto:user@example.com'), 'mailto:user@example.com');
  for (const href of ['javascript:alert(1)', ' JAVASCRIPT:alert(1)', 'data:text/html,x', 'file:///tmp/x', '//evil.example']) {
    assert.equal(safeHref(href), null, href);
  }
});

test('markdown parser keeps raw html inert and structures coding content', () => {
  const blocks = parseMarkdown('# Title\n\n<script>alert(1)</script>\n\n```ts unsafe meta\nconst x = 1;\n```\n\n- one\n- two');
  assert.equal(blocks[0].type, 'heading');
  assert.deepEqual(blocks[1], { type: 'paragraph', children: [{ type: 'text', text: '<script>alert(1)</script>' }] });
  assert.deepEqual(blocks[2], { type: 'code', language: 'ts', text: 'const x = 1;' });
  assert.equal(blocks[3].type, 'list');
  assert.equal(blocks[3].items.length, 2);
});

test('unsafe markdown links degrade to readable inert text', () => {
  const [paragraph] = parseMarkdown('[run this](javascript:alert(1))');
  assert.equal(paragraph.children.some((token) => token.type === 'link'), false);
  assert.equal(paragraph.children.map((token) => token.text || '').join(''), 'run this (javascript:alert(1))');
});

test('message follow pauses without losing the new-content signal', () => {
  const before = messageActivity([{ id: 'a', status: 'streaming', text: 'one', toolCalls: [] }]);
  const after = messageActivity([{ id: 'a', status: 'streaming', text: 'one two', toolCalls: [] }]);
  assert.equal(nextFollowState({ stick: false, hasNewContent: false, previousActivity: before, activity: after }).hasNewContent, true);
  assert.equal(nextFollowState({ stick: false, hasNewContent: true, previousActivity: after, activity: after }).hasNewContent, true);
  assert.equal(nextFollowState({ stick: true, hasNewContent: true, previousActivity: before, activity: after }).hasNewContent, false);
  const forced = nextFollowState({ stick: false, hasNewContent: true, previousActivity: before, activity: after, forceFollow: true });
  assert.equal(forced.stick, true);
  assert.equal(forced.hasNewContent, false);
});

test('authentication feedback does not blame credentials for server failures', () => {
  assert.equal(authFeedback(401, 'status'), null);
  assert.equal(authFeedback(401, 'login').kind, 'credential');
  assert.equal(authFeedback(403, 'login').kind, 'origin');
  assert.equal(authFeedback(429, 'login').kind, 'rate');
  assert.equal(authFeedback(503, 'login').kind, 'server');
  assert.match(authFeedback(503, 'login').message, /does not mean the token is invalid/);
  assert.equal(authFeedback(0, 'status').retryable, true);
});

test('connection loss settles pending actions instead of silently discarding their callbacks', () => {
  const connection = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'connection', 'connection.ts'), 'utf8');
  const tracker = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'connection', 'command-tracker.ts'), 'utf8');
  assert.match(tracker, /settleConnectionLoss\(\): void/);
  assert.match(tracker, /for \(const commandId of \[\.\.\.this\.pending\.keys\(\)\]\)/);
  assert.match(connection, /case 'reconnecting':[\s\S]*?deps!\.settleConnectionLoss\(\)/);
  assert.match(connection, /case 'fatal':[\s\S]*?deps!\.settleConnectionLoss\(\)/);
  assert.match(connection, /case 'closed':[\s\S]*?deps!\.settleConnectionLoss\(\)/);
  for (const state of ['reconnecting', 'fatal', 'closed']) {
    const branch = connection.match(new RegExp(`case '${state}':([\\s\\S]*?)(?=case '|default:)`))?.[1] || '';
    assert.doesNotMatch(branch, /setMessageSubmission|setQuickStartSubmission|markMessageUncertain|updateQuickStart/, `${state} must settle action state only through CommandTracker callbacks`);
  }
  assert.match(connection, /export function connectWithCookie\(\)[\s\S]*?deps!\.settleConnectionLoss\(\)/);
  assert.doesNotMatch(connection, /connectWithCookie\(\)[\s\S]{0,500}setPersistentErrors\(\[\]\)/);
});

test('replaced websocket callbacks cannot mutate the new connection state', () => {
  const connection = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'connection', 'connection.ts'), 'utf8');
  assert.match(connection, /let connectionEpoch = 0/);
  assert.match(connection, /const epoch = \+\+connectionEpoch/);
  assert.match(connection, /onStatus: \(state, detail\) => \{ if \(epoch === connectionEpoch\) handleStatus\(state, detail\); \}/);
  assert.match(connection, /onFrame: \(frame\) => \{ if \(epoch === connectionEpoch\) deps!\.onFrame\(frame\); \}/);
});

test('routine connection readiness stays in persistent status instead of interrupting with a toast', () => {
  const connection = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'connection', 'connection.ts'), 'utf8');
  const state = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'connection', 'connection-state.ts'), 'utf8');
  assert.match(connection, /const transition = connectionTransition\(state, detail, !!principalRole\(\)\)/);
  assert.match(state, /case 'ready':[\s\S]*?ready: true,[\s\S]*?busy: false,[\s\S]*?text: 'Ready'/);
  assert.match(state, /case 'reconnecting':[\s\S]*?ready: false,[\s\S]*?busy: true/);
  assert.doesNotMatch(connection, /case 'ready':[\s\S]{0,260}set(?:Busy|ConnState|ConnectionProblem)\(/);
  assert.doesNotMatch(connection, /toast\('Connection ready'\)/);
});

test('browser diagnostics never print raw protocol or user payloads', () => {
  const root = join(import.meta.dirname, '..', 'src', 'panel');
  const ws = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'connection', 'ws-client.ts'), 'utf8');
  const store = readFileSync(join(root, '..', 'store', 'index.ts'), 'utf8');
  const yjsValues = readFileSync(join(import.meta.dirname, '..', 'src', 'shared', 'yjs', 'yjs-values.ts'), 'utf8');
  assert.doesNotMatch(ws, /console\.(?:error|warn)\([^\n]*(?:ev\.data|frame\)|ev\.reason|,\s*ev\b)/);
  assert.doesNotMatch(store, /console\.error\([^\n]*JSON\.stringify\(err\)/);
  assert.doesNotMatch(yjsValues, /console\.warn\([^\n]*,\s*err\)/);
});

test('downstream parsing rejects unsafe JSON shapes while preserving future tags', () => {
  const protocol = readFileSync(join(import.meta.dirname, '..', 'src', 'shared', 'protocol', 'client.ts'), 'utf8');
  const ws = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'connection', 'ws-client.ts'), 'utf8');
  assert.match(protocol, /!value \|\| typeof value !== 'object' \|\| Array\.isArray\(value\)/);
  assert.match(protocol, /typeof frame\.t !== 'string' \|\| !frame\.t\.trim\(\)/);
  assert.doesNotMatch(protocol, /FRAME_TAGS|KNOWN_TAGS/);
  assert.match(protocol, /case 'action_ack':/);
  assert.match(protocol, /case 'action_error':/);
  assert.match(protocol, /case 'ysync\.update':/);
  assert.match(protocol, /case 'ready':/);
  assert.match(protocol, /!optionalNullishStrings\(frame, \['turnId', 'chatId', 'projectId', 'sessionId', 'acpSessionId'\]\)/);
  assert.match(protocol, /omitNullish\(frame, \['turnId', 'chatId', 'projectId', 'sessionId', 'acpSessionId', 'committedProjectionVersion'\]\)/);
  assert.match(ws, /\[ws-client\] frame parse failed length=\$\{size\}/);
  assert.doesNotMatch(ws, /frame parse failed[^\n]*(?:ev\.data|JSON\.stringify)/);
});

test('each Yjs document kind has one independent reader without a shared barrel', () => {
  // 兼容 barrel（yjs.ts）已删除：投影 reader 直接由各模块消费，契约降级为
  // 断言每个 reader 保持独立实现、不互相耦合。
  const registry = readFileSync(join(import.meta.dirname, '..', 'src', 'entities', 'registry', 'registry-view.ts'), 'utf8');
  const chat = readFileSync(join(import.meta.dirname, '..', 'src', 'entities', 'chat', 'chat-view.ts'), 'utf8');
  const control = readFileSync(join(import.meta.dirname, '..', 'src', 'entities', 'chat', 'control-view.ts'), 'utf8');
  const docs = readFileSync(join(import.meta.dirname, '..', 'src', 'shared', 'yjs', 'doc-store.ts'), 'utf8');
  assert.match(registry, /export function renderRegistry/);
  assert.doesNotMatch(registry, /renderChat|renderControl|class DocStore/);
  assert.match(chat, /export function renderChat/);
  assert.doesNotMatch(chat, /renderRegistry|renderControl|class DocStore/);
  assert.match(control, /export function renderControl/);
  assert.doesNotMatch(control, /renderRegistry|renderChat|class DocStore/);
  assert.match(docs, /export class DocStore/);
  assert.doesNotMatch(docs, /renderRegistry|renderChat|renderControl/);
});

test('all empty-session creation entry points share one store-level single-flight guard', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const store = readFileSync(join(root, 'store', 'index.ts'), 'utf8');
  const activation = readFileSync(join(root, 'features', 'session', 'session-activation.ts'), 'utf8');
  const sidebar = readFileSync(join(root, 'widgets', 'sidebar', 'ProjectSidebar.tsx'), 'utf8');
  const sidebarTree = readFileSync(join(root, 'widgets', 'sidebar', 'project-sidebar-tree.tsx'), 'utf8');
  const launchWorkspace = readFileSync(join(root, 'widgets', 'shell', 'LaunchWorkspace.tsx'), 'utf8');
  assert.match(activation, /this\.deps\.creatingProjectId\(\)/);
  assert.match(activation, /this\.deps\.setCreatingProjectId\(projectId\)/);
  assert.match(sidebarTree, /busy=\{creatingSessionProjectId\(\) === projectId\}/);
  assert.match(launchWorkspace, /busy=\{creatingSessionProjectId\(\) === activeProjects\(\)\[0\]\.id\}/);
});

test('uncertain metadata retries preserve the original frame identity and are identity-scoped', () => {
  const root = join(import.meta.dirname, '..', 'src', 'panel');
  const store = readFileSync(join(root, '..', 'store', 'index.ts'), 'utf8');
  const resetSession = readFileSync(join(root, '..', 'store', 'reset-session.ts'), 'utf8');
  const errors = readFileSync(join(root, '..', 'features', 'message', 'panel-errors.ts'), 'utf8');
  const tracker = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'connection', 'command-tracker.ts'), 'utf8');
  const catalog = readFileSync(join(root, '..', 'features', 'catalog', 'catalog-actions.ts'), 'utf8');
  const activation = readFileSync(join(root, '..', 'features', 'session', 'session-activation.ts'), 'utf8');
  assert.match(tracker, /this\.uncertain\.set\(commandId, request\)/);
  assert.match(tracker, /return this\.dispatch\(request, send\)/);
  assert.match(tracker, /frame: tracked\.frame/);
  assert.match(errors, /const sent = deps!\.retry\(commandId\) === 'sent'/);
  assert.match(errors, /if \(sent\) deps!\.setPersistentErrors/);
  assert.match(resetSession, /commands\.reset\(\)/);
  assert.match(activation, /this\.deps\.hasUncertainMetadata\(\)/);
  assert.match(store, /onUncertainCountChange: setUncertainMetadataCount/);
  assert.match(store, /new CatalogActions\(\{/);
  assert.doesNotMatch(store, /H\.project(?:Create|Archive|Restore|Rename)\(/);
  assert.doesNotMatch(store, /H\.persistedSession(?:Rename|Archive|Restore|Import|Discover)\(/);
  for (const action of ['project/create', 'project/archive', 'project/restore', 'project/rename', 'session/import']) {
    const escaped = action.replace('/', '\\/');
    assert.match(catalog, new RegExp(`'${escaped}'`), action);
  }
  assert.match(catalog, /renameSession/);
  assert.match(catalog, /setSessionArchived/);
  assert.match(catalog, /persistedSessionRename/);
  assert.match(catalog, /persistedSessionArchive/);
  assert.match(activation, /this\.deps\.send\(frame, 'session\/create', \{/);
  assert.match(catalog, /retryOnUncertain: true/);
});

test('project session discovery is an explicit cold-start read path', () => {
  const root = join(import.meta.dirname, '..', 'src', 'panel');
  const store = readFileSync(join(root, '..', 'store', 'index.ts'), 'utf8');
  const catalog = readFileSync(join(root, '..', 'features', 'catalog', 'catalog-actions.ts'), 'utf8');
  const protocol = readFileSync(join(import.meta.dirname, '..', 'src', 'shared', 'protocol', 'client.ts'), 'utf8');
  const dialog = readFileSync(join(root, '..', 'widgets', 'shell', 'SessionImportDialog.tsx'), 'utf8');
  assert.match(protocol, /action\('session\/discover', \{ projectId \}\)/);
  assert.match(store, /catalogActions\.discoverSessions/);
  assert.match(catalog, /this\.deps\.send\(frame, 'session\/discover'/);
  assert.match(dialog, /props\.onDiscover\(projectId/);
  assert.match(dialog, /Reading ACP sessions/);
  assert.doesNotMatch(catalog, /this\.deps\.send\(frame, 'session\/discover', \{\s*retryOnUncertain: true/);
});

test('terminal action effects have one owner and late acknowledgements cannot resume quick start', () => {
  const root = join(import.meta.dirname, '..', 'src', 'panel');
  const store = readFileSync(join(root, '..', 'store', 'index.ts'), 'utf8');
  const connectionDownstream = readFileSync(join(root, '..', 'features', 'connection', 'handle-downstream.ts'), 'utf8');
  const resetSession = readFileSync(join(root, '..', 'store', 'reset-session.ts'), 'utf8');
  const actions = readFileSync(join(root, '..', 'features', 'message', 'user-actions.ts'), 'utf8');
  const tracker = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'connection', 'command-tracker.ts'), 'utf8');
  const activation = readFileSync(join(root, '..', 'features', 'session', 'session-activation.ts'), 'utf8');
  const ackHandler = connectionDownstream.slice(connectionDownstream.indexOf('function onAck('), connectionDownstream.indexOf('function onActionError('));
  const errorHandler = connectionDownstream.slice(connectionDownstream.indexOf('function onActionError('), connectionDownstream.indexOf('function handleDownstream('));
  const lateBranch = ackHandler.slice(ackHandler.indexOf("if (disposition === 'late_terminal')"));
  assert.ok(ackHandler.indexOf('commands.acknowledge(ack)') < ackHandler.indexOf("if (disposition === 'late_terminal')"));
  assert.doesNotMatch(lateBranch, /selectChat\(|sendMessage\(/);
  assert.match(lateBranch, /settleLateQuickStart/);
  assert.match(lateBranch, /if \(ack\.commandId\) completeMessageDelivery\(ack\.commandId, ack\.status\)/);
  assert.doesNotMatch(lateBranch, /messageSubmissionByCommand/);
  assert.match(errorHandler, /commands\.fail\(err\)/);
  assert.doesNotMatch(errorHandler, /failMessageSubmission|failQuickStart|failPermissionDecision/);
  assert.doesNotMatch(store, /permissionCommands/);
  assert.match(tracker, /tracked\.callbacks\?\.onTerminal\?\.\(ack\)/);
  assert.match(tracker, /return wasUncertain && ack\.status !== 'accepted' \? 'late_terminal' : 'unknown'/);
  const prompt = actions.slice(actions.indexOf('export function sendMessage'), actions.indexOf('export function retryMessageSubmission'));
  assert.equal((activation.match(/failQuickStart\(frame\.commandId/g) || []).length, 1);
  assert.equal((prompt.match(/failMessageDelivery\(frame\.commandId/g) || []).length, 1);
  assert.match(prompt, /startMessageDelivery\(frame\.commandId, text, sessionId, chatId, draftOwner\)/);
  assert.doesNotMatch(store, /setMessageSubmission|setQuickStartSubmission|composerDrafts|restoreSubmissionDraft/);
});

test('runtime controls are chat-scoped and reconcile through projection truth', () => {
  const root = join(import.meta.dirname, '..', 'src', 'panel');
  const store = readFileSync(join(root, '..', 'store', 'index.ts'), 'utf8');
  const projection = readFileSync(join(root, '..', 'store', 'store-projection.ts'), 'utf8');
  const actions = readFileSync(join(root, '..', 'features', 'message', 'user-actions.ts'), 'utf8');
  const control = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'runtime', 'runtime-control.ts'), 'utf8');
  assert.doesNotMatch(store, /cancellingTurn|closingChat|setCancellingTurn|setClosingChat/);
  assert.match(actions, /startRuntimeControl\(frame\.commandId, chatId, 'cancel'\)/);
  assert.match(actions, /startRuntimeControl\(frame\.commandId, chatId, 'close'\)/);
  assert.match(actions, /retryOnUncertain: true/);
  assert.match(projection, /reconcileCurrentRuntimeControl\(control\)/);
  assert.match(control, /const \[controls, setControls\] = createSignal<Record<string, RuntimeControlSubmission>>/);
  assert.match(control, /current\.kind === 'cancel' && \(!turnActive \|\| terminal\)/);
  assert.match(control, /current\.kind === 'close' && terminal/);
});

test('login setup is server-authoritative and credential-free', () => {
  const authRoot = join(import.meta.dirname, '..', 'src', 'features', 'auth');
  // P4：parseAuthSetup 调用链在 features/auth/auth-hook（authPayload），渲染展示在 AuthGate。
  const hook = readFileSync(join(authRoot, 'auth-hook.ts'), 'utf8');
  const gate = readFileSync(join(import.meta.dirname, '..', 'src', 'widgets', 'auth', 'AuthGate.tsx'), 'utf8');
  const parser = readFileSync(join(authRoot, 'auth-setup.ts'), 'utf8');
  assert.match(hook, /parseAuthSetup/);
  assert.match(gate, /setup\(\)\?\.generateCommand/);
  assert.match(gate, /setup\(\)\?\.tokenFile|hint\(\)\.tokenFile/);
  assert.doesNotMatch(gate, /~\/\.config\/peri-studio|cargo run -p peri-studio-server/);
  assert.match(parser, /typeof tokenFile !== 'string'/);
  assert.match(parser, /typeof generateCommand !== 'string'/);
  assert.doesNotMatch(parser, /tokenId|token_id|bearer/);
});

test('global session search matches durable metadata and excludes empty queries', () => {
  const projects = [{ id: 'p1', name: 'Perihelion', cwd: '/code/peri' }];
  const sessions = [
    { id: 'acp-123', projectId: 'p1', title: 'Fix login', updatedAt: '2026-08-13T10:00:00Z' },
    { id: 'acp-456', projectId: 'p1', title: 'Component audit', updatedAt: '2026-08-13T11:00:00Z' },
  ];
  assert.deepEqual(searchProjectSessions('', projects, sessions), []);
  assert.equal(searchProjectSessions('peri', projects, sessions).length, 2);
  assert.equal(searchProjectSessions('456', projects, sessions)[0].id, 'acp-456');
  assert.equal(searchProjectSessions('audit', projects, sessions)[0].id, 'acp-456');
});

test('session navigation closes only after a server-authoritative open commits', () => {
  const root = join(import.meta.dirname, '..', 'src', 'panel');
  const store = readFileSync(join(root, '..', 'store', 'index.ts'), 'utf8');
  const sidebarRow = readFileSync(join(root, '..', 'widgets', 'sidebar', 'project-sidebar-row.tsx'), 'utf8');
  const sessionRow = readFileSync(join(root, '..', 'widgets', 'sidebar', 'ProjectSessionRow.tsx'), 'utf8');
  const search = readFileSync(join(root, '..', 'widgets', 'sidebar', 'SessionSearch.tsx'), 'utf8');
  const activation = readFileSync(join(root, '..', 'features', 'session', 'session-activation.ts'), 'utf8');
  assert.match(activation, /export interface OpenSessionCallbacks/);
  assert.match(activation, /callbacks\.onCommitted\?\.\(\)/);
  assert.match(sidebarRow, /onOpen=\{\(sessionId, onCommitted\) => \{ navigateProjectSession\(sessionId, \{ onCommitted \}\); \}\}/);
  assert.match(sessionRow, /props\.onOpen\(props\.session\.id, props\.onNavigate\)/);
  assert.doesNotMatch(sessionRow, /props\.onOpen\(props\.session\.id[^;]*;\s*props\.onNavigate\(\)/);
  assert.match(search, /onCommitted: \(\) => \{ props\.onClose\(\)/);
  assert.match(search, /onUncertain:/);
});

test('session activation policy is a deep module rather than store callback sprawl', () => {
  const root = join(import.meta.dirname, '..', 'src', 'panel');
  const store = readFileSync(join(root, '..', 'store', 'index.ts'), 'utf8');
  const activation = readFileSync(join(root, '..', 'features', 'session', 'session-activation.ts'), 'utf8');
  assert.match(store, /new SessionActivation\(\{/);
  assert.match(store, /sessionActivation\.create\(projectId, title\)/);
  assert.match(store, /sessionActivation\.quickStart\(projectId, text\)/);
  assert.match(store, /sessionActivation\.navigate\(sessionId, callbacks\)/);
  assert.doesNotMatch(store, /H\.persistedSession(?:Create|Open)\(/);
  assert.doesNotMatch(store, /new SessionNavigator|sessionNavigator\.transition/);
  assert.match(activation, /class SessionActivation/);
  assert.match(activation, /'Incomplete create-session reply'/);
  assert.match(activation, /if \(!ack\.sessionId \|\| !ack\.chatId\)/);
});

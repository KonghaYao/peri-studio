// 身份边界契约（node:test，CI 快速门）：自 state-contracts.test.mjs 拆出。
//
// 覆盖 auth-hook/auth-state/AuthGate 的 invalidation 链路与
// resetAuthenticatedSession 完整身份边界（P4：鉴权行为在 lib/auth-hook，
// AuthGate 只保留渲染绑定），断言意图与原文件一致。

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('authentication invalidation survives UI cleanup and reaches the login surface', () => {
  const root = join(import.meta.dirname, '..', 'src', 'panel');
  const storeRoot = join(import.meta.dirname, '..', 'src', 'store');
  const store = readFileSync(join(storeRoot, 'index.ts'), 'utf8');
  // P4：鉴权行为（requestEpoch 竞态 / invalidation 恢复）在 lib/auth-hook，
  // AuthGate 只保留渲染绑定（auth.problem() → auth-problem 区域）。
  const hook = readFileSync(join(root, 'lib', 'auth-hook.ts'), 'utf8');
  const gate = readFileSync(join(import.meta.dirname, '..', 'src', 'widgets', 'auth', 'AuthGate.tsx'), 'utf8');
  const authState = readFileSync(join(root, 'lib', 'auth-state.ts'), 'utf8');
  const invalidator = store.slice(store.indexOf('function invalidateAuthentication('), store.indexOf('export function cancelTurn'));
  assert.ok(invalidator.indexOf('resetAuthenticatedSession()') < invalidator.indexOf('publishAuthInvalidation(reason)'));
  assert.match(authState, /setInvalidation\(\{ id: \+\+invalidationSequence, reason \}\)/);
  assert.match(authState, /setInvalidation\(null\)/);
  assert.doesNotMatch(authState, /authInvalidated|authInvalidationReason/);
  assert.match(hook, /const event = authInvalidation\(\)/);
  assert.match(hook, /message: event\.reason/);
  assert.match(hook, /setProblem\(\{ kind: 'credential'/);
  assert.match(hook, /let requestEpoch = 0/);
  assert.match(hook, /if \(epoch !== requestEpoch\) return/);
  assert.match(gate, /auth\.problem\(\)/);
  assert.doesNotMatch(gate, /fetch\(|localStorage\./);
  assert.doesNotMatch(store, /export \{[^}]*authInvalidation/);
  const migratedComponents = [
    ['useComposerState.ts', join(import.meta.dirname, '..', 'src', 'widgets', 'composer')],
    ['QuickStartComposer.tsx', join(import.meta.dirname, '..', 'src', 'widgets', 'composer')],
    ['ProjectSidebar.tsx', join(import.meta.dirname, '..', 'src', 'widgets', 'sidebar')],
    ['SessionSearch.tsx', join(import.meta.dirname, '..', 'src', 'widgets', 'sidebar')],
  ];
  const panelComponents = [
    ['ChatView.tsx', join(import.meta.dirname, '..', 'src', 'widgets', 'chat')],
    ['SessionRailActions.tsx', join(import.meta.dirname, '..', 'src', 'widgets', 'shell')],
  ];
  for (const [file, directory] of migratedComponents) {
    const feature = readFileSync(join(directory, file), 'utf8');
    assert.match(feature, /from '\.\.\/\.\.\/panel\/lib\/auth-state'/, file);
    assert.doesNotMatch(feature, /import \{[^}]*\breadOnly\b[^}]*\} from '\.\.\/store'/, file);
  }
  for (const [file, directory] of panelComponents) {
    const feature = readFileSync(join(directory, file), 'utf8');
    assert.match(feature, /from '\.\.\/\.\.\/panel\/lib\/auth-state'/, file);
    assert.doesNotMatch(feature, /import \{[^}]*\breadOnly\b[^}]*\} from '\.\.\/store'/, file);
  }
});

test('authenticated-session cleanup is a complete identity boundary, not reconnect cleanup', () => {
  const root = join(import.meta.dirname, '..', 'src', 'panel');
  const storeRoot = join(import.meta.dirname, '..', 'src', 'store');
  const store = readFileSync(join(storeRoot, 'index.ts'), 'utf8');
  const resetModule = readFileSync(join(storeRoot, 'reset-session.ts'), 'utf8');
  const connectionModule = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'connection', 'connection.ts'), 'utf8');
  const hook = readFileSync(join(root, 'lib', 'auth-hook.ts'), 'utf8');
  const toastStore = readFileSync(join(root, 'lib', 'toast-store.ts'), 'utf8');
  const resetFactory = resetModule.slice(resetModule.indexOf('export function createResetAuthenticatedSession'), resetModule.lastIndexOf('}'));
  const disconnect = connectionModule.slice(connectionModule.indexOf('export function disconnect('), connectionModule.indexOf('export function resetConnectionState'));

  assert.doesNotMatch(disconnect, /setProjects|setProjectSessions|setChats|store\.clear|toastStore\.clear/);
  for (const statement of [
    'installPrincipalRole(null)', 'setSelectedCid',
    'setSelectedSessionId', 'setChatEntries', 'setChatHead', 'setPermissions',
    'setRuntimeDocsState', 'setChatStatusSignal', 'setProjects', 'setProjectSessions',
    'setImportableSessions', 'resetMessageDelivery', 'sessionActivation.reset',
    'resetRuntimeControls', 'setPersistentErrors', 'commands.reset',
    'resetPermissionDecisions', 'resetConnectionState()', 'docStore.clear', 'toastStore.clear',
  ]) assert.match(resetFactory, new RegExp(statement.replace(/[().]/g, '\\$&')), statement);
  // 连接信号（connState/heartbeatCount/connectionProblem）归 resetConnectionState（lib/connection）。
  const resetConnection = connectionModule;
  const resetStateFn = resetConnection.slice(resetConnection.indexOf('export function resetConnectionState'), resetConnection.indexOf('export function rememberSession'));
  assert.match(resetStateFn, /setConnState\(/);
  assert.match(resetStateFn, /setHeartbeatCount\(0\)/);
  assert.match(resetStateFn, /setConnectionProblem\(null\)/);
  assert.ok(resetFactory.indexOf('installPrincipalRole(null)') < resetFactory.indexOf('disconnect()'));
  assert.ok(resetFactory.indexOf('docStore.clear()') < resetFactory.indexOf('toastStore.clear()'));
  assert.match(toastStore, /for \(const timer of this\.timers\.values\(\)\) clearTimeout\(timer\)/);
  assert.match(toastStore, /this\.timers\.clear\(\)/);
  // P4：身份边界行为在 lib/auth-hook——挂载检查链与 invalidation 处理链。
  // P0-2：resetAuthenticatedSession 经 deps 注入（lib 不反向依赖 store），
  // 契约断言跟随注入后的调用形式。
  assert.doesNotMatch(hook, /from '\.\.\/store'/);
  assert.match(hook, /const principal = parsePrincipal\(parsed\.payload\);[\s\S]*?deps\.resetSession\(\{ preserveLocalDrafts: true \}\);\s*installPrincipalRole\(principal\.role, principal\.principalId\)/);
  assert.match(hook, /function handleInvalidation\(event: \{ reason: string \}\)[\s\S]*?deps\.resetSession\(\);[\s\S]*?setState\('signed-out'\)/);
  assert.match(hook, /createEffect\(\(\) => \{[\s\S]*?const event = authInvalidation\(\);[\s\S]*?handleInvalidation\(event\)/);
});

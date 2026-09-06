// onFrame 帧路由契约测试（P3 store 拆分安全网）。
//
// store.onFrame 是下行帧分发器：每个协议帧标签必须恰好有一个 case，
// 且每个 case 必须有实质处理（内联语句或委托给特性模块的 handle 函数），
// 未知帧则显式落入 default 忽略（协议演进兼容）。本文件在拆分前后都应
// 保持全绿：case 集合与协议标签集合的对应关系是行为契约，实现位置
// （store 内联 vs 模块委托）可以变化，但不得丢帧、不得出现死 case。

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (file) => readFileSync(join(import.meta.dirname, '..', 'src', file), 'utf8');

// ws-client 内部消化的帧不会进入 store.onFrame（keep_alive 由客户端吞掉，
// ready 在 WsClient 中转为 onStatus('ready') 回调）。
const WS_INTERNAL_TAGS = new Set(['keep_alive', 'ready']);

// 特性帧与其归属模块（拆分后由模块导出 handle 函数）。
const FEATURE_OWNERS = {
  prompt_status: { module: 'panel/lib/prompt-recovery-assembly.ts', prefix: 'handlePromptStatus' },
  rewind_candidates: { module: 'panel/lib/rewind-assembly.ts', prefix: 'handleRewindCandidates' },
  rewind_preview: { module: 'panel/lib/rewind-assembly.ts', prefix: 'handleRewindPreview' },
  mcp_servers: { module: 'panel/lib/mcp.ts', prefix: 'handleMcpServers' },
  mcp_oauth: { module: 'panel/lib/mcp.ts', prefix: 'handleMcpOAuth' },
  mcp_oauth_authorization: { module: 'panel/lib/mcp.ts', prefix: 'handleMcpOAuthAuthorization' },
  mcp_app_session: { module: 'panel/lib/mcp-apps.ts', prefix: 'handleMcpAppSession' },
  mcp_app_resource: { module: 'panel/lib/mcp-apps.ts', prefix: 'handleMcpAppResource' },
  mcp_app_call_result: { module: 'panel/lib/mcp-apps.ts', prefix: 'handleMcpAppCallResult' },
  resource_result: { module: 'panel/lib/resource-store.ts', prefix: 'handleResourceResult' },
  terminal_opened: { module: 'features/terminal/terminal-session.ts', prefix: 'handleTerminalFrame' },
  terminal_output: { module: 'features/terminal/terminal-session.ts', prefix: 'handleTerminalFrame' },
  terminal_exit: { module: 'features/terminal/terminal-session.ts', prefix: 'handleTerminalFrame' },
  terminal_error: { module: 'features/terminal/terminal-session.ts', prefix: 'handleTerminalFrame' },
  // ysync.update 是唯一含点的标签（[a-z_.]+），由 store 内的 doc-store
  // 实例内联消费（store.applyUpdateFrame），不委托模块 handler。
  'ysync.update': { module: 'shared/yjs/doc-store.ts', prefix: 'applyUpdateFrame' },
};

function protocolFrameTags() {
  const protocol = source('panel/lib/protocol.ts');
  const downstream = protocol.slice(
    protocol.indexOf('export type DownstreamFrame'),
    protocol.indexOf('export const parse'),
  );
  const resourceProtocol = source('panel/lib/resource-protocol.ts');
  const resourceDownstream = resourceProtocol.slice(
    resourceProtocol.indexOf('export interface ResourceResultFrame'),
    resourceProtocol.indexOf('export function openResourceView'),
  );
  const terminalProtocol = source('shared/protocol/terminal.ts');
  const terminalDownstream = terminalProtocol.slice(
    terminalProtocol.indexOf('export interface TerminalOpenedFrame'),
    terminalProtocol.indexOf('export type TerminalDownstreamFrame'),
  );
  const literalTags = (text) => [...text.matchAll(/(?:\||interface\s+\w+\s*\{)[\s\S]*?\bt: '([a-z_.]+)'/g)].map((m) => m[1]);
  return [...new Set([
    ...literalTags(downstream),
    ...literalTags(resourceDownstream),
    ...literalTags(terminalDownstream),
  ])];
}

function onFrameSwitch() {
  const store = source('store/index.ts');
  const start = store.indexOf('function onFrame(');
  const end = store.indexOf('function onAck(');
  assert.ok(start !== -1 && end !== -1 && start < end, 'store.ts onFrame block must exist');
  return store.slice(start, end);
}

function caseLabels() {
  return [...onFrameSwitch().matchAll(/case '([a-z_.]+)':/g)].map((m) => m[1]);
}

function caseBody(tag) {
  const match = onFrameSwitch().match(new RegExp(`case '${tag}':([\\s\\S]*?)(?=case '|default:)`));
  return match ? match[1] : '';
}

test('onFrame routes every protocol frame tag to a case without dropping frames', () => {
  const tags = protocolFrameTags();
  const cases = caseLabels();
  const expected = tags.filter((tag) => !WS_INTERNAL_TAGS.has(tag));
  // 每个会到达 onFrame 的协议帧都有 case（不丢帧），且没有多余的死 case。
  assert.deepEqual([...new Set(cases)].sort(), [...expected].sort());
  assert.ok(expected.includes('auth_error'), 'auth_error must be in the protocol tag set');
  assert.ok(expected.includes('ysync.update'), 'ysync.update must be in the protocol tag set');
});

test('every onFrame case has a substantive handler (inline or delegated)', () => {
  for (const tag of caseLabels()) {
    const body = caseBody(tag).trim();
    assert.ok(body.length > 0, `${tag} case must not be empty`);
    // case 内允许提前退出（如 prompt_status 的 `if (!ownership) break;`），
    // 但整体必须有 break 且包含实质调用语句——空 case 意味着丢帧。
    assert.match(body, /break;/, `${tag} case must end with a break`);
    const statements = body.replace(/\/\/[^\n]*/g, '').replace(/\{[^{}]*\}/g, ' ');
    assert.match(statements, /(?:set[A-Z]\w*\(|commands\.|handle\w+\(|onAck\(|onActionError\(|applyUpdateFrame\(|invalidateAuthentication\()/,
      `${tag} case must contain a substantive handler call`);
  }
});

test('feature frame cases are handled by their owning module handlers', () => {
  const store = source('store/index.ts');
  for (const [tag, owner] of Object.entries(FEATURE_OWNERS)) {
    const body = caseBody(tag);
    const call = body.match(/(handle[A-Za-z]+)\(frame(?:\s+as\s+[^)]+)?\)/);
    if (tag === 'ysync.update') {
      // Resource documents are offered to their independent reader first;
      // every other Yjs document still goes through the primary DocStore.
      assert.match(body, /handleResourceUpdate\(/, 'ysync.update must route resource documents independently');
      assert.match(body, /store\.applyUpdateFrame\(/, 'ysync.update must go through store.applyUpdateFrame');
      assert.match(source(owner.module), /applyUpdateFrame\(frame: \{ doc: string; update: string \}\)/,
        `${owner.module} must provide applyUpdateFrame`);
    } else if (call) {
      // 拆分后：case 委托给模块 handler，模块必须导出同名函数。
      assert.equal(call[1], owner.prefix, `${tag} must delegate to ${owner.prefix}(frame)`);
      const moduleText = source(owner.module);
      assert.match(moduleText, new RegExp(`export function ${owner.prefix}\\(`), `${owner.module} must export ${owner.prefix}`);
    } else {
      // 拆分前：case 内联处理（直接操作模块信号或 commands）。
      assert.ok(/\bset[A-Z]\w+\(|commands\.|mcpQueries|rewindQueries|promptRecoveryQueries/.test(body),
        `${tag} case must contain an inline handler statement`);
    }
  }
});

test('unknown frames fall through the explicit default branch (protocol evolution)', () => {
  assert.match(onFrameSwitch(), /default:\s*break;?\s*\/\/ 未知帧忽略/);
});

import type { ChatEntry, ToolCallInfo } from '@/entities/chat/chat-view';
import type { ControlView, PendingPermission } from '@/entities/chat/control-view';
import { setConnState, setPromptDeliveryReady } from '@/features/connection/connection';
import { setChatEntries, setChatHead, setPermissions } from '@/store';

export type VisualToolAcceptancePhase =
  | 'semantic'
  | 'tool-only'
  | 'permission-first'
  | 'completed-gap'
  | 'next-delta'
  | 'disconnected'
  | 'recovered';

interface ToolAcceptanceFixture {
  control: (active?: boolean) => ControlView;
  entries: readonly ChatEntry[];
  permissions: readonly PendingPermission[];
  tool: (overrides: Partial<ToolCallInfo>) => ToolCallInfo;
}

/** 浏览器验收桥：安装静态页面难以通过点击抵达的工具与加载边界。 */
export function setVisualToolAcceptancePhase(
  phase: VisualToolAcceptancePhase,
  fixture: ToolAcceptanceFixture,
): void {
  const active = fixture.control(true);
  const loadingHead: ControlView = {
    ...active,
    chat: active.chat ? { ...active.chat, loading: true } : null,
    activeTurn: active.activeTurn
      ? { ...active.activeTurn, turnId: 'turn-tool-acceptance', turnStatus: 'running' }
      : null,
    pendingPermissions: [],
  };
  const user = {
    ...fixture.entries[0],
    id: 'entry-tool-acceptance-user',
    turnId: 'turn-tool-acceptance',
    toolCalls: [],
    resources: [],
  };
  const acceptanceTool = (overrides: Partial<ToolCallInfo>): ToolCallInfo => fixture.tool({
    toolCallId: 'acceptance-tool',
    name: 'Read',
    status: 'running',
    arguments: null,
    result: null,
    resultOmitted: null,
    resultBytes: null,
    completedAt: null,
    ...overrides,
  });
  const assistant = (tools: ToolCallInfo[], status = 'streaming'): ChatEntry => ({
    ...fixture.entries[1],
    id: 'entry-tool-acceptance-assistant',
    turnId: 'turn-tool-acceptance',
    status,
    completedAt: status === 'completed' ? '2026-08-14T00:03:30Z' : null,
    text: '',
    reasoning: [],
    toolCalls: tools,
    resources: [],
    error: null,
  });

  if (phase === 'semantic') {
    setChatEntries([user, assistant([
      acceptanceTool({ toolCallId: 'acceptance-browser', name: 'Browser', kind: 'fetch', status: 'completed', arguments: { url: 'https://example.test/docs' }, result: { title: 'Protocol docs', content: 'browser result sentinel' }, content: [{ type: 'text', text: 'official content sentinel' }], locations: [{ path: 'docs/protocol.md', line: 17 }], resultOmitted: false, resultBytes: 62, completedAt: '2026-08-14T00:02:01Z' }),
      acceptanceTool({ toolCallId: 'acceptance-mcp', name: 'mcp__registry__lookup', kind: 'other', status: 'completed', arguments: { query: 'tool evidence' }, result: { content: [{ type: 'text', text: 'mcp result sentinel' }] }, resultOmitted: false, resultBytes: 54, completedAt: '2026-08-14T00:02:01Z' }),
      acceptanceTool({ toolCallId: 'acceptance-open', name: 'Open', kind: 'fetch', status: 'completed', arguments: { target: 'https://example.test/open' }, result: { title: 'Opened page', content: 'open result sentinel' }, resultOmitted: false, resultBytes: 58, completedAt: '2026-08-14T00:02:01Z' }),
      acceptanceTool({ toolCallId: 'acceptance-bash', name: 'Bash', kind: 'execute', status: 'failed', arguments: { command: 'printf bash-input-sentinel' }, result: { stdout: 'bash stdout sentinel', stderr: 'bash stderr sentinel', exitCode: 7 }, resultOmitted: false, resultBytes: 75, publicError: { code: 'EXIT_7', message: 'command failed' }, completedAt: '2026-08-14T00:02:01Z' }),
      acceptanceTool({ toolCallId: 'acceptance-read', name: 'Read', kind: 'read', status: 'completed', arguments: { file_path: '/workspace/read-sentinel.ts' }, result: { content: [{ type: 'text', text: 'read content sentinel' }] }, resultOmitted: false, resultBytes: 51, completedAt: '2026-08-14T00:02:01Z' }),
      acceptanceTool({ toolCallId: 'acceptance-edit', name: 'Edit', kind: 'edit', status: 'completed', arguments: { file_path: '/workspace/edit-sentinel.ts', old_string: 'before sentinel', new_string: 'after sentinel' }, result: { changed: true, message: 'edit result sentinel' }, resultOmitted: false, resultBytes: 47, completedAt: '2026-08-14T00:02:01Z' }),
      acceptanceTool({ toolCallId: 'acceptance-write', name: 'Write', kind: 'edit', status: 'completed', arguments: { file_path: '/workspace/write-sentinel.ts', content: 'write input sentinel' }, result: { bytes: 20, message: 'write result sentinel' }, resultOmitted: false, resultBytes: 48, completedAt: '2026-08-14T00:02:01Z' }),
    ])]);
    setChatHead({
      ...loadingHead,
      chat: loadingHead.chat ? { ...loadingHead.chat, loading: false } : null,
      activeTurn: null,
    });
    setPermissions([]);
    return;
  }

  if (phase === 'permission-first') {
    const permission = {
      ...fixture.permissions[0],
      queueKey: 'acceptance-permission',
      permissionId: 'acceptance-permission',
      turnId: 'turn-tool-acceptance',
      toolCallId: 'acceptance-permission-tool',
    };
    setChatEntries([user]);
    setChatHead({
      ...loadingHead,
      pendingPermissions: [permission],
      activeTurn: loadingHead.activeTurn
        ? { ...loadingHead.activeTurn, turnStatus: 'awaitingPermission' }
        : null,
    });
    setPermissions([permission]);
    return;
  }

  const terminalTool = phase === 'completed-gap' || phase === 'next-delta' || phase === 'recovered';
  const terminalEntry = phase === 'completed-gap' || phase === 'recovered';
  const currentTool = acceptanceTool(terminalTool
    ? { status: 'completed', result: { stdout: 'completed before next delta' }, resultOmitted: false, resultBytes: 34, completedAt: '2026-08-14T00:02:01Z' }
    : {});
  const projectedAssistant = assistant([currentTool], terminalEntry ? 'completed' : 'streaming');
  setChatEntries([
    user,
    phase === 'next-delta' ? { ...projectedAssistant, text: 'next delta sentinel' } : projectedAssistant,
  ]);
  setChatHead(phase === 'recovered' ? fixture.control(false) : loadingHead);
  setPermissions([]);
  if (phase === 'disconnected') {
    setConnState({ text: 'Connection interrupted', kind: 'err' });
    setPromptDeliveryReady(false);
  } else if (phase === 'recovered') {
    setConnState({ text: 'Local server connected', kind: 'ok' });
    setPromptDeliveryReady(true);
  }
}

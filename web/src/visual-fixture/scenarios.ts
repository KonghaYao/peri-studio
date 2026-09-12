import type { ChatEntry, ToolCallInfo } from '@/entities/chat/chat-view';
import type { ControlView, PendingPermission } from '@/entities/chat/control-view';
import type { ProjectInfo, ProjectSessionInfo, SessionSummaryInfo } from '@/entities/registry/registry-view';
import { setMcpAuthorization, setMcpOAuthEvents, setMcpServers } from '@/features/mcp/mcp';
import { setConnState, setPromptDeliveryReady } from '@/features/connection/connection';
import {
  resetAuthenticatedSession,
  setChatEntries,
  setChatHead,
  setChatStatusSignal,
  setElicitations,
  setImportableSessions,
  setPermissions,
  setProjects,
  setProjectSessions,
  setRegistryHydrated,
  setRuntimeDocsState,
  setSelectedCid,
  setSelectedSessionId,
} from '@/store';
import { installPrincipalRole } from '@/features/auth/auth-state';
import { acquireFixtureClock } from './fixture-clock';
import { resourceWorkspace, setResourceDiffPreview, setResourceFilePreview, setResourceWorkspace } from '@/features/resource/resource-store';
import type { ResourceDiffPreviewState, ResourceFilePreviewState } from '@/features/resource/resource-preview';
import type { ResourceEntry } from '@/entities/resource/resource-view';
import { markElicitationResponseUncertain, startElicitationResponse } from '@/features/message/elicitation-delivery';
import { setComposerAssets } from '@/features/composer/composer-assets';
import { createLongConversationEntries } from './long-conversation';
import {
  setVisualToolAcceptancePhase as installToolAcceptancePhase,
  type VisualToolAcceptancePhase,
} from './tool-acceptance';

export const VISUAL_NOW = Date.parse('2026-08-14T08:00:00+08:00');
export const DEFAULT_VISUAL_SCENARIO = 'conversation';
export const VISUAL_SCENARIO_IDS = [
  'conversation',
  'long-conversation',
  'markdown',
  'tools',
  'permission-streaming',
  'elicitation',
  'subtasks',
  'resources',
  'assets',
  'terminal-readonly',
  'catalog',
] as const;

/** Browser acceptance bridge; this module shares the fixture's live store graph. */
export function setVisualFilePreview(preview: ResourceFilePreviewState): void {
  setResourceFilePreview(preview);
}

/** 浏览器验收桥：模拟 server 返回 Git diff blob 后的权威预览。 */
export function setVisualDiffPreview(preview: ResourceDiffPreviewState): void {
  setResourceFilePreview(null);
  setResourceDiffPreview(preview);
}

function normalizeResourcePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function resourceEntryFullPath(directory: string, entryPath: string): string {
  const normalized = normalizeResourcePath(entryPath);
  if (!directory) return normalized;
  if (normalized.includes('/')) return normalized;
  return normalizeResourcePath(`${directory}/${normalized}`);
}

function resourceEntryMatchesPath(directory: string, entry: ResourceEntry, target: string): boolean {
  const entryPath = String(entry.path ?? entry.name ?? '');
  if (!entryPath) return false;
  const fullPath = resourceEntryFullPath(directory, entryPath);
  return fullPath === target || fullPath.endsWith(`/${target}`) || target.endsWith(`/${entryPath}`);
}

/** 浏览器验收桥：模拟资源预览期间权威文件树删除来源行。 */
export function removeVisualResourceEntry(path: string): void {
  const target = normalizeResourcePath(path);
  setResourceWorkspace((state) => ({
    ...state,
    directories: Object.fromEntries(Object.entries(state.directories).map(([directory, page]) => [
      directory,
      {
        ...page,
        entries: page.entries.filter((entry) => !resourceEntryMatchesPath(directory, entry, target)),
      },
    ])),
  }));
}

/** 浏览器验收桥：查询 mock 资源树是否仍包含路径。 */
export function visualResourceEntryExists(path: string): boolean {
  const target = normalizeResourcePath(path);
  return Object.entries(resourceWorkspace().directories).some(([directory, page]) => (
    page.entries.some((entry) => resourceEntryMatchesPath(directory, entry, target))
  ));
}

/** 浏览器验收桥：为移动抽屉构造可滚动的深文件列表。 */
export function appendVisualResourceEntries(count: number): void {
  if (!Number.isInteger(count) || count < 0 || count > 100) throw new Error('Invalid resource entry count');
  setResourceWorkspace((state) => {
    const root = state.directories[''];
    if (!root) return state;
    return {
      ...state,
      directories: {
        ...state.directories,
        '': {
          ...root,
          entries: [...root.entries, ...Array.from({ length: count }, (_, index) => ({
            id: `fixture-${index}`,
            name: `fixture-${index}.ts`,
            path: `fixtures/fixture-${index}.ts`,
            kind: 'file' as const,
          }))],
        },
      },
    };
  });
}

/** 浏览器验收桥：只用于验证长会话的有界窗口。 */
export function setVisualTranscriptCount(count: number): void {
  if (!Number.isInteger(count) || count < 0 || count > 5_000) throw new Error('Invalid visual transcript count');
  setChatEntries(Array.from({ length: count }, (_, index): ChatEntry => ({
    id: `visual-entry-${index}`,
    turnId: `visual-turn-${index}`,
    kind: 'message',
    role: index % 2 === 0 ? 'user' : 'assistant',
    status: 'completed',
    authorUserId: index % 2 === 0 ? 'fixture-user' : null,
    sourceCommandId: index % 2 === 0 ? `visual-command-${index}` : null,
    createdAt: '2026-08-14T00:00:00Z',
    completedAt: '2026-08-14T00:00:01Z',
    text: `Transcript message ${index}`,
    blocks: [],
    reasoning: [],
    toolCalls: [],
    resources: [],
    error: null,
  })));
}

/** 浏览器验收桥：模拟原回答已经越过不可重放边界但结果未知。 */
export function setVisualElicitationUnknown(elicitationId: string): void {
  const commandId = `visual-unknown-${elicitationId}`;
  startElicitationResponse(elicitationId, commandId);
  markElicitationResponseUncertain(commandId, 'delivery_unknown');
}

export function setVisualToolAcceptancePhase(phase: VisualToolAcceptancePhase): void {
  installToolAcceptancePhase(phase, { control, entries, permissions, tool });
}
export type VisualScenarioId = typeof VISUAL_SCENARIO_IDS[number];
export type FixtureControlMode = 'display-only' | 'locally-interactive' | 'production-gated';

export interface VisualScenarioDefinition {
  id: VisualScenarioId;
  label: string;
  description: string;
  controls: FixtureControlMode;
}

export const visualScenarios: readonly VisualScenarioDefinition[] = [
  { id: 'conversation', label: 'Basic conversation', description: 'Message rhythm and assistant response.', controls: 'locally-interactive' },
  { id: 'long-conversation', label: 'Long conversation', description: 'Windowed history and return to latest.', controls: 'display-only' },
  { id: 'markdown', label: 'Markdown', description: 'Headings, tables, code, math, and diagrams.', controls: 'locally-interactive' },
  { id: 'tools', label: 'Tool calls', description: 'Running, completed, and failed operations.', controls: 'display-only' },
  { id: 'permission-streaming', label: 'Permissions', description: 'Risk details and decision boundaries.', controls: 'production-gated' },
  { id: 'elicitation', label: 'Questions', description: 'Choice navigation and structured answers.', controls: 'locally-interactive' },
  { id: 'subtasks', label: 'Subtasks', description: 'Parallel agent progress and summary.', controls: 'display-only' },
  { id: 'resources', label: 'Files & references', description: 'Explorer, Git changes, and cited files.', controls: 'locally-interactive' },
  { id: 'assets', label: 'Assets & components', description: 'Images, diagrams, and embedded previews.', controls: 'locally-interactive' },
  { id: 'terminal-readonly', label: 'Error recovery', description: 'Interrupted runtime and verified history.', controls: 'locally-interactive' },
  { id: 'catalog', label: 'Empty state', description: 'First action with no active conversation.', controls: 'locally-interactive' },
] as const;

const projects: ProjectInfo[] = [
  { id: 'project-perihelion', name: 'Perihelion', cwd: '/workspace/perihelion', instanceId: 'local', createdAt: '2026-08-01T02:00:00Z', updatedAt: '2026-08-14T00:00:00Z', archivedAt: null },
  { id: 'project-protocol-lab', name: 'ACP Protocol Lab', cwd: '/workspace/protocol-lab', instanceId: 'local', createdAt: '2026-07-20T02:00:00Z', updatedAt: '2026-08-13T02:00:00Z', archivedAt: null },
  { id: 'project-archive', name: '2025 experiments', cwd: '/workspace/archive', instanceId: 'local', createdAt: '2025-12-01T02:00:00Z', updatedAt: '2026-06-01T02:00:00Z', archivedAt: '2026-07-01T02:00:00Z' },
];

const sessions: ProjectSessionInfo[] = [
  { id: 'acp-thread-01J5WORLDCLASSCURRENT', projectId: 'project-perihelion', title: 'Refactor ACP session recovery and projection boundaries', lifecycle: 'ready', updatedAt: '2026-08-14T00:00:00Z', lastOpenedAt: '2026-08-14T00:00:00Z', activeChatId: 'chat-current', archivedAt: null },
  { id: 'acp-thread-01J5IDLESESSION', projectId: 'project-perihelion', title: 'Audit tool-call readability', lifecycle: 'ready', updatedAt: '2026-08-13T03:00:00Z', lastOpenedAt: '2026-08-13T03:00:00Z', activeChatId: null, archivedAt: null },
  { id: 'session-reconcile', projectId: 'project-perihelion', title: 'Creation result needs manual reconciliation', lifecycle: 'reconciliation_required', updatedAt: '2026-08-12T04:00:00Z', lastOpenedAt: null, activeChatId: null, archivedAt: null },
  { id: 'acp-thread-01J5PROTOCOL', projectId: 'project-protocol-lab', title: 'Wire contract compatibility', lifecycle: 'ready', updatedAt: '2026-08-10T05:00:00Z', lastOpenedAt: '2026-08-10T05:00:00Z', activeChatId: null, archivedAt: null },
  { id: 'acp-thread-01J5ARCHIVED', projectId: 'project-perihelion', title: 'Legacy UI comparison record', lifecycle: 'ready', updatedAt: '2026-07-04T05:00:00Z', lastOpenedAt: '2026-07-04T05:00:00Z', activeChatId: null, archivedAt: '2026-08-01T05:00:00Z' },
];

const tool = (overrides: Partial<ToolCallInfo>): ToolCallInfo => ({
  toolCallId: 'tool-01J5READ', name: 'Read', kind: 'read', status: 'completed', arguments: { path: 'peri-studio/server/src/control/hub.rs' }, result: { lines: 184, note: 'startup restores metadata before accepting connections' }, resultOmitted: false, resultBytes: 118, publicError: null, startedAt: '2026-08-14T00:02:00Z', completedAt: '2026-08-14T00:02:01.480Z', ...overrides,
});

const entries: ChatEntry[] = [
  { id: 'entry-user-1', turnId: 'turn-1', kind: 'message', role: 'user', status: 'completed', authorUserId: 'local-user', sourceCommandId: 'command-user-1', createdAt: '2026-08-14T00:01:00Z', completedAt: '2026-08-14T00:01:00Z', text: 'Check the session recovery path so a restart never treats an old runtime as still alive.', blocks: [], reasoning: [], toolCalls: [], resources: [], error: null },
  { id: 'entry-assistant-1', turnId: 'turn-1', kind: 'message', role: 'assistant', status: 'completed', authorUserId: null, sourceCommandId: null, createdAt: '2026-08-14T00:01:02Z', completedAt: '2026-08-14T00:03:30Z', text: '## Conclusion\n\nThe recovery model needs three distinct concepts:\n\n- `project session`: persistent entry\n- `ACP session`: loadable thread\n- `runtime chat`: one process activation\n\n```rust\nif binding.is_stale() {\n    activate_with_session_load(acp_session_id).await?;\n}\n```\n\nFull constraints are recorded in [architecture.md](https://example.test/architecture).', blocks: [], reasoning: [{ text: 'First verify the metadata authority, then check the Registry read-only projection and session/load ordering.', visibility: 'user' }], toolCalls: [tool({}), tool({ toolCallId: 'tool-01J5LARGE', name: 'cargo test', kind: 'execute', result: null, resultOmitted: true, resultBytes: 2_451_880, arguments: { package: 'peri-studio-server', test: 'restart_restores_project_session' } })], resources: [{ resourceId: 'resource://architecture-contract', mediaType: 'text/markdown', name: 'Session recovery architecture contract' }], error: null },
  { id: 'entry-user-2', turnId: 'turn-2', kind: 'message', role: 'user', status: 'completed', authorUserId: 'local-user', sourceCommandId: 'command-user-2', createdAt: '2026-08-14T00:05:00Z', completedAt: '2026-08-14T00:05:00Z', text: 'Continue verifying failure paths and public errors.', blocks: [], reasoning: [], toolCalls: [], resources: [], error: null },
  { id: 'entry-assistant-2', turnId: 'turn-2', kind: 'message', role: 'assistant', status: 'failed', authorUserId: null, sourceCommandId: null, createdAt: '2026-08-14T00:05:02Z', completedAt: '2026-08-14T00:05:20Z', text: 'A failed database write never sends a committed Ack.', blocks: [], reasoning: [], toolCalls: [tool({ toolCallId: 'tool-01J5FAIL', name: 'Finalize metadata', status: 'failed', result: null, resultOmitted: false, publicError: { code: 'METADATA_UNAVAILABLE', message: 'metadata transaction could not be committed' } })], resources: [], error: { code: 'METADATA_UNAVAILABLE', message: 'Session metadata is temporarily unavailable; reconciliation state is preserved.' } },
];

const markdownEntry: ChatEntry = {
  id: 'entry-markdown', turnId: 'turn-markdown', kind: 'message', role: 'assistant', status: 'completed', authorUserId: null, sourceCommandId: null,
  origin: 'live', replayVerified: null, createdAt: '2026-08-14T00:12:00Z', completedAt: '2026-08-14T00:12:03Z', blocks: [], reasoning: [], toolCalls: [], resources: [], error: null,
  text: `# Markdown rendering lab

**重要提示（请注意）。**内容继续显示，且 ~~旧结论~~ 已被替换。

> [!NOTE]
> Streaming content stays readable while syntax is incomplete.

| Capability | State | Notes |
| :--- | :---: | ---: |
| GFM table | Ready | Responsive |
| Math | Ready | Accessible |

- [x] Parse CommonMark and GFM
- [x] Protect remote images
- [ ] Review the final diagram

Inline math $$x^2 + y^2$$ stays in the sentence.

$$
E = mc^2
$$

\`\`\`ts startLine=7 filename=recovery.ts
type Result = { ok: boolean };
const result: Result = { ok: true };
console.log(result);
\`\`\`

\`\`\`mermaid
flowchart LR
  Input --> Parse --> Render
\`\`\`

![Architecture](https://example.test/architecture.png)

Footnotes remain compact.[^security]

[^security]: Generated content is treated as untrusted input.`,
};

const basicEntries: ChatEntry[] = [
  { ...entries[0], id: 'entry-basic-user', turnId: 'turn-basic', text: 'Review the login page build failure and verify the smallest safe fix.', toolCalls: [], resources: [] },
  { ...entries[1], id: 'entry-basic-assistant', turnId: 'turn-basic', text: 'The failure comes from a browser-only import crossing the build boundary. I isolated the import and verified the production bundle.', reasoning: [{ text: 'Check the build entry first, then constrain the fix to the browser adapter.', visibility: 'user' }], toolCalls: [], resources: [] },
];

const longConversationEntries = createLongConversationEntries([entries[0], entries[1]]);

const toolEntries: ChatEntry[] = [
  { ...entries[0], id: 'entry-tools-user', turnId: 'turn-tools', text: 'Inspect the build boundary, update the adapter, and run the focused checks.', toolCalls: [], resources: [] },
  { ...entries[1], id: 'entry-tools-assistant', turnId: 'turn-tools', status: 'streaming', completedAt: null, text: 'The browser entry is isolated. The production build is still running.', reasoning: [], resources: [], error: null, toolCalls: [
    tool({ toolCallId: 'tool-read-config', name: 'Read build configuration', kind: 'read', arguments: { path: 'vite.config.ts' }, result: { lines: 84 }, resultBytes: 74 }),
    tool({ toolCallId: 'tool-search-import', name: 'Search unsafe import', kind: 'search', arguments: { query: 'node:crypto', path: 'web/src' }, result: { matches: 3 }, resultBytes: 96 }),
    tool({ toolCallId: 'tool-build-running', name: 'Run production build', kind: 'execute', status: 'running', arguments: { command: 'bun run build:web' }, result: null, resultOmitted: null, resultBytes: null, completedAt: null }),
    tool({ toolCallId: 'tool-old-failure', name: 'Previous build attempt', kind: 'execute', status: 'failed', arguments: { command: 'bun run build:web' }, result: null, publicError: { code: 'BUILD_IMPORT_ERROR', message: 'Browser bundle imported a Node-only module' }, completedAt: '2026-08-14T00:01:30Z' }),
  ] },
];

const assetEntry: ChatEntry = {
  ...markdownEntry,
  id: 'entry-assets',
  turnId: 'turn-assets',
  text: `## Interface assets

The diagram stays interactive while remote images wait for explicit approval.

\`\`\`mermaid
flowchart LR
  Prompt --> Component --> Preview
\`\`\`

![Workspace preview](https://example.test/workspace-preview.png)

| Asset | Delivery |
| --- | --- |
| Diagram | Inline SVG |
| Preview image | Consent gated |
| Component spec | Attached resource |`,
  resources: [{ resourceId: 'resource://component-spec', mediaType: 'text/markdown', name: 'Composer component specification' }],
};

for (const entry of entries.slice(0, 2)) {
  entry.origin = 'session_replay';
  entry.replayVerified = true;
}
for (const entry of entries.slice(2)) {
  entry.origin = 'live';
  entry.replayVerified = null;
}

const permissionDeadline = (offsetMinutes: number) => new Date(VISUAL_NOW + offsetMinutes * 60_000).toISOString();
const permissions: PendingPermission[] = [
  { queueKey: 'permission-write', permissionId: 'permission-write', turnId: 'turn-stream', toolCallId: 'tool-write', title: 'Modify workspace file', description: 'Agent requests an update to the Peri Studio Web visual regression scenario.', options: ['allowOnce', 'allowSession', 'deny'], status: 'pending', expiresAt: permissionDeadline(5), decision: null },
  { queueKey: 'permission-command', permissionId: 'permission-command', turnId: 'turn-stream', toolCallId: 'tool-command', title: 'Run test command', description: 'Runs bun run test without accessing data outside the workspace.', options: ['allowSession', 'deny'], status: 'pending', expiresAt: permissionDeadline(6), decision: null },
];

const elicitations: NonNullable<ControlView['pendingElicitations']> = [{
  elicitationId: 'elicitation-safe-plan',
  message: 'How should we proceed with this refactor?',
  status: 'pending',
  responseAction: null,
  createdAt: '2026-08-14T00:10:30Z',
  fields: [
    { id: 'detail', title: 'Add context', description: 'Tell Peri which constraints must not be broken.', kind: 'text', required: true, options: [] },
    { id: 'mode', title: 'Approach', description: null, kind: 'single_select', required: true, options: [
      { value: 'safe', label: 'Proceed carefully', description: 'Prioritizes compatibility and recovery boundaries' },
      { value: 'fast', label: 'Validate quickly', description: 'Prioritizes the smallest vertical slice' },
    ] },
    { id: 'checks', title: 'Pre-completion checks', description: null, kind: 'multi_select', required: false, options: [
      { value: 'tests', label: 'Run tests', description: null },
      { value: 'lint', label: 'Run static checks', description: null },
    ] },
  ],
}, {
  elicitationId: 'elicitation-release-scope',
  message: 'Which release scope should this change use?',
  status: 'pending',
  responseAction: null,
  createdAt: '2026-08-14T00:10:31Z',
  fields: [{
    id: 'scope', title: 'Release scope', description: null, kind: 'single_select', required: true, options: [
      { value: 'patch', label: 'Patch release', description: 'Ship only the compatible UI change' },
      { value: 'minor', label: 'Minor release', description: 'Include the related workflow improvements' },
    ],
  }],
}];

const importable: SessionSummaryInfo[] = [
  { sessionId: 'acp-thread-01J5IMPORTA', title: 'Investigate registry replay', status: 'ready', updatedAt: '2026-08-13T04:00:00Z', cwd: '/workspace/perihelion' },
  { sessionId: 'acp-thread-01J5IMPORTB', title: 'Review SQLite migration invariants', status: 'ready', updatedAt: '2026-08-12T04:00:00Z', cwd: '/workspace/perihelion' },
];

function control(active = false): ControlView {
  return {
    chat: { chatId: 'chat-current', title: 'Refactor ACP session recovery and projection boundaries', status: 'active', activeTurnId: active ? 'turn-stream' : null, createdAt: '2026-08-14T00:00:00Z', updatedAt: '2026-08-14T00:10:00Z' },
    agent: { instanceId: 'local', sessionId: 'acp-thread-01J5WORLDCLASSCURRENT', status: active ? 'running' : 'ready', lastActivityAt: '2026-08-14T00:10:00Z', availableCommands: ['compact', 'auto-issue-fixer', 'mcp__docs__search'], commandCatalog: [{ name: 'compact', description: 'Compacts the current context', kind: 'command' }, { name: 'auto-issue-fixer', description: 'Tracks and fixes an engineering issue', kind: 'skill' }, { name: 'mcp__docs__search', description: 'Searches project docs', kind: 'mcp_skill' }], extensions: ['peri.tokenStats', 'peri.skillNames', 'peri.agentActivity', 'peri.prediction', 'peri.oauth'], activities: [{ id: 'compact:fixture-compact', kind: 'compact', status: 'completed', label: 'Context compacted intelligently', isBackground: false, metrics: { token_before: 88_000, token_after: 34_500, duration_ms: 1840 }, attributes: { strategy: 'smart', trigger: 'auto' }, createdAt: '2026-08-14T00:08:00Z', updatedAt: '2026-08-14T00:08:02Z' }, { id: 'subagent:fixture-review', kind: 'subagent', status: active ? 'running' : 'completed', label: 'Reviewing recovery path', isBackground: true, metrics: { tool_count: 4 }, attributes: { task_kind: 'agent' }, createdAt: '2026-08-14T00:09:00Z', updatedAt: '2026-08-14T00:10:00Z' }], plan: [{ id: 'plan-1', content: 'Locate the recovery boundary', status: 'completed', activeForm: null }, { id: 'plan-2', content: 'Verify browser projection', status: active ? 'in_progress' : 'completed', activeForm: active ? 'Verifying browser projection' : null }, { id: 'plan-3', content: 'Summarize focused checks', status: active ? 'pending' : 'completed', activeForm: null }], inputPrediction: { id: 'prediction:7:42', text: 'Check the next high-risk boundary', createdAt: '2026-08-14T00:10:01Z' }, latestUsage: { inputTokens: 12_400, outputTokens: 860, cacheCreationTokens: 320, cacheReadTokens: 9_800, requestId: 'fixture-request', model: 'gpt-5.6', stopReason: 'end_turn' }, model: 'gpt-5.6', effort: 'high', configOptions: [{ id: 'mode', name: 'Permission mode', description: 'Controls whether each tool run asks for permission before executing.', category: 'mode', currentValue: 'default', options: [{ value: 'default', name: 'Default', description: 'Dangerous operations ask for confirmation' }, { value: 'bypassPermissions', name: 'Bypass permission prompts', description: 'Skips per-action confirmation in trusted projects' }] }, { id: 'model', name: 'Model', description: null, category: 'model', currentValue: 'gpt-5.6', options: [{ value: 'gpt-5.6', name: 'GPT-5.6', description: 'Good for complex engineering tasks' }, { value: 'gpt-5.6-fast', name: 'GPT-5.6 Fast', description: 'Lower latency' }] }, { id: 'thinking_effort', name: 'Thinking effort', description: null, category: 'thought_level', currentValue: 'high', options: [{ value: 'medium', name: 'Medium', description: null }, { value: 'high', name: 'High', description: null }] }], contextWindow: 200_000, contextUsed: 34_500 },
    activeTurn: active ? { turnId: 'turn-stream', turnStatus: 'awaitingPermission', updatedAt: '2026-08-14T00:10:00Z' } : null,
    pendingPermissions: active ? permissions : [],
  };
}

function seedCatalog(): void {
  setProjects(projects);
  setProjectSessions(sessions);
  // 静态 fixture 已完整安装 Registry 投影，显式标记为已水合以模拟首帧到达。
  setRegistryHydrated(true);
  setImportableSessions(importable);
  setConnState({ text: 'Local server connected', kind: 'ok' });
  setPromptDeliveryReady(true);
  setChatStatusSignal({ 'chat-current': 'active' });
  setComposerAssets([]);
}

function selectConversation(currentEntries = entries, head = control(false)): void {
  setSelectedSessionId('acp-thread-01J5WORLDCLASSCURRENT');
  setSelectedCid('chat-current');
  setRuntimeDocsState({ chat: true, control: true });
  setChatEntries(currentEntries);
  setChatHead(head);
  setPermissions(head.pendingPermissions);
}

export function resolveVisualScenario(value: string | null | undefined): VisualScenarioId {
  return (VISUAL_SCENARIO_IDS as readonly string[]).includes(value || '') ? value as VisualScenarioId : DEFAULT_VISUAL_SCENARIO;
}

/** Installs static render facts only. Transport actions remain production-gated:
 * this fixture never changes store-private `ready` or `currentCid`. */
export function installVisualScenario(value: string | null | undefined): { scenario: VisualScenarioDefinition; dispose: () => void } {
  const id = resolveVisualScenario(value);
  const releaseClock = acquireFixtureClock(VISUAL_NOW);
  try {
    resetAuthenticatedSession();
    installPrincipalRole(id === 'terminal-readonly' ? 'read-only' : 'full');
    seedCatalog();

  if (id === 'conversation') {
    selectConversation(basicEntries);
    setMcpServers([
      { name: 'github', transport: 'streamable-http', connectionStatus: 'disconnected', oauthStatus: 'needs_authorization', activeFlowId: 'flow-fixture', toolsCount: 8, resourcesCount: 2 },
      { name: 'local-docs', transport: 'stdio', connectionStatus: 'connected', oauthStatus: 'authorized', toolsCount: 4, resourcesCount: 12 },
    ]);
    setMcpOAuthEvents({ 'flow-fixture': { chatId: 'chat-current', flowId: 'flow-fixture', serverName: 'github', status: 'authorization_needed', updatedAt: '2026-08-14T00:10:00Z' } });
    setMcpAuthorization({ commandId: 'fixture-auth', chatId: 'chat-current', flowId: 'flow-fixture', authorizationUrl: 'https://example.test/oauth?state=fixture-opaque', expiresAt: '2026-08-14T00:12:00Z' });
  }
  if (id === 'long-conversation') {
    const longControl = control(true);
    selectConversation(longConversationEntries, { ...longControl, pendingPermissions: [], activeTurn: longControl.activeTurn ? { ...longControl.activeTurn, turnStatus: 'running' } : null });
    setResourceWorkspace({ projectId: 'project-perihelion', loading: [], error: null, directories: {}, repositories: [{
      id: 'repo-long', root: '', name: 'peri-studio', headName: 'main', generation: 'long-1', ahead: 0, behind: 0,
      groups: {
        index: { count: 1, revision: 'index-long', changes: [{ id: 'long-a', path: 'web/src/widgets/shell/StatusArea.tsx', status: 'modified' }] },
        working_tree: { count: 2, revision: 'work-long', changes: [{ id: 'long-b', path: 'web/src/widgets/chat/ToolCallActivity.tsx', status: 'modified' }, { id: 'long-c', path: 'web/src/visual-fixture/long-conversation.ts', status: 'untracked' }] },
        untracked: { count: 0, revision: 'new-long', changes: [] },
      },
    }] });
  }
  if (id === 'resources') {
    selectConversation();
    setResourceWorkspace({
      projectId: 'project-perihelion',
      loading: [],
      error: null,
      directories: {
        '': { generation: 'root-1', entries: [
          { id: 'src', name: 'src', path: 'src', kind: 'directory' },
          { id: 'web', name: 'web', path: 'web', kind: 'directory' },
          { id: 'cargo', name: 'Cargo.toml', path: 'Cargo.toml', kind: 'file' },
          { id: 'readme', name: 'README.md', path: 'README.md', kind: 'file' },
        ] },
        src: { generation: 'src-1', entries: [
          { id: 'main', name: 'main.rs', path: 'src/main.rs', kind: 'file' },
          { id: 'lib', name: 'lib.rs', path: 'src/lib.rs', kind: 'file' },
        ] },
      },
      repositories: [{
        id: 'repo-1', root: '', name: 'peri-studio', headName: 'main', generation: 'git-1', ahead: 2, behind: 0,
        groups: {
          index: { count: 1, revision: 'index-1', changes: [{ id: 'c1', path: 'server/src/control/resource_service.rs', status: 'modified' }] },
          working_tree: { count: 2, revision: 'work-1', changes: [
            { id: 'c2', path: 'web/src/widgets/resource/ResourceWorkbench.tsx', status: 'modified' },
            { id: 'c3', path: 'docs/design/remote-fs-git-protocol.md', status: 'modified' },
          ] },
          untracked: { count: 1, revision: 'new-1', changes: [{ id: 'c4', path: 'web/src/entities/resource/resource-view.ts', status: 'untracked' }] },
        },
      }],
    });
  }
  if (id === 'markdown') {
    selectConversation([markdownEntry]);
  }
  if (id === 'tools') {
    const toolsControl = control(true);
    selectConversation(toolEntries, {
      ...toolsControl,
      activeTurn: toolsControl.activeTurn ? { ...toolsControl.activeTurn, turnStatus: 'running' } : null,
      pendingPermissions: [],
    });
  }
  if (id === 'elicitation') {
    selectConversation(entries, control(false));
    setElicitations(elicitations);
  }
  if (id === 'permission-streaming') {
    const streaming = [...entries, { ...entries[1], id: 'entry-stream', turnId: 'turn-stream', status: 'streaming', origin: 'live' as const, replayVerified: null, text: 'Checking permission boundaries and tool call order…', completedAt: null, reasoning: [], toolCalls: [tool({ toolCallId: 'tool-stream', name: 'Apply patch', status: 'awaitingPermission', result: null, resultOmitted: null })], resources: [], error: null }];
    selectConversation(streaming, control(true));
    setElicitations(elicitations.slice(0, 1));
  }
  if (id === 'subtasks') {
    const subtaskControl = control(true);
    selectConversation(basicEntries, {
      ...subtaskControl,
      agent: subtaskControl.agent ? {
        ...subtaskControl.agent,
        activities: [
          { id: 'subagent:fixture-research', kind: 'subagent', status: 'completed', label: 'Mapped the login build boundary', isBackground: true, metrics: { tool_count: 5 }, attributes: { task_kind: 'research' }, createdAt: '2026-08-14T00:07:00Z', updatedAt: '2026-08-14T00:08:00Z' },
          { id: 'workflow:fixture-implementation', kind: 'workflow', status: 'running', label: 'Isolating the browser adapter', isBackground: true, metrics: { tool_count: 3 }, attributes: { task_kind: 'implementation' }, createdAt: '2026-08-14T00:08:00Z', updatedAt: '2026-08-14T00:10:00Z' },
          { id: 'subagent:fixture-review', kind: 'subagent', status: 'info', label: 'Review queued for the production boundary', isBackground: true, metrics: {}, attributes: { task_kind: 'review' }, createdAt: '2026-08-14T00:09:00Z', updatedAt: '2026-08-14T00:09:00Z' },
        ],
      } : null,
      activeTurn: subtaskControl.activeTurn ? { ...subtaskControl.activeTurn, turnStatus: 'running' } : null,
      pendingPermissions: [],
    });
  }
  if (id === 'assets') {
    selectConversation([assetEntry]);
    setComposerAssets([
      { id: 'asset-layout', name: 'chat-layout-reference-final.png', kind: 'image', detail: 'UI reference image', previewUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%2280%22 viewBox=%220 0 120 80%22%3E%3Crect width=%22120%22 height=%2280%22 fill=%22%23f8faf9%22/%3E%3Crect x=%227%22 y=%228%22 width=%2232%22 height=%2264%22 rx=%224%22 fill=%22%23e8f0eb%22/%3E%3Crect x=%2245%22 y=%228%22 width=%2268%22 height=%2210%22 rx=%223%22 fill=%22%23d8e6dd%22/%3E%3Crect x=%2245%22 y=%2225%22 width=%2254%22 height=%224%22 rx=%222%22 fill=%22%2395aa9d%22/%3E%3Crect x=%2245%22 y=%2234%22 width=%2262%22 height=%224%22 rx=%222%22 fill=%22%23c2cec6%22/%3E%3C/svg%3E' },
      { id: 'asset-spec', name: 'status-area.md', kind: 'file', detail: 'Component specification' },
      { id: 'asset-reference', name: 'Reference 1', kind: 'reference', detail: 'Linked conversation context' },
    ]);
  }
  if (id === 'terminal-readonly') {
    selectConversation(entries.slice(0, 2), { ...control(false), chat: { ...control(false).chat!, status: 'crashed' }, agent: { ...control(false).agent!, status: 'offline' } });
    setChatStatusSignal({ 'chat-current': 'crashed' });
  }

    const scenario = visualScenarios.find((item) => item.id === id)!;
    let disposed = false;
    return { scenario, dispose: () => {
      if (disposed) return;
      disposed = true;
      try {
        resetAuthenticatedSession();
      } finally {
        releaseClock();
      }
    } };
  } catch (error) {
    releaseClock();
    throw error;
  }
}

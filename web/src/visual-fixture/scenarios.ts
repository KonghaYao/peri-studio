import type { ChatEntry, ToolCallInfo } from '../panel/lib/chat-view';
import type { ControlView, PendingPermission } from '../panel/lib/control-view';
import type { ProjectInfo, ProjectSessionInfo, SessionSummaryInfo } from '../panel/lib/registry-view';
import { setMcpAuthorization, setMcpOAuthEvents, setMcpServers } from '../panel/lib/mcp';
import { setConnState, setPromptDeliveryReady } from '../panel/lib/connection';
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
} from '../panel/store';
import { installPrincipalRole } from '../panel/lib/auth-state';
import { acquireFixtureClock } from './fixture-clock';
import { setResourceDiffPreview, setResourceFilePreview, setResourceWorkspace } from '../panel/lib/resource-store';
import type { ResourceFilePreviewState } from '../panel/lib/resource-preview';

export const VISUAL_NOW = Date.parse('2026-08-14T08:00:00+08:00');
export const DEFAULT_VISUAL_SCENARIO = 'conversation';
export const VISUAL_SCENARIO_IDS = ['catalog', 'conversation', 'resources', 'markdown', 'elicitation', 'permission-streaming', 'terminal-readonly'] as const;

/** Browser acceptance bridge; this module shares the fixture's live store graph. */
export function setVisualFilePreview(preview: ResourceFilePreviewState): void {
  setResourceFilePreview(preview);
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
  { id: 'catalog', label: 'Catalog & Quick Start', description: 'Multiple projects, empty state, and no session selected.', controls: 'locally-interactive' },
  { id: 'conversation', label: 'Full Conversation', description: 'Markdown, tools, resources, and long content.', controls: 'locally-interactive' },
  { id: 'resources', label: 'Explorer & Git', description: 'Remote file tree and Source Control resource projections.', controls: 'locally-interactive' },
  { id: 'markdown', label: 'Markdown Lab', description: 'GFM, code, math, diagrams, and remote media safety.', controls: 'locally-interactive' },
  { id: 'elicitation', label: 'Questions', description: 'Agent questions, mixed answer fields, and compact response controls.', controls: 'locally-interactive' },
  { id: 'permission-streaming', label: 'Permissions & Streaming', description: 'Active turn, permission queue, and stop control.', controls: 'production-gated' },
  { id: 'terminal-readonly', label: 'Terminal Read-only', description: 'Crashed runtime, archived sessions, and read-only role.', controls: 'locally-interactive' },
] as const;

const projects: ProjectInfo[] = [
  { id: 'project-perihelion', name: 'Perihelion', cwd: '/workspace/perihelion', instanceId: 'local', createdAt: '2026-08-01T02:00:00Z', updatedAt: '2026-08-14T00:00:00Z', archivedAt: null },
  { id: 'project-protocol-lab', name: 'ACP Protocol Lab', cwd: '/workspace/protocol-lab', instanceId: 'local', createdAt: '2026-07-20T02:00:00Z', updatedAt: '2026-08-13T02:00:00Z', archivedAt: null },
  { id: 'project-archive', name: '2025 experiments', cwd: '/workspace/archive', instanceId: 'local', createdAt: '2025-12-01T02:00:00Z', updatedAt: '2026-06-01T02:00:00Z', archivedAt: '2026-07-01T02:00:00Z' },
];

const sessions: ProjectSessionInfo[] = [
  { id: 'session-current', projectId: 'project-perihelion', acpSessionId: 'acp-thread-01J5WORLDCLASSCURRENT', title: 'Refactor ACP session recovery and projection boundaries', lifecycle: 'ready', updatedAt: '2026-08-14T00:00:00Z', lastOpenedAt: '2026-08-14T00:00:00Z', activeChatId: 'chat-current', archivedAt: null },
  { id: 'session-idle', projectId: 'project-perihelion', acpSessionId: 'acp-thread-01J5IDLESESSION', title: 'Audit tool-call readability', lifecycle: 'ready', updatedAt: '2026-08-13T03:00:00Z', lastOpenedAt: '2026-08-13T03:00:00Z', activeChatId: null, archivedAt: null },
  { id: 'session-reconcile', projectId: 'project-perihelion', acpSessionId: null, title: 'Creation result needs manual reconciliation', lifecycle: 'reconciliation_required', updatedAt: '2026-08-12T04:00:00Z', lastOpenedAt: null, activeChatId: null, archivedAt: null },
  { id: 'session-protocol', projectId: 'project-protocol-lab', acpSessionId: 'acp-thread-01J5PROTOCOL', title: 'Wire contract compatibility', lifecycle: 'ready', updatedAt: '2026-08-10T05:00:00Z', lastOpenedAt: '2026-08-10T05:00:00Z', activeChatId: null, archivedAt: null },
  { id: 'session-archived', projectId: 'project-perihelion', acpSessionId: 'acp-thread-01J5ARCHIVED', title: 'Legacy UI comparison record', lifecycle: 'ready', updatedAt: '2026-07-04T05:00:00Z', lastOpenedAt: '2026-07-04T05:00:00Z', activeChatId: null, archivedAt: '2026-08-01T05:00:00Z' },
];

const tool = (overrides: Partial<ToolCallInfo>): ToolCallInfo => ({
  toolCallId: 'tool-01J5READ', name: 'Read', status: 'completed', arguments: { path: 'peri-studio/server/src/control/hub.rs' }, result: { lines: 184, note: 'startup restores metadata before accepting connections' }, resultOmitted: false, resultBytes: 118, publicError: null, startedAt: '2026-08-14T00:02:00Z', completedAt: '2026-08-14T00:02:01.480Z', ...overrides,
});

const entries: ChatEntry[] = [
  { id: 'entry-user-1', turnId: 'turn-1', kind: 'message', role: 'user', status: 'completed', authorUserId: 'local-user', sourceCommandId: 'command-user-1', createdAt: '2026-08-14T00:01:00Z', completedAt: '2026-08-14T00:01:00Z', text: 'Check the session recovery path so a restart never treats an old runtime as still alive.', reasoning: [], toolCalls: [], resources: [], error: null },
  { id: 'entry-assistant-1', turnId: 'turn-1', kind: 'message', role: 'assistant', status: 'completed', authorUserId: null, sourceCommandId: null, createdAt: '2026-08-14T00:01:02Z', completedAt: '2026-08-14T00:03:30Z', text: '## Conclusion\n\nThe recovery model needs three distinct concepts:\n\n- `project session`: persistent entry\n- `ACP session`: loadable thread\n- `runtime chat`: one process activation\n\n```rust\nif binding.is_stale() {\n    activate_with_session_load(acp_session_id).await?;\n}\n```\n\nFull constraints are recorded in [architecture.md](https://example.test/architecture).', reasoning: [{ text: 'First verify the metadata authority, then check the Registry read-only projection and session/load ordering.', visibility: 'user' }], toolCalls: [tool({}), tool({ toolCallId: 'tool-01J5LARGE', name: 'cargo test', result: null, resultOmitted: true, resultBytes: 2_451_880, arguments: { package: 'peri-studio-server', test: 'restart_restores_project_session' } })], resources: [{ resourceId: 'resource://architecture-contract', mediaType: 'text/markdown', name: 'Session recovery architecture contract' }], error: null },
  { id: 'entry-user-2', turnId: 'turn-2', kind: 'message', role: 'user', status: 'completed', authorUserId: 'local-user', sourceCommandId: 'command-user-2', createdAt: '2026-08-14T00:05:00Z', completedAt: '2026-08-14T00:05:00Z', text: 'Continue verifying failure paths and public errors.', reasoning: [], toolCalls: [], resources: [], error: null },
  { id: 'entry-assistant-2', turnId: 'turn-2', kind: 'message', role: 'assistant', status: 'failed', authorUserId: null, sourceCommandId: null, createdAt: '2026-08-14T00:05:02Z', completedAt: '2026-08-14T00:05:20Z', text: 'A failed database write never sends a committed Ack.', reasoning: [], toolCalls: [tool({ toolCallId: 'tool-01J5FAIL', name: 'Finalize metadata', status: 'failed', result: null, resultOmitted: false, publicError: { code: 'METADATA_UNAVAILABLE', message: 'metadata transaction could not be committed' } })], resources: [], error: { code: 'METADATA_UNAVAILABLE', message: 'Session metadata is temporarily unavailable; reconciliation state is preserved.' } },
];

const markdownEntry: ChatEntry = {
  id: 'entry-markdown', turnId: 'turn-markdown', kind: 'message', role: 'assistant', status: 'completed', authorUserId: null, sourceCommandId: null,
  origin: 'live', replayVerified: null, createdAt: '2026-08-14T00:12:00Z', completedAt: '2026-08-14T00:12:03Z', reasoning: [], toolCalls: [], resources: [], error: null,
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

for (const entry of entries.slice(0, 2)) {
  entry.origin = 'session_replay';
  entry.replayVerified = true;
}
for (const entry of entries.slice(2)) {
  entry.origin = 'live';
  entry.replayVerified = null;
}

const permissions: PendingPermission[] = [
  { permissionId: 'permission-write', turnId: 'turn-stream', toolCallId: 'tool-write', title: 'Modify workspace file', description: 'Agent requests an update to the Peri Studio Web visual regression scenario.', status: 'pending', expiresAt: '2026-08-14T00:30:00Z', decision: null },
  { permissionId: 'permission-command', turnId: 'turn-stream', toolCallId: 'tool-command', title: 'Run test command', description: 'Runs bun run test without accessing data outside the workspace.', status: 'pending', expiresAt: '2026-08-14T00:31:00Z', decision: null },
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
    agent: { instanceId: 'local', sessionId: 'acp-thread-01J5WORLDCLASSCURRENT', status: active ? 'running' : 'ready', lastActivityAt: '2026-08-14T00:10:00Z', availableCommands: ['compact', 'auto-issue-fixer', 'mcp__docs__search'], commandCatalog: [{ name: 'compact', description: 'Compacts the current context', kind: 'command' }, { name: 'auto-issue-fixer', description: 'Tracks and fixes an engineering issue', kind: 'skill' }, { name: 'mcp__docs__search', description: 'Searches project docs', kind: 'mcp_skill' }], extensions: ['peri.tokenStats', 'peri.skillNames', 'peri.agentActivity', 'peri.prediction', 'peri.oauth'], activities: [{ id: 'compact:fixture-compact', kind: 'compact', status: 'completed', label: 'Context compacted intelligently', isBackground: false, metrics: { token_before: 88_000, token_after: 34_500, duration_ms: 1840 }, attributes: { strategy: 'smart', trigger: 'auto' }, createdAt: '2026-08-14T00:08:00Z', updatedAt: '2026-08-14T00:08:02Z' }, { id: 'subagent:fixture-review', kind: 'subagent', status: active ? 'running' : 'completed', label: 'Reviewing recovery path', isBackground: true, metrics: { tool_count: 4 }, attributes: { task_kind: 'agent' }, createdAt: '2026-08-14T00:09:00Z', updatedAt: '2026-08-14T00:10:00Z' }], inputPrediction: { id: 'prediction:7:42', text: 'Check the next high-risk boundary', createdAt: '2026-08-14T00:10:01Z' }, latestUsage: { inputTokens: 12_400, outputTokens: 860, cacheCreationTokens: 320, cacheReadTokens: 9_800, requestId: 'fixture-request', model: 'gpt-5.6', stopReason: 'end_turn' }, model: 'gpt-5.6', effort: 'high', configOptions: [{ id: 'mode', name: 'Permission mode', description: 'Controls whether each tool run asks for permission before executing.', category: 'mode', currentValue: 'default', options: [{ value: 'default', name: 'Default', description: 'Dangerous operations ask for confirmation' }, { value: 'bypassPermissions', name: 'Bypass permission prompts', description: 'Skips per-action confirmation in trusted projects' }] }, { id: 'model', name: 'Model', description: null, category: 'model', currentValue: 'gpt-5.6', options: [{ value: 'gpt-5.6', name: 'GPT-5.6', description: 'Good for complex engineering tasks' }, { value: 'gpt-5.6-fast', name: 'GPT-5.6 Fast', description: 'Lower latency' }] }, { id: 'thinking_effort', name: 'Thinking effort', description: null, category: 'thought_level', currentValue: 'high', options: [{ value: 'medium', name: 'Medium', description: null }, { value: 'high', name: 'High', description: null }] }], contextWindow: 200_000, contextUsed: 34_500 },
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
}

function selectConversation(currentEntries = entries, head = control(false)): void {
  setSelectedSessionId('session-current');
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
    selectConversation();
    setMcpServers([
      { name: 'github', transport: 'streamable-http', connectionStatus: 'disconnected', oauthStatus: 'needs_authorization', activeFlowId: 'flow-fixture', toolsCount: 8, resourcesCount: 2 },
      { name: 'local-docs', transport: 'stdio', connectionStatus: 'connected', oauthStatus: 'authorized', toolsCount: 4, resourcesCount: 12 },
    ]);
    setMcpOAuthEvents({ 'flow-fixture': { chatId: 'chat-current', flowId: 'flow-fixture', serverName: 'github', status: 'authorization_needed', updatedAt: '2026-08-14T00:10:00Z' } });
    setMcpAuthorization({ commandId: 'fixture-auth', chatId: 'chat-current', flowId: 'flow-fixture', authorizationUrl: 'https://example.test/oauth?state=fixture-opaque', expiresAt: '2026-08-14T00:12:00Z' });
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
            { id: 'c2', path: 'web/src/panel/components/ResourceWorkbench.tsx', status: 'modified' },
            { id: 'c3', path: 'docs/design/remote-fs-git-protocol.md', status: 'modified' },
          ] },
          untracked: { count: 1, revision: 'new-1', changes: [{ id: 'c4', path: 'web/src/panel/lib/resource-view.ts', status: 'untracked' }] },
        },
      }],
    });
    setResourceDiffPreview({
      requestId: 'fixture-diff', repoId: 'repo-1', groupId: 'working_tree', changeId: 'c2',
      path: 'web/src/panel/components/ResourceWorkbench.tsx', status: 'modified', loading: false,
      text: [
        'diff --git a/web/src/panel/components/ResourceWorkbench.tsx b/web/src/panel/components/ResourceWorkbench.tsx',
        '--- a/web/src/panel/components/ResourceWorkbench.tsx',
        '+++ b/web/src/panel/components/ResourceWorkbench.tsx',
        '@@ -12,3 +12,4 @@ export function ResourceWorkbench() {',
        '   const [view, setView] = createSignal<WorkbenchView>(\'explorer\');',
        '-  const width = view() ? 300 : 46;',
        '+  const width = view() ? 310 : 46;',
        '+  const label = view() === \'scm\' ? \'Source Control\' : \'Explorer\';',
        '   return <aside style={{ width: `${width}px` }} />;',
        '',
      ].join('\n'),
    });
  }
  if (id === 'markdown') {
    selectConversation([markdownEntry]);
  }
  if (id === 'elicitation') {
    selectConversation(entries, control(false));
    setElicitations(elicitations);
  }
  if (id === 'permission-streaming') {
    const streaming = [...entries, { ...entries[1], id: 'entry-stream', turnId: 'turn-stream', status: 'streaming', text: 'Checking permission boundaries and tool call order…', completedAt: null, reasoning: [], toolCalls: [tool({ toolCallId: 'tool-stream', name: 'Apply patch', status: 'awaitingPermission', result: null, resultOmitted: null })], resources: [], error: null }];
    selectConversation(streaming, control(true));
    setElicitations(elicitations.slice(0, 1));
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

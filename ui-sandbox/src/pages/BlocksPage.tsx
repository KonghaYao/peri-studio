import {
  ChatHeader,
  ProjectRowAccessory,
  SessionRowAccessory,
  GitBranchBar,
  GitChangeGroup,
  GitChangeTree,
  GitCommitBar,
  GitDiffPanel,
  GitGraphPanel,
  DecisionCard,
  Markdown,
  Reasoning,
  ResourceCite,
  SlashMenu,
  TokenUsageMeter,
  ToolActivityGroup,
  ToolActivityRow,
  UserBubble,
} from '@/components/blocks';
import { FileText, Folder, FolderSearch, Terminal } from 'lucide-solid';
import { DemoSection, DomainSection, TierHeader } from '@/pages/shared/DemoSection';

const MARKDOWN_SAMPLE = `# Markdown rendering lab

**Important notice.** Content continues, and ~~the old conclusion~~ has been replaced.

> Streaming content stays readable while syntax is incomplete.

| Capability | State | Notes |
| :--- | :---: | ---: |
| GFM table | Ready | Responsive |
| Remote images | Consent | Explicit load |

- [x] Parse CommonMark and GFM
- [x] Protect remote images
- [ ] Review the final diagram

Inline code uses \`session/load\`. Inline math $E = mc^2$ and display:

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

\`\`\`mermaid
flowchart LR
  Session["Project session"] --> ACP["ACP thread"]
  ACP --> Runtime["Runtime chat"]
\`\`\`

\`\`\`math
\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
\`\`\`

Links stay [external](https://example.test/architecture).

\`\`\`ts startLine=7 filename=recovery.ts
type Result = { ok: boolean };
const result: Result = { ok: true };
console.log(result);
\`\`\`

![Architecture diagram](https://picsum.photos/seed/peri-arch/720/360)

Footnotes remain compact.[^security]

[^security]: Generated content is treated as untrusted input.
`;

export function BlocksPage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader
        tier="Tier 3 · Domain blocks"
        title="Domain blocks"
        description="单域可复用块：只表达一个业务语义，由 Tier 2 基础组件拼装。按 chat / composer / chrome 分域。"
      />

      <DomainSection title="Chat · 聊天内容" description="Transcript 内的消息、Markdown、工具活动与资源引用。">
        <DemoSection id="markdown" title="Markdown" description="GFM + KaTeX 数学 + Mermaid 图；表格 hover 浮现复制 / 下载。">
          <div class="max-w-(--chat-content-max) rounded-lg border border-border-subtle bg-surface-overlay px-16 py-16">
            <Markdown source={MARKDOWN_SAMPLE} />
          </div>
        </DemoSection>

        <DemoSection id="user-bubble" title="UserBubble · Reasoning" description="用户气泡与 Thinking 折叠块。">
          <div class="flex max-w-(--chat-content-max) flex-col gap-16">
            <UserBubble>Check the session recovery path so a restart never treats an old runtime as still alive.</UserBubble>
            <Reasoning>First verify the metadata authority, then check the Registry read-only projection and session/load ordering.</Reasoning>
          </div>
        </DemoSection>

        <DemoSection id="tool-activity" title="ToolActivityRow" description="Fenix 风格工具 icon + 动作说明；running 浅灰底，可展开证据。">
          <ToolActivityGroup>
            <ToolActivityRow icon={FileText} title="Opened vite.config.ts" subtitle="Lines 1–84" input="vite.config.ts" output={'{\n  "lines": 84\n}'} status="done" duration="120ms" />
            <ToolActivityRow icon={Terminal} title="Running $ bun run build:web" input="bun run build:web" status="running" />
            <ToolActivityRow icon={FolderSearch} title={'Matched "src/**/*.tsx"'} error="BUILD_IMPORT_ERROR: Browser bundle imported a Node-only module" input="src/**/*.tsx" status="failed" duration="1.8s" />
          </ToolActivityGroup>
        </DemoSection>

        <DemoSection id="resource-cite" title="ResourceCite" description="消息流内的资源引用卡。">
          <div class="max-w-md">
            <ResourceCite name="Composer component specification" mediaType="text/markdown" resourceId="resource://component-spec" />
          </div>
        </DemoSection>
      </DomainSection>

      <DomainSection title="Composer · 输入域" description="Composer 内嵌块：slash 补全与 token 用量。">
        <DemoSection id="slash-menu" title="SlashMenu" description="Cursor 式单行：图标 + 命令名 + 说明；分组分隔线。">
          <div class="max-w-md">
            <SlashMenu
              activeIndex={4}
              items={[
                { name: 'goal', description: 'Set a goal that the agent will pursue to completion' },
                { name: 'summarize', description: 'Summarize this conversation' },
                { name: 'canvas', description: 'Create a document, diagram, or small website…' },
                { name: 'plan', description: 'Generate an implementation plan', variant: 'plan', accent: true, dividerAfter: true },
                { name: 'compact', description: 'Compacts the current context', variant: 'plugin' },
                { name: 'automate', description: 'Trigger an agent to run based on a trigger…' },
                { name: 'code-review', description: 'Review code instead of editing it' },
                { name: 'commit', description: 'Commit the current changes' },
              ]}
            />
          </div>
        </DemoSection>

        <DemoSection id="token-usage" title="TokenUsageMeter" description="红绿灯圆环：绿（默认）/ 琥珀 / 红；浮层显示 used/limit 与分段。">
          <div class="flex max-w-(--composer-launch-max) flex-wrap items-center gap-16 rounded-lg border border-composer-border bg-surface-overlay px-10 py-8" style={{ 'border-radius': 'var(--composer-radius)' }}>
            <span class="text-12 text-content-muted">Green</span>
            <TokenUsageMeter input={12400} output={3180} cached={8200} limit={200000} />
            <span class="text-12 text-content-muted">Amber (~75%)</span>
            <TokenUsageMeter input={100000} output={25000} cached={20000} limit={200000} />
            <span class="text-12 text-content-muted">Red (~95%)</span>
            <TokenUsageMeter input={140000} output={32000} cached={18000} limit={200000} />
          </div>
        </DemoSection>
      </DomainSection>

      <DomainSection title="Chrome · 壳层块" description="顶栏、侧栏等壳层上的独立块。">
        <DemoSection id="chat-header" title="ChatHeader" description="会话标题与资源入口。">
          <div class="overflow-hidden rounded-lg border border-border-subtle">
            <ChatHeader title="Refactor ACP session recovery and projection boundaries" />
          </div>
        </DemoSection>

        <DemoSection id="session-row-accessory" title="SessionRowAccessory" description="浮动槽位：默认时间戳，hover 切换为 Pin / Archive / More 按钮组。">
          <div class="max-w-sm rounded-lg border border-border-subtle bg-surface-overlay p-8">
            <div class="group/row relative min-h-32 rounded-md hover:bg-interaction-hover">
              <div class="flex min-h-32 items-center px-10">
                <span class="min-w-0 flex-1 truncate text-13 text-content-primary">Refactor ACP session recovery</span>
              </div>
              <SessionRowAccessory time="18m" pinned actionsVisible />
            </div>
            <div class="group/row relative mt-4 min-h-32 rounded-md bg-sidebar-selected">
              <div class="flex min-h-32 items-center px-10">
                <span class="min-w-0 flex-1 truncate text-13 text-content-primary">Design workspace state</span>
              </div>
              <SessionRowAccessory time="2m" live />
            </div>
          </div>
        </DemoSection>

        <DemoSection id="project-row-accessory" title="ProjectRowAccessory" description="项目行：默认会话计数，hover 切换为 More / New session 按钮组。">
          <div class="max-w-sm rounded-lg border border-border-subtle bg-surface-overlay p-8">
            <div class="group/workspace relative min-h-32 rounded-md hover:bg-interaction-hover">
              <div class="flex min-h-32 items-center gap-8 px-10">
                <Folder size={15} strokeWidth={1.7} class="shrink-0 text-content-muted" />
                <span class="min-w-0 flex-1 truncate text-13 text-content-primary">peri-studio</span>
              </div>
              <ProjectRowAccessory count={3} />
            </div>
          </div>
        </DemoSection>
      </DomainSection>

      <DomainSection title="Decision · 决策面" description="Questions / Permissions 共用 DecisionCard。">
        <DemoSection id="decision-card" title="DecisionCard" description="hover 灰底；选中蓝底行 + 蓝字键；轻阴影、大圆角、无 border。">
          <div class="max-w-md">
            <DecisionCard
              title="Questions"
              prompt="归档 session 时，如果该 session 仍有正在运行的 chat，应如何处理？"
              options={[
                { id: 'a', key: 'A', label: '允许直接归档（侧栏隐藏，runtime 可继续在后台）' },
                { id: 'b', key: 'B', label: '必须先关闭 runtime，才能归档' },
                { id: 'c', key: 'C', label: '归档时自动关闭 runtime，再隐藏' },
                { id: 'd', key: 'D', label: 'Other…' },
              ]}
              selectedId="a"
              onSelect={() => {}}
              currentIndex={0}
              total={7}
            />
          </div>
        </DemoSection>
      </DomainSection>

      <DomainSection title="Git · 版本控制" description="Source Control 与 Git Graph 原子块。">
        <DemoSection id="git-change-row" title="GitChangeTree" description="目录树折叠；文件 icon；hover 浮现 stage / discard。">
          <div class="max-w-sm rounded-lg border border-border-subtle bg-surface-overlay py-4">
            <GitChangeGroup label="Changes" count={2}>
              <GitChangeTree
                groupId="working_tree"
                changes={[
                  { id: 'demo-1', path: 'web/src/widgets/resource/SourceControlPanel.tsx', status: 'modified' },
                  { id: 'demo-2', path: 'docs/design/remote-fs-git-protocol.md', status: 'modified' },
                ]}
              />
            </GitChangeGroup>
          </div>
        </DemoSection>

        <DemoSection id="git-commit-bar" title="GitCommitBar" description="Commit message + Pull / Sync / Push。">
          <div class="max-w-sm rounded-lg border border-border-subtle bg-surface-overlay p-8">
            <GitBranchBar repoName="peri-studio" branch="main" ahead={2} behind={0} hasUpstream />
            <GitCommitBar stagedCount={1} />
          </div>
        </DemoSection>

        <DemoSection id="git-graph-row" title="GitGraphPanel" description="VS Code Git Graph 风格表头 + 五列 commit 表。">
          <div class="h-(--demo-frame-git-graph) overflow-hidden rounded-lg border border-border-subtle">
            <GitGraphPanel
              commits={[
                {
                  id: 'row-1',
                  hash: 'a4f2c91b',
                  message: 'feat(web): add git graph layout to ui sandbox',
                  author: 'Christopher13',
                  time: '2m',
                  date: '30 Aug 2026',
                  parents: ['8be31d04'],
                  refs: [{ label: 'main', tone: 'branch' }, { label: 'HEAD', tone: 'branch' }],
                  isHead: true,
                },
                {
                  id: 'row-2',
                  hash: '8be31d04',
                  message: 'fix(resource): retry git mutations after generation bump',
                  author: 'Christopher13',
                  time: '18m',
                  date: '30 Aug 2026',
                  parents: ['c17e902a'],
                  refs: [{ label: 'feature/scm', tone: 'branch' }],
                },
                {
                  id: 'row-3',
                  hash: 'c17e902a',
                  message: 'feat(resource): source control panel with stage groups',
                  author: 'Christopher13',
                  time: '1h',
                  date: '30 Aug 2026',
                  parents: ['f3bbdffa'],
                },
              ]}
            />
          </div>
        </DemoSection>

        <DemoSection id="git-diff-panel" title="GitDiffPanel" description="选中变更路径 + unified diff 预览块。">
          <div class="max-w-md rounded-lg border border-border-subtle">
            <GitDiffPanel path="web/src/widgets/resource/SourceControlPanel.tsx" class="min-h-210" />
          </div>
        </DemoSection>
      </DomainSection>
    </div>
  );
}

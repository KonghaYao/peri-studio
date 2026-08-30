import {
  ChatTranscriptLayout,
  ComposerLayout,
  DecisionSurfacesLayout,
  GitGraphLayout,
  ProjectSidebarLayout,
  ResourcePanelLayout,
  ResourceWorkbenchLayout,
  SourceControlLayout,
  StatusAreaLayout,
} from '@/layers';
import { DemoSection, DomainSection, TierHeader } from '@/pages/shared/DemoSection';

const GIT_FRAME = 'h-(--workbench-frame-height) overflow-hidden rounded-lg border border-border-subtle';

export function LayersPage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader
        tier="Tier 4 · Layer compositions"
        title="Layer compositions"
        description="业务组合层：多块 Tier 3 + Tier 2 拼成可交付区域。设计稿仅存在于 ui-sandbox，不改动 web/ 生产代码。"
      />

      <DomainSection title="Shell · 壳层" description="导航与全局入口。">
        <DemoSection id="project-sidebar" title="Project sidebar" description="Pinned + Workspaces 树；状态与时间靠右。">
          <ProjectSidebarLayout />
        </DemoSection>
      </DomainSection>

      <DomainSection title="Chat · 会话区" description="Transcript 装配（不含 Composer）。">
        <DemoSection id="chat-transcript" title="Chat transcript" description="用户气泡 + assistant 文流 + 工具活动组。">
          <ChatTranscriptLayout />
        </DemoSection>
      </DomainSection>

      <DomainSection title="Composer · 输入区" description="资产磁贴 + 文本域 + 操作行。">
        <DemoSection id="composer" title="Composer" description="12px 圆角、浅灰边；模型选择 + token 圆环 + Send。">
          <ComposerLayout />
        </DemoSection>
      </DomainSection>

      <DomainSection title="Decision · 决策面" description="Questions 与 Permissions 共用 DecisionCard。">
        <DemoSection id="decision" title="Decision surfaces" description="无选项描边；hover 灰、选中蓝；Questions / Permissions 均为蓝色 Next。">
          <DecisionSurfacesLayout />
        </DemoSection>
      </DomainSection>

      <DomainSection title="Status · 状态区" description="右栏或底栏任务面板。">
        <DemoSection id="status-area" title="Status area" description="Tabs + 紧凑列表；面板最大高 132px。">
          <StatusAreaLayout />
        </DemoSection>
      </DomainSection>

      <DomainSection title="Resource · 资源区" description="Explorer 文件树与 diff 预览。">
        <DemoSection id="resource-panel" title="Explorer panel" description="24px 树行 + 并排 diff 预览。">
          <ResourcePanelLayout />
        </DemoSection>
      </DomainSection>

      <DomainSection title="Git · 版本控制" description="Source Control 树形变更 + Git Graph 大面板。">
        <DemoSection id="source-control" title="Source control" description="VS Code 式目录树：文件夹折叠 + 文件 icon + hover stage/discard。">
          <div class={`${GIT_FRAME} max-w-sm`}>
            <SourceControlLayout />
          </div>
        </DemoSection>

        <DemoSection id="git-graph" title="Git graph" description="VS Code Git Graph 插件风格：Graph / Description / Date / Author / Commit 大面板。">
          <div class={`${GIT_FRAME} w-full`}>
            <GitGraphLayout />
          </div>
        </DemoSection>
      </DomainSection>

      <DomainSection title="Workbench · 资源工作台" description="左侧文件预览 + 右侧 Explorer / SCM 浮层与 rail。">
        <DemoSection id="workbench" title="Workbench" description="左侧代码/diff 预览；右侧 264px 面板 + icon rail。">
          <ResourceWorkbenchLayout />
        </DemoSection>
      </DomainSection>
    </div>
  );
}

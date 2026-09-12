---
status: accepted
date: 2026-09-12
---

# T3 Blocks 下沉 `@peri/ui` 与 T4 业务装配

## 决策

| 层级 | 归属 | 职责 |
|------|------|------|
| **T1/T2** | `packages/ui` | Token、无业务语义原子（Button、Textarea…） |
| **T3** | `packages/ui` | **无 store / 无协议** 的复合块（`ComposerShell`、`GitChangeTree`…） |
| **T4** | `web/src/widgets` | store、features 注入、路由状态；**只通过 slot / render prop 接线** |

T3 组件必须：

- 不 import `web/`、`store`、`features`、Yjs、protocol
- 通过 `compactLeading` / `compactTrailing` / `renderField` / `metaRow` / `overlay` / `renderFileTrailing` 等暴露 T4 抓手
- 样式类名使用 `ui-<domain>-*` 前缀（package `css-contracts` 门禁）

## `@peri/ui` T3 清单（barrel 出口）

### Composer

| 组件 | 说明 |
|------|------|
| `ComposerShell` | 双形态输入壳（compact / expanded） |
| `ComposerPlusMenu` | 「+」附件菜单 |
| `ComposerAttachmentChip` | 附件 chip |
| `ComposerDropOverlay` | 拖放覆盖层 |
| `ComposerInputField` | 多行输入区 |
| `ComposerToolbarShell` | 工具栏行容器 |
| `ComposerAttachmentList` | 附件列表 |
| `ComposerQueue` | 排队消息条 |
| `SlashMenu` / `SlashMenuListbox` | Slash 命令菜单 |
| `ComposerAttachmentButton` / `ComposerPredictionButton` / `ComposerSendStopAction` / `ComposerSkillsButton` | 工具栏控件 |
| `UploadAssetTile` | 上传资源 tile |
| `TokenUsageMeter` | Token 用量指示 |

### Chat

| 组件 | 说明 |
|------|------|
| `ChatWorkspaceShell` | Chat 列布局壳（header + transcript + composer 槽） |
| `ChatHeader` | 会话标题栏 |
| `UserBubble` | 用户消息气泡 |
| `MarkdownTable` | Markdown 表格 |
| `SafeImage` | 远程图片安全渲染 |

### Chrome / 侧栏

| 组件 | 说明 |
|------|------|
| `RowAccessorySlot` | 行浮动 accessory 叠层 |
| `ArchivedBrowserList` | 归档浏览列表 |
| `NavAction` / `ProjectRowAccessory` / `ProjectRowActionGroup` / `SectionHeader` / `SessionRowAccessory` / `SidebarNavBar` | 侧栏 chrome 族 |

### Git（SCM）

| 组件 | 说明 |
|------|------|
| `GitBranchBar` | 分支与 sync 操作条 |
| `GitCommitBar` | 提交消息输入 |
| `GitChangeGroup` | 变更分组头 |
| `GitChangeTree` | 目录折叠变更树（复用 `FileTree`） |
| `GitChangeActions` | 单行 stage / discard 操作 |
| `GitGraphRefBadge` | Graph ref 徽章 |
| `GitGraphPanel` | 提交图面板 |
| `GitGraphBranchDialog` / `GitGraphConfirmDialog` | Graph 上下文菜单对话框 |

### Resource / Explorer

| 组件 | 说明 |
|------|------|
| `FileTree` | 路径树（Explorer / SCM 共用） |
| `FilePreviewPanel` | 文件预览面板 |
| `ExplorerItemMenu` | Explorer 上下文菜单 |
| `FileTreeInlineNameEditor` | 行内重命名 |
| `ResourceSectionTitle` | 资源面板区段标题 |

### Workbench

| 组件 | 说明 |
|------|------|
| `WorkbenchShell` | 工作台主壳（rail + 内容） |
| `WorkbenchRail` / `WorkbenchRailButton` | 右侧 rail |
| `WorkbenchPanelChrome` | 浮窗标题栏 |
| `WorkbenchFloatingPanel` | 浮窗容器 |
| `workbench-panel-layout` | 浮窗宽度常量与持久化 helper |

### Status / Decision

| 组件 | 说明 |
|------|------|
| `StatusAreaShell` | 底栏状态区壳 |
| `statusAreaPanelClass` / `statusAreaRowClass` / `statusAreaTabTriggerClass` | 状态区样式 helper |
| `DecisionQueueShell` | 权限 / 追问队列外框 |

### 已移除 barrel 出口

- `ComposerSurface`（v1 矩形壳）：源码保留供几何契约测试读取；**零消费者**，已从 barrel 移除；新代码使用 `ComposerShell`。

## 生产 / Catalog 装配

| 区域 | T3（package） | T4（web widgets / sandbox layers） |
|------|---------------|-------------------------------------|
| Composer | `ComposerShell` 等 | `widgets/composer/Composer.tsx` |
| Chat | `ChatWorkspaceShell` | `widgets/chat/ChatView.tsx` |
| 侧栏 | `SidebarChrome` 族 | `widgets/sidebar/*` |
| SCM | `GitChangeTree` + git 条 | `widgets/resource/SourceControlPanel.tsx`（mutation busy / focus 键） |
| Workbench | `WorkbenchShell` 等 | `widgets/resource/ResourceWorkbench.tsx` |
| Status | `StatusAreaShell` | `widgets/shell/StatusArea.tsx` |
| Decision | `DecisionQueueShell` | `widgets/chat/*Queue.tsx` |
| Git graph | `GitGraphPanel` | `widgets/resource/git/GitGraphPanel.tsx`（薄 re-export） |

Sandbox `components/blocks/*`：T3 条 **barrel 重导出** `@peri/ui`；layers 保留 mock 数据与 T4 演示组合。

## 仍留 Catalog / T4（未下沉）

以下 **有意** 留在 `ui-sandbox` 或 `web/widgets`，不进入 package：

| 项 | 位置 | 原因 |
|----|------|------|
| `Markdown` 富文本装配 | `ui-sandbox/components/blocks/chat/` | 依赖 `@peri/markdown` + catalog CodeBlock / Mermaid |
| `GitChangeRow` / `GitStatusBadge` / `GitDiffPanel` | sandbox git blocks | Catalog 单行 / diff 演示 |
| `ExplorerMutationsPanel` / `ExplorerMutationsTree` / move·delete dialog | sandbox resource blocks | Catalog mutations 演示 |
| `ChatHeader` 默认包装 | `ui-sandbox/blocks/chrome/ChatHeader.tsx` | Catalog 默认 props |
| SCM mutation / preview 接线 | `web/widgets/resource/SourceControlPanel.tsx` | store + features |
| Transcript 消息行 / ToolCall | `web/widgets/chat/*` | Yjs 投影 + 业务语义 |

## Catalog 去重

- `ui-sandbox/src/styles/extra.css`：移除与 package 重复的 composer / workbench 规则
- Composer / Git / Workbench T3 样式仅 `@peri/ui/styles.css`
- Sandbox layers 对 T3 直接 `import from '@peri/ui'`

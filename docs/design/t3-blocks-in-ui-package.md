---
status: accepted
date: 2026-09-12
---

# T3 Blocks 下沉 `@peri/ui` 与 T4 业务装配

> **协作入口**：组件分级与 CSS 硬约束亦写入根目录 `CLAUDE.md`、`AGENTS.md` 与 [`frontend-architecture.md`](frontend-architecture.md) §5.7。

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
| `ComposerShell` | 双形态输入壳（compact / expanded；生产 docked 与 Quick Start） |
| `ComposerPlusMenu` | 「+」附件菜单 |
| `ComposerAttachmentChip` | 附件 chip |
| `ComposerDropOverlay` | 拖放覆盖层 |
| `ComposerInputField` | 多行输入区 |
| `ComposerToolbarShell` | 工具栏行容器 |
| `ComposerAttachmentList` | 附件列表 |
| `ComposerQueue` | 排队消息条 |
| `SlashMenu` / `SlashMenuListbox` | Slash 命令菜单 |
| `ComposerAttachmentButton` / `ComposerMicButton` / `ComposerPredictionButton` / `ComposerSendStopAction` / `ComposerSkillsButton` | 工具栏控件 |
| `UploadAssetTile` | 上传资源 tile |
| `TokenUsageMeter` | Token 用量指示 |

### Chat

| 组件 | 说明 |
|------|------|
| `ChatWorkspaceShell` | Chat 列布局壳（header + transcript + composer 槽） |
| `ChatActivityChain` | 助手 activity 列（推理 + 工具共用左侧轨与块间距） |
| `TranscriptViewportShell` / `TranscriptRowShell` | 消息列表滚动视口 + 虚拟化行壳 |
| `HistoryBoundary` | Verified / Current 历史分隔 |
| `MessageArticleShell` / `MessageMetaHeader` / `MessageSurfaceShell` / `MessageAssistantActionsShell` | 单条消息布局壳（T4 仍拥有 block 语义） |
| `ChatHeader` | 会话标题栏；始终渲染标题并 `ui-titlebar-drag` 铺进 WCO overlay（仅 `html.ui-wco-visible`）。毛玻璃由 AppShell `.ui-titlebar` 承担，本块不叠 `min-h-titlebar` / 白底 |
| `RewindPanelState` / `RewindPanelActions` | Rewind 面板状态区与底栏操作行 |
| `UserBubble` | 用户消息气泡 |
| `MarkdownTable` | Markdown 表格 |
| `SafeImage` | 远程图片安全渲染 |
| `McpAppFrameShell` | MCP App 双 iframe 宿主壳（sandbox + 全屏；`bindMcpAppHost` 在 `@peri/ui/mcp-app`） |
| `McpAppHistoricalCard` | session replay 无 live HTML 时的 MCP App 占位卡（不展开工具参数/结果） |

### Chrome / 侧栏

| 组件 | 说明 |
|------|------|
| `ProjectSidebarShell` | 侧栏 navbar + body + footer 布局壳（mist / scroll）；列表面为整列 `ui-sidebar-frost`（`--sidebar-frost-*`：底层 wash + 半透明 fill + 颗粒）。footer / gear 行不得另铺 `bg-surface` / `bg-sidebar-bg`，mist 不得收成实心 Neutral 25 板。navbar 为 `ui-titlebar-drag` + `ui-titlebar-sidebar` + `pl-titlebar-gutter`。`html.ui-wco-visible` 时 extra 顶留 `--titlebar-area-height` 空拖条（不再叠左 gutter），不叠 overlay 毛玻璃 |
| `RowAccessorySlot` | 行浮动 accessory 叠层 |
| `ArchivedBrowserList` | 归档浏览列表 |
| `NavAction` / `ProjectRowAccessory` / `ProjectRowActionGroup` / `SectionHeader` / `SessionRowAccessory` / `SidebarNavBar` | 侧栏 chrome 族 |
| `SettingsPanel` | macOS 式偏好大窗：左导航（icon + label + selected）+ 右详情 slot + 标题；`ui-settings-*`。不替代 System `SettingsDialog` |
| `SettingsAppearancePane` | Appearance 页：材质色板 + Opacity 滑杆；无持久化 |

### Terminal

| 组件 | 说明 |
|------|------|
| `TerminalDockShell` | PTY 面板折叠壳（viewport 隐藏不卸载） |

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

### Monitor

| 组件 | 说明 |
|------|------|
| `MonitorPanelShell` | Langfuse trace 摘要 + 列表内容壳（body-only；header 由 WorkbenchPanelChrome 提供） |
| `MonitorTraceTurnTree` / `MonitorTraceTurnTreeShell` / `buildTraceTurnTree` | Trace drill-in：全量扁平 observation 树（noise hoist、turn 分组、选中/键盘）；自 peri-fuse `observation-tree` |
| `MonitorObservationTypeBadge` / `MonitorObservationLevelBadge` / `MonitorObservationTypeIcon` | Observation type / level 视觉（自 peri-fuse `observation-badges`） |
| `MonitorTimelineShell` / `MonitorTimelineBand` / `MonitorTimelineRuler` | Trace 时长带 + type 分轨（layout 自 peri-fuse `observation-timeline-*`）；running 段斜纹、type row track hover |
| `MonitorTimelineDialogShell` | 观测时间轴弹窗壳（timeline + detail 双 slot；T4 注入 `MonitorTimelineShell` 或 `MonitorTimelineBand`） |
| `monitor-timeline-layout` | 纯 TS 分轨 / tick / opacity 算法（Solid 无关；fuse 可只复用此模块） |
| `IoViewerShell` / `IoViewer` | 完整 IO 检视（`ChatIoList` + `IoViewerJsonView` + `chat-payload`）；默认自绘 fuse 等价 UI；`renderChat` / `renderJson` 仅作可选增强（自 peri-fuse `io-viewer` / `chat-viewer` / `chat-parts` / `json-viewer`） |
| `IoPreviewCell` | 表格 IO 预览单元格 + Dialog 展开 JsonTree（自 peri-fuse `io-table` / observation detail） |
| `IoTabsShell` | Observation 详情 Preview / Input / Output / Metadata 标签壳（render prop 注入） |
| `ScoreListShell` | Trace / observation score 列表（数值 / 文本 / 空态） |
| `DataTableToolbarShell` | 表格 toolbar 行 + 列可见性菜单（toolbar slot 注入） |
| `AutoRefreshIntervalControl` | 表格自动刷新间隔选择（Off / 15s / 30s / 1m） |

> **T2 新增（peri-fuse）**：`JsonTree`、`StatChip`、`TokenUsageBadge`、`TruncatedIdCell`、`LocalIsoDate`、`LevelCountsDisplay`、`TableLoadingRows`、`TableInlineError`、`FilterInput` / `FilterSelect` / `DateFilterInput` 已从 barrel 导出；配套 lib：`chat-payload`、`date-filter-boundary`、`format-local-iso-date`、`monitor-level-symbols`。分级与 sandbox 见 [`peri-fuse-ui-extraction.md`](peri-fuse-ui-extraction.md)。本清单仅列 T3。

### App chrome（dashboard 类）

| 组件 | 说明 |
|------|------|
| `PageHeaderShell` | Sticky 页标题 + description + actions 槽（自 peri-fuse `PageHeader`） |
| `CommandPaletteShell` + `bindCommandPaletteHotkey` | 命令面板 Dialog + Cmd/Ctrl+K 绑定；可选 `footer`（`null` 隐藏）；↑↓ 列表 **wrap** 导航；`dispatchCommandPaletteOpen` / `bindCommandPaletteOpenEvent` / `COMMAND_PALETTE_OPEN_EVENT` 供 T4 命令式打开 |
| `ShortcutsDialogShell` + `bindShortcutsHelpHotkey` | 快捷键参考弹窗 + `?` 绑定（`bindShortcutsHelpHotkey` 与 `CommandPaletteShell` 同文件实现，barrel 一并导出） |

### Status / Decision

| 组件 | 说明 |
|------|------|
| `StatusAreaShell` | 底栏状态区壳 |
| `statusAreaPanelClass` / `statusAreaRowClass` / `statusAreaTabTriggerClass` | 状态区样式 helper |
| `DecisionQueueShell` | 权限 / 追问队列外框 |

### Wave 3 已删除

- `ComposerSurface`（v1 矩形壳）与 `ComposerRectSurface`（Wave 2 中间态）：已移除；生产 docked / Quick Start 均使用 `ComposerShell`（样式在 package `extra.css`）。

## 生产 / Catalog 装配

| 区域 | T3（package） | T4（web widgets / sandbox layers） |
|------|---------------|-------------------------------------|
| Composer | `ComposerShell` 族 | `widgets/composer/Composer.tsx`、`QuickStartComposer.tsx` |
| Rewind | `RewindPanelState` / `RewindPanelActions` | `widgets/chat/RewindDialog.tsx` |
| Chat | `ChatWorkspaceShell` + transcript / message shells | `widgets/chat/ChatView.tsx`, `MessageList.tsx`, `ConversationMessage.tsx` |
| 侧栏 | `ProjectSidebarShell` + `SidebarChrome` 族 | `widgets/sidebar/*`, `SidebarChrome.tsx` |
| Settings | `SettingsPanel` + `SettingsAppearancePane` | `widgets/shell/AppSettingsPanel.tsx`；sandbox `#/components-shell` → Settings panel |
| Terminal | `TerminalDockShell` | `widgets/terminal/TerminalPanel.tsx` |
| SCM | `GitChangeTree` + git 条 | `widgets/resource/SourceControlPanel.tsx`（mutation busy / focus 键） |
| Workbench | `WorkbenchShell` 等 | `widgets/resource/ResourceWorkbench.tsx` |
| Status | `StatusAreaShell` | `widgets/shell/StatusArea.tsx` |
| Decision | `DecisionQueueShell` | `widgets/chat/*Queue.tsx` |
| Git graph | `GitGraphPanel` | `widgets/resource/git/GitGraphView.tsx` |
| Langfuse Monitor | `MonitorPanelShell` + `MonitorTraceTurnTreeShell` / `IoTabsShell` / `IoViewer` / timeline / badges | `widgets/resource/MonitorPanel.tsx`；sandbox `#/components-monitor`（trace turn tree、timeline、IO detail） |
| Data table chrome | `DataTableToolbarShell` + `AutoRefreshIntervalControl` | peri-fuse traces/sessions 页面 T4 装配；sandbox `#/components-display/data-table-toolbar` |
| Dashboard chrome | `PageHeaderShell` + `CommandPaletteShell` | peri-fuse 后期 T4 装配；sandbox `#/components-chrome/app-chrome` |
| MCP Apps | `McpAppFrameShell` + `bindMcpAppHost` | `widgets/chat/McpAppFrame.tsx`（`features/mcp/mcp-apps.ts` 协议与 live session） |

Sandbox `components/blocks/*`：T3 条 **barrel 重导出** `@peri/ui`；layers 保留 mock 数据与 T4 演示组合。

独立子路径：`import { … } from '@peri/ui/mcp-app'`（Host 桥、payload helper、iframe 壳）。

## Markdown 与语法高亮

| 能力 | 归属 | 说明 |
|------|------|------|
| **代码语法高亮** | `@peri/ui` | `@tanstack/highlight`（`lib/code-highlight.ts` + `HighlightedCodeBody`）；主题 `github-light`，运行时注入 `.code-block-highlight pre` 作用域 |
| **Markdown 解析 / 流式 AST** | `@peri/markdown` | `stream-markdown-parser`（markstream-vue 生态）；`MarkdownBody` / `MarkdownCodeBlockView` 在 package 内装配 |
| **Markdown 文档流 CSS** | `@peri/ui` `markdown-body.css` | 设计稿 compact chat 字阶（`--text-14` 正文 / 15px）；宿主 `.markdown-body` |

`@peri/ui` 不直接依赖 Shiki；`@peri/markdown` 的 parser 层亦不承担 fence 着色（由 `CodeBlockView` 注入）。

## 仍留 Catalog / T4（未下沉）

以下 **有意** 留在 `ui-sandbox` 或 `web/widgets`，不进入 package：

| 项 | 位置 | 原因 |
|----|------|------|
| `Markdown` 富文本装配 | `ui-sandbox/components/blocks/chat/` | 依赖 `@peri/markdown` + catalog CodeBlock / Mermaid |
| `GitChangeRow` / `GitStatusBadge` / `GitDiffPanel` | sandbox git blocks | Catalog 单行 / diff 演示 |
| `ExplorerMutationsPanel` / `ExplorerMutationsTree` / move·delete dialog | sandbox resource blocks | Catalog mutations 演示 |
| `ChatHeader` 默认包装 | `ui-sandbox/blocks/chrome/ChatHeader.tsx` | Catalog 默认 props |
| SCM mutation / preview 接线 | `web/widgets/resource/SourceControlPanel.tsx` | store + features |
| 消息 block 渲染 / ToolCall / MCP | `ConversationMessage.tsx` 内 `MessageBlock` 等 | Yjs 投影 + 业务语义（壳已 T3，内容仍 T4） |

## 互补组件（勿合并）

以下组件对 **职责互补、视觉相近**，禁止抽第三套或合并实现；选型见「何时用谁」。

| 对 | 何时用谁 |
|----|----------|
| `InputSearch` vs `FilterInput` | 即时搜索 vs Enter 提交的表格筛选 |
| `Statistic` vs `StatChip` | 大数字指标 vs 详情行 chip |
| `TokenUsageMeter` vs `TokenUsageBadge` | Composer 限额条 vs 表格摘要 |
| `ChatIoList` / `IoViewer` vs `ConversationMessage` | 观测 IO vs ACP transcript |
| `Command` vs `CommandPaletteShell` | 可组合原语 vs 完整 Cmd+K 壳（另一条会改实现去组合） |
| `LocalIsoDate` / `formatDay` / `formatByPicker` | 表格时间 vs 日期筛选边界 vs DatePicker |

peri-fuse 抽取语境与 P1/P2 落地范围见 [`peri-fuse-ui-extraction.md`](peri-fuse-ui-extraction.md) §互补组件。

## Catalog 去重

- `ui-sandbox/src/styles/extra.css`：移除与 package 重复的 composer / workbench 规则
- Composer / Git / Workbench T3 样式仅 `@peri/ui/styles.css`
- Sandbox layers 对 T3 直接 `import from '@peri/ui'`

---
status: accepted
date: 2026-09-14
---

# peri-fuse → `@peri/ui` 可复用 UI 抽取证据

> peri-fuse 为 Langfuse-lite 遥测 Web（React + shadcn/Radix + Spectra token）。本文记录 2026-09-14 从 peri-fuse **只读分析**、在 peri-studio `@peri/ui` **落地**的组件边界与后续消费建议。  
> **后期接入执行指南**：[peri-fuse-ui-adoption.md](peri-fuse-ui-adoption.md)

## peri-fuse UI 结构摘要

| 区域 | 路径 | 技术 |
|------|------|------|
| T2 原子 | `packages/web/src/shared/components/ui/*` | shadcn（Button、Dialog、Table…） |
| 业务复合 | `packages/web/src/shared/components/*` | observation tree/timeline、chat/io viewer、data-table、command palette |
| App shell | `layout.tsx` | React Router 侧栏 + 命令面板 + 主题 |
| Token | `index.css` | Spectra + shadcn 语义色（oklch） |
| 页面 | `packages/web/src/features/*` | traces、sessions、gateway、settings… |

peri-studio 已有更完整的 SolidJS `@peri/ui`（含 Monitor T3、DataTable、Command 复合件等），因此本次**增强/补缺**而非整站迁移。

## 对照：已有 / 新增 / 增强 / 不搬

### 已有（peri-fuse 与 studio 重复，未再实现）

- shadcn 级 T2：Button、Dialog、Tabs、Badge、Table、Select、Tooltip…
- `DataTable` / `EnhancedDataTable`（studio 版强于 fuse 的 tanstack 壳）
- `Command` 复合件（fuse 的 command-palette 为 T4 路由装配）
- Monitor trace drill-in：`MonitorTraceTurnTree` / `MonitorTraceTurnTreeShell` + `IoViewer`（旧 `MonitorObservationTree` / `MonitorTraceDetailShell` 已移除）
- `TokenUsageMeter`（Composer 场景；与 fuse `TokenUsageBadge` 用途不同）

### 新增

| 组件 | 层级 | peri-fuse 来源 | 说明 |
|------|------|----------------|------|
| `JsonTree` | T2 | `json-viewer.tsx` | 无 `react18-json-view` 依赖的折叠 JSON 树 |
| `StatChip` | T2 | `observation-detail.tsx` `StatChip` | 指标 chip |
| `TokenUsageBadge` | T2 | `token-usage-badge.tsx` | 表格行 `in → out (Σ total)` |
| `PageHeaderShell` | T3 | `state.tsx` `PageHeader` | 去 React Router 的 sticky 页头 |
| `CommandPaletteShell` | T3 | `command-palette.tsx` | Dialog + 搜索 + 键盘导航；items 回调 |
| `ShortcutsDialogShell` | T3 | `shortcuts-dialog.tsx` | 快捷键列表弹窗 |
| `MonitorObservationTypeBadge` 等 | T3 | `observation-badges.tsx` | type/level 视觉 |
| `MonitorTimelineShell` 族 | T3 | `observation-timeline-*.tsx` | 时长带 layout + Solid 渲染 |
| `IoViewerShell` / `IoViewer` | T3 | `io-viewer.tsx` + `chat-viewer.tsx` + `chat-parts.tsx` + `json-viewer.tsx` | 完整 IO 检视：Chat 气泡 / part 渲染 / JSON 树；`chat-payload` 解析；默认自绘，slot 可选 |
| `TruncatedIdCell` | T2 | `table-id.tsx` | 表格 id/name 单行截断 + tooltip |
| `LocalIsoDate` | T2 | `LocalIsoDate.tsx` | 本地时区 ISO 渲染 + UTC ms tooltip |
| `FilterInput` / `FilterSelect` / `DateFilterInput` | T2 | `filter-input.tsx` 等 | 表格筛选栏；`date-filter-boundary` lib |
| `chat-payload` / `date-filter-boundary` | lib | `chat-payload.ts` / date helpers | `isChatPayload` / `extractMessages`；日期边界 ISO |

### P1（2026-09-14 落地，原漏抽）

| 组件 | 层级 | peri-fuse 来源 | 说明 |
|------|------|----------------|------|
| `LevelCountsDisplay` | T2 | traces table level counts | 非零 observation level 计数行；`monitor-level-symbols` lib |
| `TableLoadingRows` | T2 | table loading skeleton | 表格 loading 占位行 |
| `TableInlineError` | T2 | table inline error | 查询失败 + retry / stale 态 |
| `monitor-level-symbols` | lib | level count helpers | `levelCountsFromRecord` / `MONITOR_LEVEL_SYMBOLS` |
| `IoPreviewCell` | T3 | `io-table` / observation detail | IO 预览单元格 + Dialog JsonTree |
| `IoTabsShell` | T3 | observation detail tabs | Preview / Input / Output / Metadata render prop 壳 |
| `ScoreListShell` | T3 | score list | Trace score 列表 |
| `DataTableToolbarShell` | T3 | `data-table.tsx` toolbar | toolbar slot + 列可见性菜单 |
| `AutoRefreshIntervalControl` | T3 | auto-refresh control | 表格自动刷新间隔 |

**Sandbox 路由**

- `#/components-display/level-counts-display`
- `#/components-display/table-loading-rows`
- `#/components-display/table-inline-error`
- `#/components-display/table-state-composed`
- `#/components-display/data-table-toolbar`
- `#/components-monitor/monitor-io-detail`

T4 demo：`ComponentCatalogExtrasTableState.tsx`、`ComponentCatalogExtrasDataTableToolbar.tsx`（Display）；`MonitorIoDetailLayout.tsx`（Shell Monitor）。

### P2（2026-09-14 打磨）

| 项 | 说明 |
|----|------|
| Timeline 视觉 | running 段斜纹（`ui-monitor-timeline-running`）、type row **track hover**（`ui-monitor-timeline-track`） |
| `CommandPaletteShell` | 可选 `footer`；↑↓ 列表 wrap 导航；`dispatchCommandPaletteOpen` / `bindCommandPaletteOpenEvent` |
| `MonitorTimelineDialogShell` | T3 弹窗壳（timeline + detail slot）；barrel 已导出；**无独立 sandbox 路由**（T4 在 trace detail 内组合） |

### 互补组件（勿合并）

P1/P2 从 peri-fuse 迁入的 T2/T3 与 studio 既有件 **不是重复**，禁止再抽第三套。完整分级与 T4 边界见 [`t3-blocks-in-ui-package.md`](t3-blocks-in-ui-package.md) §互补组件；选型摘要：

| 对 | 何时用谁 |
|----|----------|
| `InputSearch` vs `FilterInput` | 即时搜索 vs Enter 提交的表格筛选 |
| `Statistic` vs `StatChip` | 大数字指标 vs 详情行 chip |
| `TokenUsageMeter` vs `TokenUsageBadge` | Composer 限额条 vs 表格摘要 |
| `ChatIoList` / `IoViewer` vs `ConversationMessage` | 观测 IO vs ACP transcript |
| `Command` vs `CommandPaletteShell` | 可组合原语 vs 完整 Cmd+K 壳（另一条会改实现去组合） |
| `LocalIsoDate` / `formatDay` / `formatByPicker` | 表格时间 vs 日期筛选边界 vs DatePicker |

Sandbox catalog 各 demo 的 `description` 已补「勿与 X 混用」一句，便于浏览时对照。

### 增强

- Monitor 文档与 sandbox：补 `monitor-timeline`（含 type/level badges + timeline band）、`io-viewer` 与 `monitor-io-detail` demo（`#/components-monitor`）
- App chrome sandbox：`app-chrome` demo（`#/components-chrome`）
- Display sandbox：`json-tree` / `stat-chip` / `token-usage-badge` / `truncated-id-cell` / `local-iso-date` / `table-cells-composed` / `table-filters` / **P1**：`level-counts-display` / `table-loading-rows` / `table-inline-error` / `table-state-composed` / `data-table-toolbar`（`#/components-display`）

### 刻意不搬（业务或框架绑定）

| peri-fuse 模块 | 原因 |
|----------------|------|
| `layout.tsx`、侧栏 nav、project-switcher | React Router + project store |
| `data-table.tsx`、各 `features/*` 页面 | API/tRPC/URL 状态 |
| `observation-tree.tsx` `buildTree` / noise 逻辑 | 领域数据变换；studio 用 `buildTraceTurnTree` + `MonitorTraceTurnTree` |
| `chat-viewer.tsx`、`chat-parts.tsx` | 已移植为 `ChatIoList` / `ChatIoParts`；fuse 可删 React 实现并消费 `IoViewer` |
| `command-palette.tsx` 内 nav 命令表 | 产品路由；保留为 T4 |
| Spectra oklch token 全表 | 与 studio T1 视觉契约不同；不合并 |
| shadcn `ui/*` 源码 | studio 已有 Solid 等价物 |

## Sandbox

- `#/components-monitor`：`monitor-timeline`、`io-viewer`、`monitor-io-detail`
- `#/components-chrome`：`app-chrome`
- `#/components-display`：`json-tree`、`stat-chip`、`token-usage-badge`、`truncated-id-cell`、`local-iso-date`、`table-cells-composed`、`table-filters`、`level-counts-display`、`table-loading-rows`、`table-inline-error`、`table-state-composed`、`data-table-toolbar`

各组件均有 `packages/ui` 单测；T4 组合 demo 在 `ui-sandbox/src/layers/shell/`（`IoViewerLayout`、`TableFiltersLayout`、`DataTableToolbarLayout`、`MonitorIoDetailLayout`）与 `ComponentCatalogExtrasTableCells.tsx` / `ComponentCatalogExtrasTableState.tsx` / `ComponentCatalogExtrasDataTableToolbar.tsx`。

## peri-fuse 后期接入建议

1. 添加 workspace 依赖 `@peri/ui`（或发布后 npm link）；样式入口 `@peri/ui/styles.css`。
2. React 消费：用 wrapper 或逐步迁 Solid 岛；短期可只复用 **layout 算法**（`monitor-timeline-layout` 纯 TS）+ 自绘 React 皮。
3. 优先替换：`JsonViewer` → `IoViewerJsonView` / `JsonTree`；`PageHeader` → `PageHeaderShell`；timeline → `MonitorTimelineShell`；badges → `MonitorObservation*Badge`；`io-viewer` + `chat-viewer` → `IoViewer`（或 `IoViewerShell`）；table filters → `FilterInput` 族；`table-id` / `LocalIsoDate` → package T2。
4. `CommandPaletteShell` 的 `items` 由 fuse 路由/store 注入；`bindCommandPaletteHotkey` 在 app 根挂载一次。
5. 保持 Spectra token 与 `@peri/ui` T1 并存时，用 CSS 变量映射层，勿复制组件 CSS。

## 风险与未完成

- **框架差异**：新增组件为 SolidJS；fuse 为 React，需适配层或局部 Solid 岛。
- **视觉**：timeline 色板映射到 studio semantic token，与 fuse Spectra 像素级不完全一致；sandbox 人工审阅待用户本地 `./dev-sandbox.sh`。
- **Chat/IO 双模式**：`IoViewer` 默认自绘 fuse 等价行为；fuse 可直接 `<IoViewer data={…} />`（Solid 岛），无需保留 `chat-viewer` / `chat-parts`；`renderChat` / `renderJson` 仅作定制增强。
- **ResizeObserver**：`MonitorTimelineShell` 在无 RO 环境回退固定宽度；测试可传 `width` prop。

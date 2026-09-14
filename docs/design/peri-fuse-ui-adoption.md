---
status: draft
date: 2026-09-14
---

# peri-fuse 消费 `@peri/ui` 指南

> 前置证据：[peri-fuse-ui-extraction.md](peri-fuse-ui-extraction.md) · T3 清单：[t3-blocks-in-ui-package.md](t3-blocks-in-ui-package.md) § Monitor / App chrome / Filter  
> **范围**：只指导 peri-fuse 后期接入；不改 fuse 源码、不合并 token、不把 fuse layout 塞进 package。

## 1. 原则

| 项 | 规则 |
|----|------|
| **T1** | fuse 保留 Spectra（`index.css` oklch）；studio 保留 `packages/ui/src/styles/tokens.css`。两套 **不合并**，消费 `@peri/ui` 时用 **映射层** 桥接语义色，勿复制 studio palette 进 fuse。 |
| **T2** | 无业务语义原子/小复合（`JsonTree`、`FilterInput`、`TruncatedIdCell`…）可直接从 barrel 引入；样式依赖 `@peri/ui/styles.css` 中的 token utility。 |
| **T3** | 无 store/协议壳层（`PageHeaderShell`、`IoViewerShell`、`MonitorTimelineShell`…）通过 **slot / render prop** 注入 fuse 的 React 内容；fuse 仍拥有 tRPC/URL/路由。 |
| **T4** | `layout.tsx`、`data-table.tsx`、`features/*` 页面 **留在 fuse**；只替换重复皮与算法，不搬业务页。 |
| **框架** | `@peri/ui` 为 **SolidJS**；fuse 为 React。纯 TS 零摩擦；Solid 组件需 wrapper 或 Solid 岛（见 §3）。 |

## 2. 纯 TS — 可先接入（零 Solid 依赖）

| `@peri/ui` 符号 | import 路径（barrel） | 替换 fuse 模块 / 片段 |
|-----------------|----------------------|------------------------|
| `layoutMonitorTimelineLanes`、`layoutMonitorTimelineTypeLanes`、`buildMonitorTimelineDurationOpacity`、`formatMonitorTimelineTickLabel`、`monitorTimelineNiceTickStep` | `@peri/ui` → `monitor-timeline-layout` | `observation-timeline-layout.ts` 分轨 / tick / opacity 算法 |
| `MONITOR_TIMELINE_*` 常量（`BAR_COLORS`、`TYPE_ORDER`、`LANE_HEIGHT` 等） | 同上 | `observation-timeline-band.tsx` 内联常量 |
| `isChatPayload`、`extractMessages` | `@peri/ui` → `chat-payload` | `chat-utils.ts` 检测与消息抽取 |
| `contentToText`、`parseMaybeString` | 同上 | `chat-utils.ts` 正文解析（barrel 已导出，extraction 文档未单列） |
| `toLocalDate`、`toIso`、`formatDay` | `@peri/ui` → `date-filter-boundary` | `date-filter-input.tsx` 边界 ISO 换算 |
| `levelCountsFromRecord`、`MONITOR_LEVEL_SYMBOLS`、`monitorLevelSymbol` | `@peri/ui` → `monitor-level-symbols` | `level-colors.ts` / `level-counts-display.tsx` 计数与符号 |
| `formatCountLabelAsLevel`、`formatLevelCountNumber` | 同上 | traces 表 level 列格式化 |
| `formatLocalIsoDate` | `@peri/ui`（与 `LocalIsoDate` 同出口） | `local-iso-date.tsx` 格式化函数 |

**做法**：fuse 删本地 duplicate 文件 → `import { … } from '@peri/ui'` → 单元测试对齐 studio 行为。Timeline **可先只换 layout**，React 自绘 `Ruler` / `BandBlock` 皮。

## 3. Solid 组件对照

| fuse 组件 | `@peri/ui` | 建议适配 |
|-----------|------------|----------|
| `json-viewer.tsx` `JsonViewer` | `JsonTree` | **P0 Solid 岛** 或短期保留 React + 对齐交互；无 `react18-json-view` |
| `state.tsx` `PageHeader` | `PageHeaderShell` | Solid 岛；`actions` slot 仍传 React 节点需 wrapper |
| `filter-input.tsx` | `FilterInput` | Solid 岛；debounce/ref 用 `FilterInputHandle` |
| `filter-select.tsx` | `FilterSelect` | Solid 岛；`FILTER_SELECT_ALL` 常量 barrel 已导出 |
| `date-filter-input.tsx` | `DateFilterInput` | Solid 岛 + §2 `date-filter-boundary` |
| `io-viewer.tsx` `IoViewer` | `IoViewer` / `IoViewerShell` | Solid 岛；默认自绘 Chat + JSON；可删 fuse `chat-viewer` / `chat-parts` |
| `observation-timeline.tsx` | `MonitorTimelineShell` | 短期：**layout 纯 TS + React 皮**；中期 Solid 岛传 `width` / segments |
| `observation-timeline-band.tsx` | `MonitorTimelineBand` / `MonitorTimelineRuler` | 同上；或整壳 `MonitorTimelineShell` |
| `observation-badges.tsx` | `MonitorObservationTypeBadge` / `LevelBadge` → `MonitorObservationLevelBadge` / `MonitorObservationTypeIcon` | Solid 岛；`monitorObservationTypeStyle` 可单独 import |
| `table-id.tsx` | `TruncatedIdCell` | Solid 岛 |
| `local-iso-date.tsx` | `LocalIsoDate` | Solid 岛；格式化用 `formatLocalIsoDate` |
| `token-usage-badge.tsx` | `TokenUsageBadge` | Solid 岛 |
| `level-counts-display.tsx` | `LevelCountsDisplay` | Solid 岛 + `monitor-level-symbols` |
| `state.tsx` `LoadingRows` | `TableLoadingRows` | Solid 岛 |
| `state.tsx` 表内错误态 | `TableInlineError` | Solid 岛 |
| `io-cell.tsx` | `IoPreviewCell` | Solid 岛；Dialog 内嵌 `JsonTree` |
| `observation-detail.tsx` `IoTabs` | `IoTabsShell` | Solid 岛；Preview/IO 仍用 fuse `ChatViewer` / `JsonTree` |
| `observation-detail.tsx` `ScoreList` | `ScoreListShell` | Solid 岛 |
| `data-table.tsx` toolbar 区 | `DataTableToolbarShell` | Solid 岛；列元数据 `DataTableToolbarColumnMeta` |
| `auto-refresh-control.tsx` | `AutoRefreshIntervalControl` | Solid 岛 |
| `command-palette.tsx` | `CommandPaletteShell` + `bindCommandPaletteHotkey` + `dispatchCommandPaletteOpen` / `bindCommandPaletteOpenEvent` | Solid 岛；`items` 由 fuse 路由注入；可选 `footer`；↑↓ wrap 导航 |
| `shortcuts-dialog.tsx` | `ShortcutsDialogShell` + `bindShortcutsHelpHotkey` | Solid 岛 |
| `observation-tree.tsx` | `MonitorObservationTree`（已有） | **不搬** `buildTree` / noise；仅详情壳可对齐 |
| `chat-viewer.tsx` / `chat-parts.tsx` | `ChatIoList` / `ChatIoParts` | **已移植**；fuse 消费 `IoViewer` 默认路径即可 |
| `layout.tsx`、shadcn `ui/*` | — | **短期继续自绘**；勿搬 shadcn 进 studio |

**Solid 岛（建议）**：`solid-js` + `@solidjs/react`（或项目选定 adapter）在 React 树中挂载单组件；props 用 serializable 数据 + callback，避免跨框架传 React element 进 Solid 子树（slot 用 `render*` 函数在 React 侧执行）。

## 4. 优先替换顺序

| 阶段 | 项 | 说明 |
|------|-----|------|
| **P0 · 已落地** | 纯 TS：`monitor-timeline-layout`、`chat-payload`、`date-filter-boundary`、`monitor-level-symbols`、`formatLocalIsoDate` | 风险最低；先删 fuse duplicate |
| **P0** | `JsonTree` | 替换 `JsonViewer`；IO 预览 / metadata 多处复用 |
| **P0** | `PageHeaderShell` | 各 list/detail 页头 |
| **P0** | `FilterInput` / `FilterSelect` / `DateFilterInput` | traces / sessions 筛选栏 |
| **P0** | `IoViewer` | 统一 IO 检视；默认自绘 fuse 等价 UI |
| **P0** | `MonitorTimelineShell` 族 + `MonitorObservation*Badge` | trace detail 时长带 |
| **P0** | 表格 cell：`TruncatedIdCell`、`LocalIsoDate`、`TokenUsageBadge`、`LevelCountsDisplay`、`TableLoadingRows`、`TableInlineError` | 与 `EnhancedDataTable` 列定义对齐 |
| **P1** | `IoPreviewCell`、`IoTabsShell`、`ScoreListShell` | observation detail |
| **P1** | `DataTableToolbarShell`、`AutoRefreshIntervalControl` | 列表页 chrome |
| **P1** | `CommandPaletteShell`、`ShortcutsDialogShell` | app 根一次绑定 hotkey |
| **P2 · 已落地** | Timeline 斜纹 / track hover、`CommandPaletteShell` footer + wrap + imperative open、`MonitorTimelineDialogShell` | barrel 已导出；DialogShell 无独立 sandbox demo |
| **不做** | `layout.tsx`、`data-table.tsx` 核心、`features/*` | T4 留 fuse |

## 5. Spectra → studio token 映射（草案）

> **非像素级保证**；接入后须在 fuse 主题下 **人工目视**（含 dark）。在 fuse 根节点或 `@layer` 中定义桥接变量，让 `@peri/ui` utility 读到 Spectra 语义即可。

| Spectra / shadcn（fuse） | studio T1（消费侧） | 备注 |
|--------------------------|---------------------|------|
| `--foreground` / `--fg-primary` | `--content-primary` | 主文案 |
| `--muted-foreground` / `--fg-secondary` | `--content-secondary` | 副文案 |
| `--fg-tertiary` | `--content-muted` | 弱化 |
| `--background` / `--surface-base` | `--surface-canvas` | 页面底 |
| `--surface-raised` / `--card` | `--surface-overlay` | 卡片 / 浮层 |
| `--surface-inset` / `--muted` | `--surface-sunken` | 输入槽 / inset |
| `--border` / `--line-default` | `--border-subtle` | 默认边框 |
| `--line-strong` | `--border-strong` | 强调分割 |
| `--primary` / `--brand` | `--accent-solid` | 主色实心 |
| `--brand-subtle` / `--accent`（bg） | `--accent-soft` | 浅底 hover |
| `--ring` | `--accent-ring` / `--border-focus` | focus ring |
| `--destructive` / `--danger` | `--palette-danger-500` 或 legacy `--danger` | 错误；优先 semantic |
| `--success` | `--palette-success-500` | 成功态 |
| `--warning` | `--palette-warning-500` | 警告态 |

**示例（fuse 侧概念，勿提交进 studio）**：

```css
:root {
  --content-primary: var(--fg-primary);
  --surface-canvas: var(--surface-base);
  --accent-solid: var(--brand);
  /* …按上表补全 */
}
@import '@peri/ui/styles.css';
```

Monitor timeline 条色：`MONITOR_TIMELINE_BAR_COLORS` 已映射 studio semantic；与 fuse `BAR_COLORS` Tailwind 类 **色相差可接受** 为准，不接受则仅复用 layout、自绘色 class。

## 6. 不要做

- 把 shadcn `packages/web/src/shared/components/ui/*` **源码**搬进 `@peri/ui`
- **合并** Spectra 与 studio T1 为单一 token 表
- 把 fuse `layout.tsx`（侧栏 / project-switcher / 命令面板装配）**下沉**为 T3
- 在 fuse 复制 `@peri/ui` 的 `ui-*` / `extra.css` 规则
- 为对齐视觉而改 studio `packages/ui` 实现（应走 sandbox 定稿后再发版）

## 7. workspace 接入（peri-fuse 侧建议）

> 以下命令 **仅文档**；由 fuse 维护者在本地执行。两仓库相邻时优先 pnpm `workspace:`；否则 `file:` / 发布后 npm。

**1. 声明依赖**（`packages/web/package.json`）：

```json
{
  "dependencies": {
    "@peri/ui": "workspace:*"
  },
  "peerDependencies": {
    "solid-js": "^1"
  }
}
```

**2. pnpm workspace**（若 mono 含 studio path，示例）：

```yaml
# peri-fuse/pnpm-workspace.yaml 增加
packages:
  - 'packages/*'
  - '../peri-studio/packages/ui'
  - '../peri-studio/packages/markdown'
```

或一次性：`"@peri/ui": "file:../peri-studio/packages/ui"`

**3. 样式入口**（fuse `main.tsx` 或 `index.css` **在 Spectra 之后**）：

```ts
import '@peri/ui/styles.css';
```

**4. 类型 / 构建**：确保 bundler 编译 `solid-js` 与 `@peri/ui` 源码（Vite `ssr.noExternal` / `optimizeDeps` 按需）；`@peri/ui` 依赖 `@peri/markdown` workspace 时需一并链接。

**5. 验证**：

```bash
cd packages/web && pnpm exec tsc --noEmit
# 替换模块后跑 fuse 现有单测 / 手测 traces · session detail · IO viewer
```

## 附录 · barrel 较 extraction 文档多出的 peri-fuse 相关符号

以 `packages/ui/src/index.ts` 为准，**已导出**但 extraction / T3 正文未逐条列出、接入时可能用到：

| 符号 | 用途 |
|------|------|
| `contentToText`、`parseMaybeString` | chat IO 正文提取 |
| `toLocalDate`、`toIso`、`formatDay` | 日期筛选 |
| `formatCountLabelAsLevel`、`formatLevelCountNumber`、`monitorLevelSymbol` | level 列展示 |
| `monitorObservationTypeStyle` | type badge 样式查表 |
| `MonitorTimelineBand`、`MonitorTimelineRuler` | timeline 子块（相对 `MonitorTimelineShell`） |
| `MONITOR_TIMELINE_*` 全量常量与 layout 类型 | timeline 定制 |
| `bindShortcutsHelpHotkey` | `?` 快捷键（与 `CommandPaletteShell` 同文件） |
| `dispatchCommandPaletteOpen`、`bindCommandPaletteOpenEvent`、`COMMAND_PALETTE_OPEN_EVENT` | T4 命令式打开命令面板（如侧栏按钮） |
| `MonitorTimelineDialogShell` | trace detail 时间轴弹窗壳；timeline / detail slot |
| `MonitorObservationView` 等 `monitor/types` | 类型对齐（无运行时） |
| `IoViewerViewMode`、`IoTabKey`、`IoPreviewCellVariant` | IO 壳 props  typing |
| `FilterInputHandle`、`FILTER_SELECT_ALL` | 筛选栏 imperative / 全选 sentinel |
| `LocalIsoDateAccuracy` | 日期精度 prop |

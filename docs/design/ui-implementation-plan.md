---
status: active
date: 2026-08-30
---

# UI 设计稿 → 生产 web 实施计划

> 设计权威：`ui-sandbox/`（Tokens / Base UI / Blocks / Layers）  
> 落地目标：`web/src/shared/ui` + `web/src/widgets/*`  
> 规范：`docs/design/ui-specification.md`、`docs/design/frontend-architecture.md`

## 阶段总览

| 阶段 | 范围 | 并发 | 门禁 |
|------|------|------|------|
| **P1** | `shared/ui` + `styles/tokens` 对齐 sandbox T2 | 4 subagent | `cd web && bun run test` |
| **P2** | `widgets/*` 替换为 sandbox Blocks/Layers 视觉 | 4+ subagent | 同上 + 关键 widget 测 |
| **P3** | 验收 | 1 subagent | `bun run test` + `bun run test:browser` |
| **P4** | 清理 shim、fixture、死代码 | 2+ subagent | 全绿 + clippy 无关 |

## P1 工作包（纯 UI）

### P1-A · Tokens & 主题
- 对照 `ui-sandbox/src/styles/tokens.css`、`theme.css`、`base.css`
- 同步 `web/src/styles/tokens.css` 语义色、间距、组件 token（composer、sidebar、workbench、decision、git-graph 等）
- 更新 `web/src/styles/theme.css` Tailwind v4 映射
- 不改业务组件

### P1-B · 操作类组件
- `Button`、`IconButton`：对齐 sandbox 尺寸、圆角、primary/ghost
- `Badge`、`Status`：状态点 + 中性灰字规则
- `Spinner`、`CopyButton`
- 更新 `shared/ui/components.test.tsx`

### P1-C · 浮层与导航
- `Dialog`、`DropdownMenu`、`Tooltip`、`Popover`
- `Tabs`：对齐 sandbox 密度
- Kobalte 封装保持，只改 class/token

### P1-D · 表单与反馈
- `TextField`/`Input`、`Textarea`、`SelectField`、`Checkbox`、`RadioGroup`
- `InlineNotice`、`EmptyState`、`LoadingState`
- 与 sandbox `ComponentsPage` 对照

## P2 工作包（业务组件）

### P2-A · Shell + Sidebar
- `widgets/shell/*`、`widgets/sidebar/*` ← `ProjectSidebarLayout`、云雾分隔、Pinned/Workspaces 树
- **定稿**：Session 切换与 `SidebarNavBar` 动作留在侧栏（[`ui-specification.md` §10.1](ui-specification.md#101-壳层信息架构定稿)）
- **不在范围**：全局顶栏填满 app 名、把 New session / Search / More 迁出侧栏

### P2-B · Chat + Composer
- `widgets/chat/*`、`widgets/composer/*` ← Markdown、ToolActivity、UserBubble、SlashMenu、TokenUsageMeter

### P2-C · Resource + Git
- `widgets/resource/*` ← FileTree、FilePreview、SCM 树、GitGraphPanel、**ResourceFloatingPanel**（右轨 + 左文件预览）
- 布局契约：[`ui-specification.md` §10.2](ui-specification.md#102-资源工作台浮窗)、`resource-panel-layout.ts`
- **Git Graph 数据面**（非 UI）：wire 与投影契约见 [`git-graph-protocol.md`](git-graph-protocol.md)；视觉已落地，待接 `git-log-page` 替换 mock

### P2-D · Decision + Status
- Questions/Permissions `DecisionCard`、Status area

## P3 验收清单

- [x] Layers 对照：`project-sidebar`、`composer`、`decision`、`workbench`、`git-graph`、`source-control`（`fixture-contracts` token 消费 + `test:browser` 82 项）
- [x] Legacy token 别名桥接至 Tier 1 语义（蓝 accent / AntD 冷灰；修复 legacy 段覆盖 semantic 导致的绿色漂移）
- [x] P2 间距修复：sandbox 迁移 widget 须用生产像素刻度（`gap-8`=8px），不可混用 Tailwind ×4 语义（`gap-2`=8px in sandbox but `gap-2`=2px in prod）
- [x] `bun run test` 全绿
- [x] `bun run test:browser` 契约通过
- [x] 无 `panel/` 新增业务代码
- [x] `ui-specification.md` 与实现一致（T2 token / 字阶已对齐）

## P4 清理

- [x] `panel/components` shim 已删除
- [x] `components/ui`、`lib/cn` shim 已删除；widgets 统一 `@/shared/ui`
- [x] `layer-boundaries.test.mjs` 门禁五层依赖
- [x] visual-fixture 场景路径更新为 `widgets/*`（无重复 token 板）

## 参考路径

| Sandbox | Web 目标 |
|---------|----------|
| `ui-sandbox/src/components/ui/*` | `web/src/shared/ui/*` |
| `ui-sandbox/src/components/blocks/*` | `web/src/widgets/*` 或 `shared`（无业务语义块） |
| `ui-sandbox/src/layers/*` | `widgets` 组合参考 |

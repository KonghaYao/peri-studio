---
status: accepted
date: 2026-08-30
---

# Web 前端分层架构（权威版）

> 与 `docs/architecture.md` §10 对齐；本文是 **目录结构、依赖方向与迁移规则** 的单一事实源。
> 关联 ADR：[0004-web-frontend-layered-architecture](../adr/0004-web-frontend-layered-architecture.md)
> **Agent 入口**：根目录 [`AGENTS.md`](../../AGENTS.md)（检查清单）；[`CLAUDE.md`](../../CLAUDE.md) §Web 前端分层规范。
> **UI 规范**：[`ui-specification.md`](ui-specification.md)（色彩、组件、微文案）。
> **T3 复合块与 T4 装配**：[`t3-blocks-in-ui-package.md`](t3-blocks-in-ui-package.md)。
> **Phase 6+ 执行（拆 `panel/lib`、CSS/无头约束、业务等价）**：[`frontend-rewrite-program.md`](frontend-rewrite-program.md)。
> **有意延后项（MessageScroller 外壳、Sidebar 折叠 vs resize、测试边界）**：[`web-ui-deferrals.md`](web-ui-deferrals.md)。

## 1. 问题（迁移前，2026-08）

以下描述 Phase 0 之前的 `web/src/panel` 单体问题态；**现行目录见 §3，旧路径已删除。**

- `components/` 与 `lib/` 职责重叠（如 `composer-slash` 在 lib、`SlashMenu` 在 components，边界靠约定而非结构）。
- `components/shared/` 仅少量抽取，多数「可复用块」仍散落在 panel 根下。
- `store.ts` 组合根 500+ 行，装配、信号与领域控制器耦合。
- `components/ui` 与 `lib/cn` 分属不同顶层目录，导入路径不统一。
- 新功能缺少「放哪里」的权威答案，导致复制粘贴与循环依赖风险。

## 2. 目标

1. **五层清晰**：外壳（app）→ 页面（pages）→ 组合块（widgets）→ 特性（features）→ 实体/共享（entities / shared）。
2. **依赖单向**：下层不得 import 上层；`shared` 零业务、零 store。
3. **可测试**：`features` 与 `entities` 以纯 TS 为主，vitest / node --test 不依赖 jsdom 即可覆盖核心路径。
4. **迁移完成即删旧路径**：历史阶段允许过 shim；现行 `web/src/panel` 与 `web/src/shared/ui` 均不存在，禁止恢复。
5. **单页产品**：仍是一个 Solid SPA + 内嵌 sandbox；不引入路由框架除非产品需要。

## 3. 目标目录（`web/src/`）

```
web/src/
  app/                      # 外壳：bootstrap、全局样式入口、根 Provider 装配
    main.tsx                # 原 panel/main.tsx
    index.css               # 聚合 styles/*
    providers/              # 仅装配，不含业务 UI

  pages/                    # 页面：路由级布局，只组合 widgets + 挂 store
    panel/                  # 主工作台（AppShell、ChatView 装配）
    auth/                   # 登录页（或 auth widget 的薄包装）

  widgets/                  # 业务组合块：有 JSX，可读 store，不直接发 Action
    auth/                   # AuthGate
    sidebar/                # ProjectSidebar, SessionSearch, …
    chat/                   # ChatView, MessageList, ConversationMessage, ToolCallActivity, …
    composer/               # Composer（内联 editor/toolbar + @peri/ui SlashMenuListbox）, QuickStartComposer
    resource/               # ResourceWorkbench, …
    shell/                  # AppShell, SidebarChrome, ErrorCenter, …

  features/                 # 特性模块：领域行为，优先纯 TS；接口稳定、可单测
    auth/                   # auth-hook, auth-state, auth-setup
    session/                # activation, navigator, preferences, sidebar-order
    catalog/                # catalog-actions, project-catalog
    composer/               # slash-menu, composer-slash, prediction, draft, placeholder
    message/                # delivery, recovery, follow
    runtime/                # control, permissions, elicitations, rewind
    connection/             # ws-client, connection, command-tracker
    registry/               # registry-projection, store-projection（写侧装配）
    resource/               # resource-store, mutations, preview
    mcp/                    # mcp-apps, mcp-app-host

  entities/                 # 只读投影与视图模型：Yjs → 视图类型，无 mutation
    chat/                   # chat-view, chat-projection, control-view
    registry/               # registry-view, registry-projection（读侧）
    resource/               # resource-view
    topology/               # topology-view

  shared/                   # 跨特性基础设施；不含 UI
    lib/                    # keyboard, rfc3339, pick-directory
    protocol/               # Action/Ack 帧、常量（原 panel/lib/protocol.ts）
    yjs/                    # yjs-values, doc-store 基元

  store/                    # 全局组合根：createSignal 枢纽 + install* 接线
    index.ts                # 原 panel/store.ts（逐步瘦身）

  fixtures/                 # 原 visual-fixture（开发/视觉回归，非产品路径）

  test/                     # vitest setup
```

`packages/ui/` 位于 Web 分层之外，是私有 buildless workspace package：拥有 T1 token、Tailwind theme、T2 Base UI、T3 复合块与 `cn`，Web 与 `ui-sandbox` 均只从 `@peri/ui` barrel 消费。

## 4. 依赖规则（强制）

| 层 | 允许 import | 禁止 import |
|----|-------------|-------------|
| `shared/*` | 仅 npm / 标准库 | `entities`, `features`, `widgets`, `pages`, `store`, `app` |
| `entities/*` | `shared/*` | `features`, `widgets`, `pages`, `store` |
| `features/*` | `entities/*`, `shared/*` | `widgets`, `pages`, `store`（经构造函数注入） |
| `widgets/*` | `features/*`, `entities/*`, `shared/*`, `store` | `pages`, `app` |
| `pages/*` | `widgets/*`, `store`, `shared/*` | 另一 `pages/*` 子页面 |
| `app/*` | `pages/*`, `store`, `shared/*` | `features` 直接（经 pages/widgets） |
| `store/*` | `features/*`, `entities/*`, `shared/*` | `widgets`, `pages` |

**features 不得 import store**：所有 `createSignal` 与 Action 发送由 `store` 注入到 feature 构造函数（现有 `CatalogActions`、`SessionActivation` 模式为准）。

**widgets 不得调用 `sendFrame` 直接**：经 `store` 导出函数或 feature façade。

## 5. 组件分级定义

### 5.1 `@peri/ui`（T1 / T2 / T3）

| 子层 | 路径 | 职责 |
|------|------|------|
| **T1** | `packages/ui/src/styles/tokens.css` | 设计 token 唯一数值源 |
| **T2** | `packages/ui/src/components/` | 无业务语义原子/分子（`Button`、`Dialog`…） |
| **T3** | `packages/ui/src/components/` | 无 store/协议复合块（`ComposerShell`、`ChatWorkspaceShell`…） |

- 无 server 语义：T2/T3 不得持有 session/project/chat 业务状态。
- T3 通过 **slot / render prop**（`renderField`、`compactLeading`、`metaRow`…）暴露 T4 抓手；不得 import `web/`、`store`、`features`。
- 唯一公共入口：`@peri/ui`；禁止组件 deep import。
- T3 清单、Markdown/高亮归属见 [`t3-blocks-in-ui-package.md`](t3-blocks-in-ui-package.md)。

### 5.2 `entities`（实体投影）

- 描述「server 事实长什么样」的只读类型与 `renderX(doc)` 函数。
- 不持有连接、不订阅 Yjs（订阅在 `features/registry` 或 `store`）。

### 5.3 `features`（特性 / 用例）

- 一个用户可描述的能力单元（「打开会话」「投递消息」「slash 补全」）。
- 文件 < 500 行；接近上限则拆子模块。
- 测试：`features/<name>/*.test.ts` 与实现同目录。

### 5.4 `widgets`（T4 业务组件）

- 把 features + entities + store 信号装配为一块 UI；**消费 T3 壳层，不复制其 CSS/布局**。
- 允许 `*.test.tsx`（jsdom）；复杂逻辑仍下沉到 features。
- JSX 默认 Tailwind utility；禁止无 CSS 定义的 BEM hook（测试用 `data-testid`）。

**资源工作台**（`widgets/resource`）：`AppShell` + `ResourceWorkbench` 装配导航；`ResourceFloatingPanel` / `resource-panel-layout.ts` 负责右轨（Explorer·SCM·Graph）与左轨（文件预览）浮窗。壳层与侧栏分工见 [`ui-specification.md`](ui-specification.md) §10.1–§10.2。

### 5.5 `pages`（页面）

- 布局与路由入口；薄层，主要 `<AppShell>` 级组合。

### 5.6 `app`（外壳）

- `main.tsx`、`index.html` 引用的样式与 Provider 树。

## 5.7 样式与 CSS 规范

### 级联顺序（生产）

`web/src/styles.css`：

1. `web/src/styles/base.css` — 全局 reset、a11y
2. `@peri/ui/styles.css` — `tokens` → `theme` → `primitives` → **`extra.css`（T3 壳层主战场）**
3. `web/src/styles/primitives.css` — 极少应用级编排（message hover、composer safe-bottom）
4. `web/src/styles/extra.css` — **仅**无法下沉的 web 例外（~50 行；`EXTRA_CSS_BASELINE` 门禁）

### 类名约定

| 范围 | 约定 | 示例 |
|------|------|------|
| T3 package | `ui-<domain>-*` | `ui-composer-surface-v2`、`ui-chat-column`、`ui-rewind-panel__state` |
| Web 应用例外 | 尽量少；有 CSS 才加 class | `composer-wrap--overlay`、`sidebar-resize-handle--dragging` |
| Widget JSX | Tailwind + T3 导出类 | `ui-chat-column gap-8`；**禁止** `foo__bar` 无规则占位 |

### 何时写 `extra.css`

满足 **其一**方可登记：子选择器编排、浏览器私有属性、跨子树响应式组合、第三方注入 DOM。禁止字面量颜色/间距，须 `var(--*)`。

### JSX 硬约束

- 禁止任意 Tailwind bracket（`w-[…]`、`max-[640px]:`、`[&_…]`）— `web/tests/css-contracts.test.mjs`
- 重复栅格：`tokens.css` 声明 `--grid-cols-*` → `theme.css` 映射
- T3 类名前缀 — `packages/ui/tests/css-contracts.test.mjs`

### Markdown 与语法高亮

- **解析**：`@peri/markdown`（`stream-markdown-parser` / markstream 生态）
- **Fence 着色**：`@peri/ui` + `@tanstack/highlight`（不用 Shiki）

## 6. Store 瘦身方向

`store/index.ts` 仅保留：

1. 全局信号声明与 selector 导出。
2. `installStoreProjection` / `installStoreWiring` 等装配。
3. 对外的薄导出函数（`navigateProjectSession`, `sendMessage`, …），实现委托给 `features/*`。

禁止在 store 内新增业务分支；新逻辑先进 feature，再由 store 挂一行委托。

## 7. 历史迁移策略（Phase 0–5 已完成）

### Phase 0（本文档 + ADR）

- 锁定分层与依赖表；CI 暂不强制（后续 eslint-boundaries）。

### Phase 1 — 脚手架与共享层

- 建立 `shared/ui`、`shared/lib` 路径别名 `@/shared/ui`。
- `components/ui` → `shared/ui` 物理移动；旧路径 re-export。
- `lib/cn.ts` → `shared/lib/cn.ts`。

### Phase 2 — 垂直切片：Composer

- `features/composer/*` ← slash-menu, composer-slash, composer-prediction, composer-draft, composer-placeholder
- `widgets/composer/*` ← Composer（内联 editor/toolbar + `@peri/ui` `SlashMenuListbox`）、QuickStartComposer；slash 目录在 `features/composer/slash-menu-catalog.ts`
- 测试与 import 一并迁移。

### Phase 3 — 垂直切片：Session / Catalog

- `features/session/*`, `features/catalog/*`
- `widgets/sidebar/*`

### Phase 4 — Entities 抽离

- `entities/registry`, `entities/chat`, `entities/resource` 从 `panel/lib` 迁出。

### Phase 5 — Store 与 pages 收口

- `store/index.ts` 瘦身；`pages/panel` 装配；删除 `panel/` 下已迁空的 shim。

每阶段要求：`cd web && bun run test` 全绿。

## 8. 导入别名（Vite / TS）

```ts
// tsconfig paths + vite resolve.alias
"@/shared/*"   → web/src/shared/*
"@/entities/*" → web/src/entities/*
"@/features/*" → web/src/features/*
"@/widgets/*"  → web/src/widgets/*
"@/pages/*"    → web/src/pages/*
"@/store"      → web/src/store/index.ts
"@/app/*"      → web/src/app/*
```

~~迁移期间保留 `@/panel/*` shim 指向旧路径，标记 `/** @deprecated use @/widgets */`。~~ **`web/src/panel` 已删除**（frontend-rewrite Phase 6+）；勿再添加 `@/panel` 路径。

## 9. 测试布局

| 类型 | 位置 | 运行器 |
|------|------|--------|
| feature 单测 | `features/**/*.test.ts` | vitest |
| entity 单测 | `entities/**/*.test.ts` | vitest |
| widget 单测 | `widgets/**/*.test.tsx` | vitest jsdom |
| 协议契约 | `web/tests/*.test.mjs` | node --test |
| 浏览器契约 | `web/tests/browser/*` | playwright |

## 10. 与现有文档关系

- 产品行为契约：仍见 `architecture.md` §3.0、§10.3。
- MCP Apps 宿主：`design/mcp-apps-host.md` 中路径在 Phase 4 后改为 `features/mcp`、`widgets/chat/McpAppFrame`。
- 术语：`terminology.md` 不变；代码目录名用英文 feature 名，UI 文案仍英文。

## 11. 验收

### Phase 1–3（历史阶段；已完成，T1/T2 后由 `@peri/ui` 迁移取代）

- [x] `@peri/ui` 为唯一 T2 入口（`web/src/shared/ui` 已删除）。
- [x] Composer 全链路文件位于 `features/composer` + `widgets/composer`。
- [x] Session 侧栏相关位于 `features/session|catalog` + `widgets/sidebar`。

### Phase 4–5（已完成）

- [x] `entities/{registry,chat,resource,topology}` 承载只读投影；`shared/yjs` 承载 doc-store 基元。
- [x] 剩余 `panel/components` 迁至 `widgets/{shell,chat,auth,resource}`。
- [x] `store/index.ts` 为组合根；`app/main.tsx` + `pages/panel` 为入口装配。
- [x] Phase 2–3 无引用 shim 已删除；`panel/` 目录已删除（原 `panel/store.ts`、`panel/main.tsx` deprecated 重导出已随目录移除）。
- [x] `bun run test` 通过。

### 后续（Phase 6+）

Phase 1–5 只完成了目录脚手架与部分垂直切片；领域实现已迁入 `features/*`。**停止无限期 shim / 绞杀。** 执行策略、CSS/Tailwind 硬约束、社区无头优先、以及「只迁不改业务逻辑」见 [`frontend-rewrite-program.md`](frontend-rewrite-program.md)。

- [x] 按重写纲领包 A–H 物理迁移并删除 `web/src/panel`（2026-09-08：`panel/` 目录已移除；`@/panel/*` shim 已删）。
- [x] `entities/*` 去除对 `panel/lib` 的依赖，只认 `@/shared` 与 `entities` 内模块（生产 import 已清零；层边界测试仍保留历史 baseline 描述字符串）。
- [ ] ESLint import 边界规则强制执行五层依赖表。
- [x] `css-contracts` 扩展：任意值 bracket、小数 spacing、`@peri/ui` 消费边界、widgets `<style>`、`extra.css` 行数/hash 冻结（WP-BOUND）。
- [x] `store/index.ts` 继续瘦身（570→**483** 行；新增 `store/catalog-bootstrap.ts`、`store/catalog-machine-api.ts`，经 `index` 再导出）。
- [x] widgets 统一 `@/features/*` 别名（`LaunchWorkspace`、`SessionImportDialog`、`SessionSearch` 及 `store/reset-session` 相对路径已清零）。
- [ ] WP-H / WP-CSS / WP-VIS（`extra.css` 相对 435 行基线净减、sandbox 刻度、视觉收敛）。

迁移期间 ~~保留 `@/panel/*` shim~~ → **已删除**；新代码仅使用 `@/widgets`、`@/features`、`@/store` 等别名。

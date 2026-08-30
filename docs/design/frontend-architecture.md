---
status: accepted
date: 2026-08-30
---

# Web 前端分层架构（权威版）

> 与 `docs/architecture.md` §10 对齐；本文是 **目录结构、依赖方向与迁移规则** 的单一事实源。
> 关联 ADR：[0004-web-frontend-layered-architecture](../adr/0004-web-frontend-layered-architecture.md)

## 1. 问题

当前 `web/src/panel` 将页面、业务组件、领域控制器与协议边界混在同一扁平目录：

- `components/` 与 `lib/` 职责重叠（如 `composer-slash` 在 lib、`SlashMenu` 在 components，边界靠约定而非结构）。
- `components/shared/` 仅少量抽取，多数「可复用块」仍散落在 panel 根下。
- `store.ts` 组合根 500+ 行，装配、信号与领域控制器耦合。
- `components/ui` 与 `lib/cn` 分属不同顶层目录，导入路径不统一。
- 新功能缺少「放哪里」的权威答案，导致复制粘贴与循环依赖风险。

## 2. 目标

1. **五层清晰**：外壳（app）→ 页面（pages）→ 组合块（widgets）→ 特性（features）→ 实体/共享（entities / shared）。
2. **依赖单向**：下层不得 import 上层；`shared` 零业务、零 store。
3. **可测试**：`features` 与 `entities` 以纯 TS 为主，vitest / node --test 不依赖 jsdom 即可覆盖核心路径。
4. **可渐进迁移**：旧路径通过 `index.ts` 重导出保持兼容，直至调用方迁完再删 shim。
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
    chat/                   # ChatView, MessageList, ConversationMessage, …
    composer/               # Composer, SlashMenu, QuickStartComposer
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

  shared/                   # 跨特性基础设施
    ui/                     # 原 components/ui（Kobalte 封装，design system）
    lib/                    # cn, keyboard, rfc3339, pick-directory
    protocol/               # Action/Ack 帧、常量（原 panel/lib/protocol.ts）
    yjs/                    # yjs-values, doc-store 基元

  store/                    # 全局组合根：createSignal 枢纽 + install* 接线
    index.ts                # 原 panel/store.ts（逐步瘦身）

  fixtures/                 # 原 visual-fixture（开发/视觉回归，非产品路径）

  test/                     # vitest setup
```

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

### 5.1 `shared/ui`（基础组件）

- 无 server 语义、无 session/project/chat 概念。
- Props 为通用 UI 契约（`Button`, `Listbox`, `Dialog`）。
- 唯一公共入口：`shared/ui/index.ts`。

### 5.2 `entities`（实体投影）

- 描述「server 事实长什么样」的只读类型与 `renderX(doc)` 函数。
- 不持有连接、不订阅 Yjs（订阅在 `features/registry` 或 `store`）。

### 5.3 `features`（特性 / 用例）

- 一个用户可描述的能力单元（「打开会话」「投递消息」「slash 补全」）。
- 文件 < 500 行；接近上限则拆子模块。
- 测试：`features/<name>/*.test.ts` 与实现同目录。

### 5.4 `widgets`（业务组件）

- 把 features + entities + store 信号装配为一块 UI。
- 允许 `*.test.tsx`（jsdom）；复杂逻辑仍下沉到 features。

### 5.5 `pages`（页面）

- 布局与路由入口；薄层，主要 `<AppShell>` 级组合。

### 5.6 `app`（外壳）

- `main.tsx`、`index.html` 引用的样式与 Provider 树。

## 6. Store 瘦身方向

`store/index.ts` 仅保留：

1. 全局信号声明与 selector 导出。
2. `installStoreProjection` / `installStoreWiring` 等装配。
3. 对外的薄导出函数（`navigateProjectSession`, `sendMessage`, …），实现委托给 `features/*`。

禁止在 store 内新增业务分支；新逻辑先进 feature，再由 store 挂一行委托。

## 7. 迁移策略（绞杀者）

### Phase 0（本文档 + ADR）

- 锁定分层与依赖表；CI 暂不强制（后续 eslint-boundaries）。

### Phase 1 — 脚手架与共享层

- 建立 `shared/ui`、`shared/lib` 路径别名 `@/shared/ui`。
- `components/ui` → `shared/ui` 物理移动；旧路径 re-export。
- `lib/cn.ts` → `shared/lib/cn.ts`。

### Phase 2 — 垂直切片：Composer

- `features/composer/*` ← slash-menu, composer-slash, composer-prediction, composer-draft, composer-placeholder
- `widgets/composer/*` ← Composer, SlashMenu, QuickStartComposer
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

迁移期间保留 `@/panel/*` shim 指向旧路径，标记 `/** @deprecated use @/widgets */`。

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

## 11. 验收（Phase 1–3 完成时）

- [ ] `shared/ui` 为唯一设计系统入口；`components/ui` 仅 re-export。
- [ ] Composer 全链路文件位于 `features/composer` + `widgets/composer`。
- [ ] Session 侧栏相关位于 `features/session|catalog` + `widgets/sidebar`。
- [ ] `bun run test` 与 `bun run test:browser` 通过。
- [ ] `architecture.md` §10.2 指向本文档。

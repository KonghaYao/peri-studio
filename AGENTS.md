# AGENTS.md

面向 Cursor / Claude Code 等 AI Agent 的仓库协作指南。**改动前请先读本文与 `CLAUDE.md`；架构语义以 `docs/architecture.md` 与 `docs/terminology.md` 为准。**

---

## 必读文档（按场景）

| 场景 | 文档 |
|------|------|
| 全栈架构、server 契约、Yjs 投影 | `docs/architecture.md` |
| 术语（session / chat / project session 等） | `docs/terminology.md` |
| **Web 目录、分层、依赖方向、新代码放哪** | **`docs/design/frontend-architecture.md`（权威）** |
| Web 分层 ADR | `docs/adr/0004-web-frontend-layered-architecture.md` |
| MCP Apps 宿主 | `docs/design/mcp-apps-host.md` |

---

## Web 前端分层（重点）

> **所有 `web/` 改动必须遵守五层目录与单向依赖。** 详细规则、路径别名与迁移状态见 [`docs/design/frontend-architecture.md`](docs/design/frontend-architecture.md)。

### 目录与职责

```
web/src/
  app/           bootstrap、全局样式入口（main.tsx）
  pages/         页面级装配，只组合 widgets
  widgets/       业务 UI 组合块（Solid JSX，可读 store）
  features/      可测试领域用例（纯 TS 优先，依赖注入）
  entities/      Yjs 只读投影与视图类型
  shared/        ui（设计系统）、lib、protocol、yjs
  store/         全局组合根（index.ts）
  panel/         遗留 shim + 待迁 lib（逐步空心化，勿新增业务）
```

### 依赖方向（强制）

| 层 | 允许 import | 禁止 |
|----|-------------|------|
| `shared/*` | npm | `entities`, `features`, `widgets`, `pages`, `store`, `app` |
| `entities/*` | `shared/*` | `features`, `widgets`, `pages`, `store` |
| `features/*` | `entities/*`, `shared/*` | `widgets`, `pages`, **`store`**（须构造函数注入） |
| `widgets/*` | `features`, `entities`, `shared`, `store` | `pages`, `app`；**禁止直调 `sendFrame`** |
| `pages/*` | `widgets`, `store`, `shared` | 其他 `pages` |
| `app/*` | `pages`, `store`, `shared` | 直接 import `features` |
| `store/*` | `features`, `entities`, `shared` | `widgets`, `pages` |

### 新代码放置（决策树）

1. **无业务语义的 Button / Dialog / cn** → `shared/ui` 或 `shared/lib`
2. **Yjs Doc → 只读视图类型 / render\*** → `entities/<domain>/`
3. **用户可描述的用例逻辑（可单测、无 JSX）** → `features/<name>/`
4. **多块 UI 组合（侧栏、Chat、Composer）** → `widgets/<area>/`
5. **整页布局** → `pages/<route>/`
6. **全局信号装配、对外 action 导出** → `store/index.ts`（业务逻辑仍下沉 feature）

**禁止**：在 `panel/lib` 或 `panel/components` 新增实现；仅允许保留 deprecated shim。新 import 使用 `@/shared`、`@/entities`、`@/features`、`@/widgets`、`@/pages`、`@/store`。

### 测试落点

| 类型 | 位置 | 命令 |
|------|------|------|
| feature / entity | `features/**/*.test.ts`, `entities/**/*.test.ts` | `cd web && bun run test` |
| widget | `widgets/**/*.test.tsx` | vitest jsdom |
| 协议 / 状态契约 | `web/tests/*.test.mjs` | node --test |
| 浏览器契约 | `web/tests/browser/*` | `bun run test:browser` |

### 前端改动检查清单

- [ ] 新文件落在正确层，未违反依赖表
- [ ] `features` 未 import `store`；`shared/ui` 未 import 业务模块
- [ ] 单文件 < 500 行；UI 文案英文，注释中文，**log 英文**
- [ ] `cd web && bun run test` 全绿
- [ ] 若改变目录契约，同步 `docs/design/frontend-architecture.md` 与 `docs/architecture.md` §10.2

---

## 后端与全栈（摘要）

- Rust 模块单一职责；注释中文，**log 英文**；`cargo clippy --workspace --all-targets -- -D warnings` 零告警。
- 术语以 `terminology.md` 为准；四层身份（`project_id` / `project_session_id` / ACP `session_id` / `chat_id`）不可混用。
- 副作用与 `commandId` 幂等见 `architecture.md` §3.0；token 不得进代码、日志或 issue。
- 常用验证：`cargo test -p peri-studio-server --lib`、`cd web && bun run test`、`./dev.sh`。

## Commit 与文档

- Commit message 使用中文；只在你被要求时提交。
- 架构决策写 ADR（`docs/adr/`）；设计证据写 `docs/design/`。

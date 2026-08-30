# AGENTS.md

面向 Cursor / Claude Code 等 AI Agent 的仓库协作指南。**改动前请先读本文与 `CLAUDE.md`；架构语义以 `docs/architecture.md` 与 `docs/terminology.md` 为准。**

---

## 必读文档（按场景）

| 场景 | 文档 |
|------|------|
| 全栈架构、server 契约、Yjs 投影 | `docs/architecture.md` |
| 术语（session / chat / project session 等） | `docs/terminology.md` |
| **Web 目录、分层、依赖方向、新代码放哪** | **`docs/design/frontend-architecture.md`（权威）** |
| **Web 视觉、token、组件、微文案、a11y** | **`docs/design/ui-specification.md`（权威）** |
| **设计稿 → 生产落地计划与映射表** | **`docs/design/ui-implementation-plan.md`** |
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

### UI Sandbox（设计权威，先于生产）

`ui-sandbox/` 与 `web/` **完全隔离构建**；新视觉与交互须先在 sandbox 定稿，再镜像到生产。

| Sandbox Tier | 路径 | 生产落点 |
|--------------|------|----------|
| **T1 · Tokens** | `ui-sandbox/src/styles/tokens.css` | `web/src/styles/tokens.css` + `theme.css` |
| **T2 · Base UI** | `ui-sandbox/src/components/ui/` | `web/src/shared/ui/` |
| **T3 · Blocks** | `ui-sandbox/src/components/blocks/` | `web/src/widgets/*` 或 `shared/ui`（无业务语义时） |
| **T4 · Layers** | `ui-sandbox/src/layers/` | `widgets` 组合参考（不直接 import） |
| **Extra** | `ui-sandbox/src/styles/extra.css` | `web/src/styles/extra.css`（Tailwind 无法表达的例外） |

**工作流（强制）**

1. 在 `ui-sandbox` 新增/调整组件与 demo（`#/components`、`#/blocks`、`#/layers`）。
2. `cd ui-sandbox && bun run typecheck` 通过。
3. 将同等视觉契约镜像到 `web/`（类名、token、交互语义一致；**间距用生产像素刻度**，见下）。
4. `cd web && bun run test` 全绿；涉及壳层/侧栏时补 widget 测或 `css-contracts`。

**间距刻度陷阱**：`web` 的 Tailwind 数字 utility 映射 `--space-N`（`gap-8` = 8px）；`ui-sandbox` 部分区域用 Tailwind ×4 基值（`gap-2` = 8px）。**禁止**把 sandbox 的 `gap-2`、`px-2.5` 等类名原样抄到 `web` 而不换算；以 `tokens.css` 像素为准。

**启动**

```bash
./dev-sandbox.sh          # http://127.0.0.1:5273/ ，仅 Vite，不启 server/instance
cd ui-sandbox && bun run typecheck
```

`dev-sandbox.sh` 与 `dev.sh` 一样**只能由用户本地手动执行**；Agent 不得代启，可改脚本与跑 `typecheck`。

**缺后端能力**：先在 sandbox / widget 用 mock 数据演示 UI；生产侧 `features/*` + 测试夹具对齐契约，禁止在浏览器伪造 server 历史。

### 已确立的 UI 模式（2026-08）

| 模式 | Sandbox | 生产 |
|------|---------|------|
| 分段按钮组 | `components/ui/ButtonGroup.tsx` | `shared/ui/ButtonGroup.tsx` |
| 侧栏行浮动 accessory | `blocks/chrome/RowAccessorySlot.tsx` | `widgets/sidebar/sidebar-parts.tsx` |
| Session 行操作 | `SessionRowAccessory`（Pin \| Archive \| More） | 同上 + `ProjectSessionRow` |
| Project 行操作 | `ProjectRowAccessory`（计数 + More \| New session） | `ProjectSidebar` |
| 归档浏览列表 | `ArchivedBrowserList` | `ArchivedBrowserDialog` |
| 搜索弹窗列表密度 | — | `SessionSearch`、`ArchivedBrowserDialog`：`gap-1` 列表、`min-h-32` 行、`py-6 px-10`、`text-11` 副标题 |

**ButtonGroup 契约**：透明底、无阴影、无外层 border；段间 `border-r`；hover `bg-interaction-hover`。侧栏 accessory **绝对定位叠层**，不占文档流（meta 与 actions 淡入淡出）。

**侧栏边框**：右边框 `border-border-faint`；拖拽条 hover `--sidebar-resize-handle-hover`（浅灰，非 accent）。

**侧栏折叠态**：workspace 折叠时**不**显示「No sessions yet」；空状态仅在展开后的 session 列表内展示。

**IconButton**：侧栏已有可见文案/菜单语义时用 `showTooltip={false}`，避免重复 tooltip（`css-contracts` 约束）。

### CSS 规范（全 Tailwind + extra.css 例外）

生产 Web 样式四级级联（入口 `web/src/styles.css`）：

```
tokens.css   → 设计值唯一来源（颜色、间距、容器、--grid-cols-*）
theme.css    → Tailwind v4 @theme inline（utility 与命名断点 max-desk / max-compact 等）
primitives.css → 跨组件原子（滚动条、ui-spinner、ui-control-transition、git-graph）
extra.css    → 无法纳入 Tailwind 的语义 class（子选择器、WebKit hack、Mermaid SVG 等）
```

**JSX 写法**

- 优先 Tailwind token utility：`gap-8`、`w-(--container-dialog-default)`、`grid-cols-split-auto`、`max-compact:px-8`
- 禁止任意 bracket：`w-[360px]`、`grid-cols-[minmax(0,1fr)_auto]`、`max-[640px]:`、`[&_p]:mb-3`
- 重复布局：在 `tokens.css` 加 `--grid-cols-*` → `theme.css` 映射 → JSX 用 `grid-cols-*`
- 例外：语义 class + `extra.css`（如 `.markdown-body`、`.rewind-panel__actions`、`.ui-line-clamp-2`）

**契约**：`web/tests/css-contracts.test.mjs`（widgets 无 bracket utility、spacing 数字须在 theme 声明、extra.css 被入口 import）。

**Sandbox 对齐**：`ui-sandbox` 与 `web` 共用同一 CSS 级联规则（`extra.css` 登记例外）；演示页禁止 bracket utility，新 token 先改 sandbox `tokens.css` 再同步 `web`。

### 测试落点

| 类型 | 位置 | 命令 |
|------|------|------|
| feature / entity | `features/**/*.test.ts`, `entities/**/*.test.ts` | `cd web && bun run test` |
| widget | `widgets/**/*.test.tsx` | vitest jsdom |
| 协议 / 状态契约 | `web/tests/*.test.mjs` | node --test |
| 浏览器契约 | `web/tests/browser/*` | `bun run test:browser` |
| sandbox 类型检查 | `ui-sandbox/` | `cd ui-sandbox && bun run typecheck` |

### 本地启动权限

- `dev.sh`、`dev-sandbox.sh` 只能由用户在本地终端手动执行。
- Agent 不得调用 `./dev.sh`、`./dev-sandbox.sh`、重启或停止其进程，也不得通过后台 shell 代执行。
- 需要运行时验证时，Agent 应停止并请用户执行；Agent 只能运行不启动
  server/instance 的静态检查、类型检查和单元/协议测试（含 `ui-sandbox` typecheck）。

### 前端改动检查清单

- [ ] 视觉变更是否已在 `ui-sandbox` 定稿并 typecheck 通过
- [ ] 新文件落在正确层，未违反依赖表
- [ ] `features` 未 import `store`；`shared/ui` 未 import 业务模块
- [ ] 颜色/间距来自 `tokens.css` utility，符合 `ui-specification.md`；sandbox→web 间距已按生产刻度换算
- [ ] JSX 无任意 Tailwind bracket（`w-[…]`、`[&_…]`）；例外已登记 `web/src/styles/extra.css`
- [ ] 单文件 < 500 行；UI 文案英文，注释中文，**log 英文**
- [ ] `cd web && bun run test` 全绿
- [ ] 若改变目录、token 或视觉契约，同步 `frontend-architecture.md` / `ui-specification.md` / `ui-implementation-plan.md` 与 `architecture.md` §10.2

---

## 后端与全栈（摘要）

- Rust 模块单一职责；注释中文，**log 英文**；`cargo clippy --workspace --all-targets -- -D warnings` 零告警。
- 术语以 `terminology.md` 为准；四层身份（`project_id` / `project_session_id` / ACP `session_id` / `chat_id`）不可混用。
- 副作用与 `commandId` 幂等见 `architecture.md` §3.0；token 不得进代码、日志或 issue。
- 常用验证：`cargo test -p peri-studio-server --lib`、`cd web && bun run test`；
  `./dev.sh` 仅由用户手动执行。

## Commit 与文档

- Commit message 使用中文；只在你被要求时提交。
- 架构决策写 ADR（`docs/adr/`）；设计证据写 `docs/design/`。

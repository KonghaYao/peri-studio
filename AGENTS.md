# AGENTS.md

面向 Cursor / Claude Code 等 AI Agent 的仓库协作指南。**改动前请先读本文与 `CLAUDE.md`；架构语义以 `docs/architecture.md` 与 `docs/terminology.md` 为准。**

---

## 必读文档（按场景）

| 场景 | 文档 |
|------|------|
| 全栈架构、server 契约、Yjs 投影 | `docs/architecture.md` |
| 术语（session / chat / project session 等） | `docs/terminology.md` |
| **Web 目录、分层、依赖方向、新代码放哪** | **`docs/design/frontend-architecture.md`（权威）** |
| **Web Phase 6+ 重写（拆 panel、CSS/无头、业务等价）** | **`docs/design/frontend-rewrite-program.md`** |
| **Web 视觉、token、组件、微文案、a11y** | **`docs/design/ui-specification.md`（权威）** |
| **设计稿 → 生产落地计划与映射表** | **`docs/design/ui-implementation-plan.md`** |
| **Git Graph 数据面（machine → server → web）** | **`docs/design/git-graph-protocol.md`（权威）** |
| **`@peri/ui` 设计系统包、移除 `shared/ui`（一步到位）** | **`docs/design/ui-package-migration.md`（权威）** |
| **T3 复合块清单、T4 装配、Markdown/高亮归属** | **`docs/design/t3-blocks-in-ui-package.md`（权威）** |
| Web 分层 ADR | `docs/adr/0004-web-frontend-layered-architecture.md` |
| MCP Apps 宿主 | `docs/design/mcp-apps-host.md` |

---

## Web 前端分层（重点）

> **所有 `web/` 改动必须遵守五层目录与单向依赖。** T2 设计系统见 **`packages/ui`（`@peri/ui`）**，不在 `web/src/shared/ui`（迁移见 [`ui-package-migration.md`](docs/design/ui-package-migration.md)）。详细规则见 [`frontend-architecture.md`](docs/design/frontend-architecture.md)。

### 目录与职责

```
packages/ui/     @peri/ui：T1 样式 + T2 组件 + T3 复合块 + cn（Barrel 唯一出口）
ui-sandbox/      Storybook 式 demos；消费 @peri/ui，不复制 T2/T3 源码

web/src/
  app/           bootstrap、全局样式入口（main.tsx）
  pages/         页面级装配，只组合 widgets
  widgets/       业务 UI 组合块（Solid JSX，可读 store）
  features/      可测试领域用例（纯 TS 优先，依赖注入）
  entities/      Yjs 只读投影与视图类型
  shared/        lib、protocol、yjs（迁移后无 ui 子目录）
  store/         全局组合根（index.ts）
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

1. **无业务语义的 Button / Dialog / cn（T2）** → `packages/ui`，仅从 `@peri/ui` barrel 导出
2. **无 store/协议的可复用复合块（T3）** → `packages/ui`（`ComposerShell`、`ChatWorkspaceShell`…）；T4 只 slot 接线
3. **Yjs Doc → 只读视图类型 / render\*** → `entities/<domain>/`
4. **用户可描述的用例逻辑（可单测、无 JSX）** → `features/<name>/`
5. **store + features 装配的多块 UI（T4）** → `widgets/<area>/`
6. **整页布局** → `pages/<route>/`
7. **全局信号装配、对外 action 导出** → `store/index.ts`（业务逻辑仍下沉 feature）

**禁止**：在 `panel/lib` 或 `panel/components` 新增实现；仅允许保留 deprecated shim。新 import 使用 `@/shared`、`@/entities`、`@/features`、`@/widgets`、`@/pages`、`@/store`。

### UI Sandbox（设计权威，先于生产）

`ui-sandbox/` 与 `web/` **完全隔离构建**；新视觉与交互须先在 sandbox 定稿，再镜像到生产。

| Sandbox Tier | 路径 | 生产落点 |
|--------------|------|----------|
| **T1 · Tokens** | `packages/ui/src/styles/tokens.css` | `@peri/ui/styles.css`（Web 与 Sandbox 共用） |
| **T2 · Base UI** | `packages/ui/src/components/` | Web 与 Sandbox 均从 `@peri/ui` barrel 消费 |
| **T3 · Blocks** | `ui-sandbox/src/components/blocks/`（重导出 `@peri/ui`） | `packages/ui` + `web/widgets` T4 装配 |
| **T4 · Layers** | `ui-sandbox/src/layers/` | `widgets` 组合参考（不直接 import） |
| **Extra** | `ui-sandbox/src/styles/extra.css` | `web/src/styles/extra.css`（Tailwind 无法表达的例外） |

**工作流（强制）**

1. 在 `packages/ui` 调整 T1/T2 契约与测试，在 `ui-sandbox` 新增/调整 demo（`#/home` 封面、`#/components`、`#/blocks`、`#/layers`）。
2. `cd packages/ui && bun run test`、`cd ui-sandbox && bun run typecheck` 通过。
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
| 分段按钮组 | `packages/ui/src/components/ButtonGroup.tsx` + Components demo | `@peri/ui` |
| 侧栏行浮动 accessory | `blocks/chrome/RowAccessorySlot.tsx` | `widgets/sidebar/sidebar-parts.tsx` |
| Session 行操作 | `SessionRowAccessory`（Pin \| Archive \| More） | 同上 + `ProjectSessionRow` |
| Project 行操作 | `ProjectRowAccessory`（计数 + More \| New session） | `ProjectSidebar` |
| 归档浏览列表 | `ArchivedBrowserList` | `ArchivedBrowserDialog` |
| 搜索弹窗列表密度 | — | `SessionSearch`、`ArchivedBrowserDialog`：`gap-1` 列表、`min-h-32` 行、`py-6 px-10`、`text-11` 副标题 |
| 资源 / 文件预览浮窗 | — | 右 `ResourceFloatingPanel`（Explorer·SCM·Graph）；左 `ResourceFloatingPanel` + `ResourceFileEditor floating` |

**壳层 chrome（定稿）**：New session / Search / More 与 instance 行留在 `ProjectSidebar`（`SidebarNavBar`），**不做**全局顶栏迁移（`docs/design/ui-specification.md` §10.1）。

**工具可点击路径**：`features/chat/tool-file-link.ts` 只对 Read/Write/Edit 等稳定 `file_path`（及等价字段）生成链接；**Grep/Glob 的 pattern 不是文件路径**，不得与 filesystem 工具共用同一链接规则。

**ButtonGroup 契约**：透明底、无阴影、无外层 border；段间 `border-r`；hover `bg-interaction-hover`。侧栏 accessory **绝对定位叠层**，不占文档流（meta 与 actions 淡入淡出）。

**侧栏边框**：右边框 `border-border-faint`；拖拽条 hover `--sidebar-resize-handle-hover`（浅灰，非 accent）。

**侧栏折叠态**：workspace 折叠时**不**显示「No sessions yet」；空状态仅在展开后的 session 列表内展示。

**IconButton**：侧栏已有可见文案/菜单语义时用 `showTooltip={false}`，避免重复 tooltip（`css-contracts` 约束）。

### 组件与 CSS 规范（权威摘要）

完整 T3 清单与装配表见 [`t3-blocks-in-ui-package.md`](docs/design/t3-blocks-in-ui-package.md)。

#### 组件分级

| 层级 | 路径 | 规则 |
|------|------|------|
| T1 | `packages/ui/src/styles/tokens.css` | 唯一数值源；禁止 web/sandbox 另起间距/颜色 |
| T2 | `packages/ui/src/components/` | 无业务语义；barrel 唯一出口 |
| T3 | `packages/ui/src/components/` | 无 store/协议；`ui-<domain>-*` 类名；slot 供 T4 |
| T4 | `web/src/widgets/` | 只装配，不复制 T3 布局/CSS |

#### 样式级联（生产 `web/src/styles.css`）

```
web/base.css
  → @peri/ui/styles.css（tokens → theme → primitives → extra → markdown-body）
  → web/primitives.css（空文件）
  → web/extra.css（空文件；有 baseline 门禁）
```

- **T3 壳层 CSS** 一律在 `packages/ui/src/styles/extra.css`（Composer、Transcript、Workbench、Rewind…）。
- **web/extra.css** 与 **web/primitives.css** 不持有业务自定义规则；改 extra.css 须更新 `EXTRA_CSS_BASELINE`。
- **禁止**在 widget JSX 使用无 CSS 定义的 BEM hook；测试用 `data-testid`，布局用 Tailwind。

#### JSX 写法（`widgets` / `pages` / `features` / `app`）

- 优先 Tailwind token utility：`gap-8`、`w-(--container-dialog-default)`、`ui-chat-column`、`grid-cols-split-auto`
- 禁止任意 bracket：`w-[360px]`、`max-[640px]:`、`[&_p]:mb-3`
- 重复布局：`tokens.css` → `theme.css` → `grid-cols-*`
- 自定义 CSS 准入：子选择器编排、私有属性、跨子树响应式、第三方注入 DOM；颜色/间距必须 `var(--*)`

#### Markdown 与语法高亮

| 能力 | 包 | 说明 |
|------|-----|------|
| 解析 / 流式 AST | `@peri/markdown` | `stream-markdown-parser`（markstream 生态） |
| Fence 着色 | `@peri/ui` | `@tanstack/highlight` + `HighlightedCodeBody` |

#### 契约测试

| 门禁 | 路径 |
|------|------|
| Web CSS / 消费边界 | `web/tests/css-contracts.test.mjs` |
| Package T3 类名前缀 | `packages/ui/tests/css-contracts.test.mjs` |

**Sandbox 对齐**：共用 `@peri/ui/styles.css`；`ui-sandbox/extra.css` 不复制 package 规则。间距以 `tokens.css` 像素为准（web `gap-8`=8px，sandbox 部分区域 Tailwind×4，勿原样抄写）。

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
- [ ] `features` 未 import `store`；`packages/ui` 未 import Web 业务模块
- [ ] T3 壳层在 `@peri/ui`；T4 widget 仅 slot 装配，无重复 CSS/布局
- [ ] 颜色/间距来自 `tokens.css` utility，符合 `ui-specification.md`；sandbox→web 间距已按生产刻度换算
- [ ] JSX 无任意 Tailwind bracket（`w-[…]`、`[&_…]`）；T3 例外在 `packages/ui/extra.css`，web 例外在 `web/extra.css` 并更新 baseline
- [ ] 无孤儿 BEM class（有 class 必有 CSS，或改用 `data-testid`/Tailwind）
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

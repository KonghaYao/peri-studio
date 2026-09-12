---
status: accepted
owner: web-platform
last_updated: 2026-09-11
review_gate: passed
---

# `@peri/ui` 设计系统包与 UI Catalog 迁移（权威方案）

> **本文权威范围**：`@peri/ui` 的包边界、T1/T2 源码归属、`ui-sandbox` 的 Storybook-equivalent 角色、迁移顺序与验收门禁。
>
> **当前状态**：设计门已通过并完成技术迁移；`@peri/ui` 已成为 T1/T2 单一事实源。尚需用户本地运行 `./dev-sandbox.sh` 完成人工视觉审阅。
>
> **相关规范**：视觉与交互以 [`ui-specification.md`](ui-specification.md) 为准；Web 分层以 [`frontend-architecture.md`](frontend-architecture.md) 为准。

---

## 1. 已定决策

| 主题 | 决策 |
|------|------|
| npm 包 | 建立顶层 `packages/ui`，包名 `@peri/ui`。V1 是 `private`、buildless 的 Bun workspace npm 包，不发布 registry。 |
| “所有 component” | 仅指**无业务语义的 T2 Base UI**；Chat、Composer、Sidebar、Resource 等业务组件仍属于 `web/src/widgets`，不得为了“统一”搬进 UI 包。 |
| Storybook | 不引入 Storybook 依赖；沿用手写的 Solid + Vite UI Catalog，作为 Storybook-equivalent。 |
| Demo 站 | `ui-sandbox` 只保存 catalog 壳、demo、T3 Blocks 与 T4 Layers；T2 demo 必须消费 `@peri/ui`，不得复制实现。 |
| 默认端口 | **5273**。历史原文中的 8888 已过时；`dev-sandbox.sh` 可用 `PERI_UI_SANDBOX_PORT` 覆盖。 |
| Tailwind | `@peri/ui` 是唯一 Tailwind Preflight/utility 生成入口；package 样式显式 `@source` T2 源码，consumer build 负责验证 Web/Sandbox class 均未被裁掉。 |
| 公共入口 | TS/TSX 只允许 `import { … } from '@peri/ui'`；禁止组件 deep import。CSS 只从声明的 export 导入。 |
| 迁移方式 | 已在一个迁移变更中一步到位；不保留 `@/shared/ui` re-export shim。 |
| 审阅门 | 用户已接受本文并授权实现收口。 |

---

## 2. 实施前恢复出的仓库事实（2026-09-11）

以下表格记录本次迁移开始前的**半迁移态**，用于解释为何必须原子收口，不代表当前目录：

| 项目 | 状态 | 证据 / 缺口 |
|------|------|-------------|
| 根 workspace | 已落地 | 根 `package.json` 已包含 `packages/*`、`web`、`ui-sandbox`、`scripts`。 |
| `@peri/ui` 包骨架 | 已落地 | 已有 package、barrel、T1 样式、T2 组件与测试。 |
| Web TS/TSX 消费 | 大部分已落地 | widgets 已改用 `@peri/ui`；仍需门禁证明旧 import 永久为零。 |
| Web CSS 消费 | 部分落地 | `web/src/styles.css` 已导入 `@peri/ui/styles.css`；旧 `tokens.css` / `theme.css` 等副本仍在。 |
| Web 旧 T2 | 未清理 | `web/src/shared/ui` 仍完整存在。 |
| Sandbox 消费 | 未落地 | `ui-sandbox` 未声明 `@peri/ui`，demo 仍从 `@/components/ui` 取本地实现。 |
| Sandbox 旧 T2 | 未清理 | `ui-sandbox/src/components/ui` 仍完整存在。 |
| CSS 包边界 | 不合格 | `packages/ui/src/styles/extra.css` 混入 Markdown、Rewind、Sidebar、MCP、Composer、Message、Topology 等应用选择器；`primitives.css` 仍含 `.message-list-scroll`。 |
| 测试所有权 | 不合格 | `packages/ui/tests/components.test.tsx` 与 `packages/ui/src/components/components.test.tsx` 完全重复；Web `css-contracts` 仍直接读取 `shared/ui`。 |
| 锁文件 | 未收口 | 目前只有 `web/bun.lock` 与 `ui-sandbox/bun.lock`；workspace 尚未形成单一根锁文件。 |
| 文档 | 不一致 | 旧文档仍把 `shared/ui` 和 sandbox 镜像流程写成现行规范。 |

**结论（历史）**：半迁移代码只作为恢复进度的证据；目标边界由本文定义，不能反向用当时的复制结果定义架构。

---

## 3. 目标与非目标

### 3.1 目标

1. T2 Base UI 在仓库内只有一个实现：`packages/ui/src/components`。
2. T1 视觉 token 与 Tailwind utility 映射只有一个事实源：`packages/ui/src/styles`。
3. `web` 与 `ui-sandbox` 都通过 workspace 依赖消费 `@peri/ui`。
4. `ui-sandbox` 提供可浏览的 Tokens / Components / Blocks / Layers catalog，用于人工视觉审阅和组件状态矩阵。
5. 包、Web、Sandbox 各自拥有独立且可执行的测试边界。
6. 删除重复实现后仍可整 PR revert；不通过长期 shim 换取表面兼容。

### 3.2 非目标

- 不引入 `storybook`、Chromatic 或新的路由框架。
- 不发布 `@peri/ui` 到 npm registry；如未来需要外部发布，应另写 package-build / semver / release 设计。
- 不把 `widgets`、features、Yjs、protocol、server 契约或 store 搬进 `@peri/ui`。
- 不借迁移改变业务流程、协议语义或视觉设计。
- 不在本任务中整理当前工作区里无关的 server 投递改动。
- Agent 不启动、停止或重启 `dev.sh` / `dev-sandbox.sh`。

---

## 4. 目标目录与依赖方向

```text
package.json                      # Bun workspace 根
bun.lock                         # workspace 唯一锁文件

packages/ui/                     # npm package: @peri/ui
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                     # 唯一 TS/TSX barrel
    components/                  # T2 Base UI
    lib/                         # cn、纯 UI 工具、Terminal 无传输层适配
    styles/
      index.css                  # styles.css export
      tokens.css                # T1 唯一数值源
      theme.css                 # Tailwind v4 utility 映射
      primitives.css            # T2 自有原子 class
      extra.css                 # T2/第三方注入 DOM 的最小例外
  tests/
    components.test.tsx
    css-contracts.test.mjs

ui-sandbox/                     # 手写 Storybook-equivalent
  src/
    pages/                       # Home 封面 + Tokens / Components / Blocks / Layers demos
    components/blocks/          # T3 demo blocks，可用 mock
    layers/                     # T4 demo compositions，可用 mock
    shell/                      # catalog 导航壳
    styles/                     # 仅 catalog / T3 / T4 样式
  # 不再存在 src/components/ui

web/src/
  shared/                       # lib / protocol / yjs；不再存在 ui
  widgets/                      # 业务 UI
  styles/
    base.css                    # Web reset
    primitives.css             # Web / widget 原子与布局
    extra.css                  # Web 语义选择器例外
    project-sidebar.css        # Web 业务样式
  styles.css                   # 导入 reset、@peri/ui、Web 样式
```

依赖方向：

```text
@peri/ui  ←  web
@peri/ui  ←  ui-sandbox

@peri/ui  ↛  web / ui-sandbox / store / protocol / Yjs / server
web       ↛  ui-sandbox
ui-sandbox ↛ web
```

---

## 5. `@peri/ui` 包契约

### 5.1 允许进入包的内容

- `Button`、`IconButton`、`Dialog`、`DropdownMenu`、`Tooltip`、`Popover`、`Tabs`。
- `TextField`、`Textarea`、`Select`、`Checkbox`、`RadioGroup`。
- `Badge`、`Status`、`InlineNotice`、`Toast`、`EmptyState`、`LoadingState`、`Spinner`、`Skeleton`。
- `cn`、纯 UI variant / class 工具。
- Peri Studio 的 T1 视觉 token。`@peri/ui` 是**产品私有设计系统**，因此允许 `composer`、`sidebar`、`git-graph` 等产品视觉语义 token；这项许可只覆盖数值/语义变量，**绝不推导出同名业务选择器或 widget 可以进入 package**。
- `Terminal` 作为基础设施型 T2 例外：只暴露 viewport/callback 契约，不认识 project、session、WebSocket 或 server command。其 xterm engine 与注入 DOM 样式属于 package；停放、dock、workbench 布局属于 Web。V1 保持主 barrel 导出，待出现非 Terminal consumer 或独立加载需求时再另案拆 subpath。

### 5.2 禁止进入包的内容

- Chat / Composer / Sidebar / Resource / Rewind / MCP / Message / Topology 等 widget JSX。
- store、feature、entity、Yjs、protocol、server frame、认证和持久化语义。
- 只为某个 Web 组合结构服务的选择器。
- 对 `web/**` 或 `ui-sandbox/**` 的 import。
- 未声明的组件 deep-import 公共 API。

### 5.3 公共 API

V1 exports 固定为：

```json
{
  ".": "./src/index.ts",
  "./styles.css": "./src/styles/index.css",
  "./tokens.css": "./src/styles/tokens.css"
}
```

- 组件与 `cn` 只从 `@peri/ui` barrel 导出。
- 消费方显式导入 `@peri/ui/styles.css`；组件文件不隐式注入全局 CSS。
- V1 直接导出 TS/CSS 源码，由 Vite/Bun consumer 编译；不生成 `dist`，也不承诺 Node CJS 兼容。
- `solid-js` 为 peer dependency；组件运行时依赖放在 package dependencies。

### 5.4 Sandbox 独有组件处理

以生产 T2 契约为基线：

- sandbox 的 `Input` demo 改用包内 `TextField`；若 API 无法表达现有 demo，先在 `@peri/ui` 增加有测试的通用能力，而不是保留 sandbox 私有 T2。
- sandbox 的 `IconButton`、`DropdownMenu` 等统一使用 package barrel 名称和行为。
- 只有含业务语义的演示块可继续留在 `components/blocks` / `layers`。

### 5.5 Tailwind v4 与 buildless 消费契约

`@peri/ui` 直接导出 TSX 源码，因此不能假设 Tailwind 会自动扫描 workspace symlink。`packages/ui/src/styles/theme.css` 必须显式登记 package T2 源码：

```css
@import 'tailwindcss';
@source '../components';
@source '../lib';
```

约束：

- `@peri/ui` 的 `theme.css` 是 Tailwind utility 与 Preflight 的**唯一生成入口**；Web 与 Sandbox 不再各自保留第二份 `@import 'tailwindcss'`。
- `@source` 路径相对 `theme.css`，必须指向 package 自身源码，禁止依赖某个 consumer 的目录层级。
- Web 与 Sandbox 的 production build 都是必跑门禁，用于发现 buildless package 的 module resolution 或 class 裁剪问题。
- consumer 自有 TSX 中使用的动态 class 必须能由 Tailwind 静态发现；不得用字符串拼接绕过扫描。

---

## 6. CSS 所有权与级联

### 6.1 单源不是“所有 CSS 都进包”

**数值单源**与**选择器所有权**必须同时成立：

| 内容 | 所有者 |
|------|--------|
| Palette、spacing、type、radius、shadow、breakpoint、Peri 产品视觉 token | `packages/ui/src/styles/tokens.css` |
| Tailwind v4 token → utility 映射 | `packages/ui/src/styles/theme.css` |
| `.ui-*`、T2 组件自有状态、T2 第三方注入 DOM（如 xterm 内部 DOM） | `packages/ui/src/styles/{primitives,extra}.css` |
| `.markdown-body`、`.rewind-*`、`.composer-*`、`.sidebar-*`、`.mcp-*`、`.message-*`、`.topology-*`、workbench 布局 | `web/src/styles/{primitives,extra,project-sidebar}.css` |
| Catalog 导航、demo 容器、T3/T4 mock 布局 | `ui-sandbox/src/styles/*` |

因此，当前 `packages/ui/src/styles/extra.css` 与 `primitives.css` 的应用选择器必须迁回 Web；不能因为 `web/src/styles.css` 已导入 package stylesheet 就把 Web CSS 整体复制进 package。

### 6.2 最终级联

Web：

```css
@import './styles/base.css';
@import '@peri/ui/styles.css';
@import './styles/primitives.css';
@import './styles/extra.css';
```

Sandbox：

```css
@import './styles/base.css';
@import '@peri/ui/styles.css';
@import './styles/extra.css';
@import './styles/sandbox-shell.css';
/* 其余 T3/T4 demo 样式 */
```

收口后删除 Web 与 Sandbox 内重复的 T1 `tokens.css` / `theme.css`；保留各消费方自有的 reset 与业务/catalog CSS。

`@peri/ui/styles.css` 是面向 Peri Studio Web 与 Catalog 的全局设计系统入口，会产生两类经审阅的全局副作用：Tailwind Preflight，以及统一 scrollbar / border-style 基线。二者只允许在 package 定义一次；若未来 UI 包需要被第三方应用消费，必须另案拆出 scoped/minimal stylesheet，不能把 V1 的全局入口误称为通用无副作用 CSS。

### 6.3 CSS 门禁

`packages/ui/tests/css-contracts.test.mjs` 是删除旧 T2 目录前的**阻塞交付物**，至少验证：

1. package CSS 不出现应用域选择器。初始 denylist 至少覆盖：`markdown-body`、`rewind-`、`composer-`、`sidebar-`、`mcp-`、`message-`、`topology-`、`workbench-`、`resource-`、`git-graph-`；Terminal 仅允许 package 明确登记的 host/xterm 选择器。
2. package CSS 不使用未声明 token。
3. package T2 TSX 不使用任意 Tailwind bracket utility。
4. `styles.css` 的导入顺序固定，`theme.css` 只有一个 Tailwind import 且含 package 自身的 `@source`。
5. package 源码不 import `web`、sandbox、store、protocol、Yjs 或 server 模块。
6. V1 经审阅的全局通配符规则只能出现在固定文件/allowlist，避免继续扩大全局副作用。

---

## 7. UI Catalog（手写 Storybook-equivalent）

### 7.1 角色

`ui-sandbox` 是独立 Vite 应用，不是产品运行时的一部分。保留现有四层导航：

- `#/tokens`：T1 token 展示。
- `#/components`：T2 组件状态矩阵，全部从 `@peri/ui` 导入。
- `#/blocks`：T3 业务无后端 demo，可组合 `@peri/ui` 与 mock。
- `#/layers`：T4 页面组合 demo，可使用静态 fixture。

每个 T2 demo 应覆盖适用的 default、hover/focus 说明、disabled、loading、error、尺寸、键盘与窄屏状态；交互必须使用真实 package 组件，不得复制 JSX 假装相同。

### 7.2 启动契约

- 默认地址：`http://127.0.0.1:5273/`。
- `ui-sandbox/package.json` 与 `vite.config.ts` 都固定默认端口 5273。
- `dev-sandbox.sh` 通过 `PERI_UI_SANDBOX_HOST` / `PERI_UI_SANDBOX_PORT` 允许人工覆盖；这些环境变量只约束该脚本，直接运行 `bun run dev` 时应使用 Vite 默认 5273 或显式 CLI 参数。
- 脚本必须从 workspace 根判断依赖是否安装；缺依赖时在根执行 `bun install`，不得继续以 `(cd ui-sandbox && bun install)` 生成 leaf lockfile。
- Agent 只运行 `typecheck` / `build`，不得代用户启动 `dev-sandbox.sh`。
- 视觉审阅由用户本地手动启动后完成。

---

## 8. Workspace 与依赖管理

- 根 `package.json` 是唯一 workspace 根；安装解析覆盖 `packages/*`、`web`、`ui-sandbox`、`scripts` 等所有 workspace 成员。
- `web` 与 `ui-sandbox` 均声明 `"@peri/ui": "workspace:*"`。
- 第一次收口时在仓库根执行非 frozen 的 `bun install`，生成并提交根 `bun.lock`；随后删除 leaf `web/bun.lock`、`ui-sandbox/bun.lock`，CI 与日常验证才改用 `bun install --frozen-lockfile`。
- 回滚整个迁移时必须同时移除根 `bun.lock` 并恢复两个 leaf lockfile，避免依赖解析行为停留在半回滚状态。
- 不把 consumer 自己使用的依赖机械搬进 `@peri/ui`。例如 Web/Sandbox 自己渲染 `lucide-solid` 图标时仍可直接依赖它；consumer 与 package 合法重复的版本必须保持兼容，由根 lockfile 收敛实际解析版本。
- package version 与产品 version 的联动另由发布流程管理；V1 的 `private: true` 不代表可外部发布。

---

## 9. 测试所有权

| 范围 | 位置 | 职责 |
|------|------|------|
| T2 DOM / a11y / props | `packages/ui/tests/components.test.tsx` | 测真实 Solid DOM、默认 button type、Kobalte 行为、Terminal façade。 |
| T1/T2 CSS 边界 | `packages/ui/tests/css-contracts.test.mjs` | token、utility、选择器所有权和样式入口。 |
| Web 业务 UI | `web/src/widgets/**/*.test.tsx` | 只测业务组合，不读取 package 私有实现。 |
| Web 架构/CSS | `web/tests/css-contracts.test.mjs` | 禁止旧路径/deep import；只检查 Web 自有 CSS 与 widget。 |
| Catalog 编译 | `ui-sandbox` typecheck + build | 证明全部 demo 可从公开 package API 编译。 |

清理要求：

- 删除重复的 `packages/ui/src/components/components.test.tsx`，只保留 `packages/ui/tests/components.test.tsx`。
- 把 Web 契约中直接读取 `shared/ui/Button.tsx`、`shared/ui/InlineNotice.tsx` 的断言迁入 package 测试。
- Web 的跨层门禁必须断言 `web/src/shared/ui` 不存在，且源码无 `@/shared/ui`。`.ts` / `.tsx` 中禁止任何 `@peri/ui/*` 子路径；`.css` 中只允许 package exports 声明的 `@peri/ui/styles.css` 与 `@peri/ui/tokens.css`。
- Sandbox 门禁必须断言 `ui-sandbox/src/components/ui` 不存在，且 `ui-sandbox/src` 无 `@/components/ui` import。
- `web/tests/css-contracts.test.mjs` 当前会过滤 npm `@import`，因此 package CSS 正确性只由 package contracts 负责；Web contracts 负责证明 Web 自有 CSS 无重复 T1/T2 源，并验证最终级联入口。

---

## 10. 用户接受后的执行顺序（单个迁移变更）

1. **Workspace 收口**
   - 第一次从仓库根运行 `bun install`，生成根 lockfile；删除 leaf lockfile 后，后续验证使用 frozen install。
   - 让所有 workspace 成员进入统一依赖图，并核对 `@peri/ui` runtime / peer / dev dependencies。
   - 同步 `dev-sandbox.sh`，确保缺依赖时从根安装。

2. **先建立 package 门禁**
   - 以 Web 生产 T2 为基线补齐 barrel 与 DOM 测试。
   - 新增并跑通 `packages/ui/tests/css-contracts.test.mjs`；在它存在前禁止删除任何旧 T2 目录。
   - 删除重复的 package 测试副本。

3. **原子迁移 CSS 所有权**
   - 先把当前误入 package 的应用选择器按所有权回填到 `web/src/styles/{primitives,extra,project-sidebar}.css`，验证选择器集合与级联无丢失。
   - 再从 package CSS 删除这些应用选择器，只保留 T1/T2，并加入 `@source` / 单一 Preflight 契约。
   - 调整 Web 与 Sandbox 最终级联；最后删除消费方重复的 T1 `tokens.css` / `theme.css`。
   - 同一步骤内跑 package 与 Web CSS contracts，禁止提交级联空洞或双源中间态。

4. **先迁测试，再删除旧目录**
   - 把 Web 契约中读取 `shared/ui/Button.tsx`、`shared/ui/InlineNotice.tsx` 的断言迁入 package 测试。
   - 更新 `web/tests/css-contracts.test.mjs`：不再读取旧路径，改为断言目录不存在、旧 import 为零、Web 自有 CSS 边界成立。
   - 只有 package/Web 新门禁均可运行后，才删除 `web/src/shared/ui`。

5. **Sandbox 改造**
   - 声明 `@peri/ui: workspace:*`。
   - T2 demo、catalog shell 的基础组件与 `cn` 改从 package barrel 导入；`Input` demo 按 §5.4 改用公开 API。
   - 添加 `ui-sandbox/src` 无 `@/components/ui` 的静态门禁，再删除 `ui-sandbox/src/components/ui`、重复 token/theme 和无引用本地 `cn`。
   - 保留 5273 端口和手写 catalog 路由。

6. **Web import / 依赖收口**
   - 保证所有 T2 import 都来自 `@peri/ui`，且没有 TS/TSX deep import。
   - `web/src/shared/lib/cn.ts` 仅在零引用后删除。
   - 复核 Web 直接依赖：只移除已无直接 import 的重复 runtime，不为追求 package.json 表面简洁误删 Web 自用依赖。

7. **文档同步**
   - 阻塞 DoD：更新 `AGENTS.md`、`CLAUDE.md`、`frontend-architecture.md`、`ui-specification.md` 与 `architecture.md` 中仍指导新代码走 `shared/ui` 的陈述。
   - 历史计划 `ui-implementation-plan.md` 可保留原阶段证据，但必须标注 superseded，并把新工作流指向本文。

8. **验证与人工审阅**
   - 完成下列自动验收；`web` 的 `bun run test` 已包含 `verify-production-boundary`，若该脚本依赖旧路径须同步修改。
   - 用户手动启动 `./dev-sandbox.sh`，审阅 Components / Blocks / Layers。

迁移步骤 2–6 必须在同一变更中完成：不允许合入“新包 + 旧实现长期并存”的中间态。实施时可分 commit，但每个 commit 必须可被后续 commit 在同一 PR 内验证，最终 PR 才是可合入单元。

---

## 11. 自动验收

首次 workspace 收口：

```bash
# 仅首次生成根 bun.lock；完成后提交根 lock 并删除 leaf locks
bun install
```

最终/CI 验收：

```bash
bun install --frozen-lockfile

cd packages/ui && bun run test
cd ../../ui-sandbox && bun run typecheck && bun run build
cd ../web && bun run test && bun run build
```

`typecheck` / `build` / `test` 都必须在根 install 之后执行，证明 buildless package 可由两个 consumer 解析。

静态门禁：

```text
必须不存在：
  web/src/shared/ui
  ui-sandbox/src/components/ui
  packages/ui/src/components/components.test.tsx
  web/src/styles/tokens.css
  web/src/styles/theme.css
  ui-sandbox/src/styles/tokens.css
  ui-sandbox/src/styles/theme.css

TS / TSX 禁止：
  @/shared/ui
  @/shared/lib/cn
  @/components/ui
  @peri/ui/                 # TS deep import 全禁

CSS 允许：
  @peri/ui/styles.css
  @peri/ui/tokens.css       # 仅确有独立 token 消费时

CSS 禁止：
  除以上 exports 外的任何 @peri/ui/* 子路径
```

这些规则必须落成测试或验证脚本，不以人工 `grep` 的退出码作为唯一证据。

另外确认：

- `@peri/ui` 不 import `web`、sandbox、store、protocol、Yjs 或 server 语义。
- package CSS 无 Web 应用选择器。
- T2 组件与 T1 token 各只有一份实现。
- `ui-sandbox` 构建不依赖 `web/src`。
- 不启动 server / instance 即可完成全部静态与单元验证。

---

## 12. Definition of Done

- [x] 用户接受本文并授权进入实现；这只代表设计门通过，不等于视觉验收已通过。
- [x] 根 workspace + 单一 `bun.lock` 生效；`dev-sandbox.sh` 从根依赖图启动。
- [x] `packages/ui/tests/css-contracts.test.mjs` 存在并阻止应用选择器、未声明 token、缺失 `@source` 与跨边界 import。
- [x] `@peri/ui` 是 T1/T2 唯一事实源，且 package CSS 无应用选择器。
- [x] `web/src/shared/ui` 与 `ui-sandbox/src/components/ui` 不存在，重复 package 测试文件已删除。
- [x] Web / Sandbox 只从 `@peri/ui` barrel 消费 T2；CSS 只使用声明的 exports。
- [x] `ui-sandbox` 的 Tokens / Components / Blocks / Layers 可 typecheck + build，默认端口为 5273。
- [x] package / Web / Sandbox 自动验收全绿；这是可合入的技术门槛。
- [x] 所有关联权威文档已同步；`shared/ui` 仅可出现在明确标记为 superseded 的历史说明，或“已删除/禁止恢复”的负向契约中。
- [ ] 用户本地运行 `./dev-sandbox.sh` 完成人工视觉审阅；这是产品验收门槛。

---

## 13. 已确认的审阅决策

以下四项已由用户接受并据此完成技术收口；人工视觉审阅仍按 §12 单独验收：

1. `@peri/ui` V1 是 **private、buildless workspace package**，不是 registry 发布包。
2. “分离所有 component”仅覆盖 **T2 Base UI**，业务 widgets 不进包。
3. `ui-sandbox` 是手写 Vite Storybook-equivalent，默认端口沿用 **5273**，不是历史 8888。
4. T1 token 可包含 Peri 产品视觉语义，但 Composer/Sidebar/Markdown 等**应用选择器不进入 package**。

---
status: accepted
date: 2026-09-05
---

# Peri Studio Web UI 规范（权威版）

> **本文是产品视觉与交互组件的单一事实源。** T1/T2 实现以 `packages/ui/src/styles/`、`packages/ui/src/components/` 与 package 测试为准；Web 应用例外由 `web/src/styles/` 和 `web/tests/css-contracts.test.mjs` 约束。
>
> 关联：[frontend-architecture.md](frontend-architecture.md)（目录分层）、[frontend-rewrite-program.md](frontend-rewrite-program.md)（Phase 6+：只 Tailwind、禁任意值、社区无头、业务等价）、[pwa.md](pwa.md)（可安装 PWA）、[audit-chat-uiux-2026-08.md](../audit-chat-uiux-2026-08.md)（UX 审计与修复记录）、ADR [0004](../adr/0004-web-frontend-layered-architecture.md)。

---

## 1. 过时材料（勿再对齐）

| 文件 | 状态 | 说明 |
|------|------|------|
| [`../arch/workspace-ui-concept.html`](../arch/workspace-ui-concept.html) | **概念稿** | Workspace/Project/Session 信息架构讨论用；颜色与组件均非生产规范 |
| 全局 App 顶栏填满品牌名、Session 切换迁出 `ProjectSidebar` | **已否决** | 侧栏 instance 行 + `SidebarNavBar` 为定稿；见 §10.1 |
| 任意截图 / Figma 未回写 token | **无效** | 必须以 `packages/ui/src/styles/tokens.css` 与 `@peri/ui` 为准 |

**现行视觉身份**：白底画布 + AntD 冷灰发丝线 + **湛蓝 accent**（`#2563eb`，`--palette-accent-600`），层次靠间距与边框而非大面积灰底块。权威 token 与 `ui-sandbox` Layers 对齐。深色主题尚未在产品中启用。

---

## 2. 设计原则

1. **Calm & dense**：开发者工具密度；默认安静，活动态（streaming、权限、错误）才提高对比。
2. **Server 事实优先**：UI 只渲染投影；不伪造历史、不从标题猜类型、未知协议值 fail closed（见 `architecture.md` §3.0）。
3. **白画布 + 壳层灰**：聊天画布 `--app-bg` / `--surface-canvas` 为白（`neutral-0`）；侧栏与 Workbench 壳层用 **Neutral 25**（`--palette-neutral-25` / `bg-neutral-25`，`#fafafa`）。`--surface-overlay` 保持白，避免气泡、按钮、菜单被连带改灰。次级凹槽 `--surface-sunken` 同源 Neutral 25。
4. **语义色克制**：accent 仅用于主操作与正向强调；`success` / `warning` / `danger` 仅用于状态与告警，不装饰化。
5. **英文 UI 文案**：按钮、标签、toast、空状态、错误信息一律英文；文档与代码注释用中文。
6. **可访问性默认**：焦点环可见、触控目标 ≥ 44px（`pointer-coarse`）、`forced-colors` 安全边界、模态焦点陷阱由 Kobalte 基元保证。
7. **组件自给自足**：基础组件在 `@peri/ui` 内具备 default / hover / disabled / focus / error 全套状态，**不得**依赖页面偶然样式才能用。

### 2.1 Explorer structural mutation

Explorer Files 区头固定提供 `New File`、`New Folder`、`Refresh Explorer`。文件/目录行与根空白均提供 context menu；mutation 不可用时入口保留并显示英文原因，`Copy Path` 始终可用。New/Rename 使用 inline input（Enter 提交、Escape 取消），Move 使用 `Move to…` Dialog，Delete 始终经过 `Delete permanently?` danger Dialog；F2 与 Delete/Backspace 只在 treeitem 焦点上生效，inline input 阻断 tree shortcuts。`DeliveryUnknown` 显示 Reconcile 并复用原 `commandId`，revision conflict 仅提供手动 Refresh，不伪造成功。

---

## 3. 事实源栈（实现顺序）

```
packages/ui/src/styles/tokens.css      ← 颜色、间距、半径、字阶、阴影、布局容器的唯一数值源
    ↓
packages/ui/src/styles/theme.css       ← Tailwind v4 @theme inline 与 package @source
    ↓
packages/ui/src/styles/{primitives,extra}.css
                                      ← T2 原子与第三方注入 DOM 例外
    ↓
packages/ui/src/components/*.tsx       ← Kobalte 封装；公共入口 @peri/ui
    ↓
web/src/styles/{base,primitives,extra}.css
                                      ← 浏览器 reset 与应用/widget 所有样式
    ↓
widgets/*                              ← 业务组合；禁止 @peri/ui deep import
```

**契约测试**：`packages/ui/tests/css-contracts.test.mjs` 约束 T1/T2 所有权；`web/tests/css-contracts.test.mjs` 约束应用样式、spacing token 与 package barrel 消费边界。

---

## 4. 色彩系统

### 4.1 语义 token（`:root`，见 `tokens.css`）

| 语义 | CSS 变量 | 典型 utility | 用途 |
|------|-----------|--------------|------|
| 画布 | `--app-bg` | `bg-app-bg` | 主内容区 / 聊天背景（`neutral-0` `#ffffff`） |
| 壳层灰 | `--palette-neutral-25` | `bg-neutral-25` | 侧栏与 Workbench 轨/面板（`#fafafa`） |
| 侧栏 | `--sidebar-bg` | `bg-sidebar-bg` | 别名 Neutral 25 |
| 表面 | `--surface` / `--surface-overlay` | `bg-surface` / `bg-surface-overlay` | 卡片、输入框、弹层、气泡（白） |
| 次级表面 | `--surface-sunken` / `--surface-muted` | `bg-surface-sunken` | 同源 Neutral 25 的凹槽 |
| 主文字 | `--text-primary` | `text-text-primary` | 标题、正文 |
| 次文字 | `--text-secondary` | `text-text-secondary` | 说明、元数据 |
| 弱文字 | `--text-muted` | `text-text-muted` | 标签、时间戳 |
| 装饰 | `--text-faint` | `text-text-faint` | **仅**禁用/纯装饰；真实内容不得用 faint |
| 链接 | `--link` | `text-link` | 可点击内联链接 |
| 强调 | `--accent` | `bg-accent` / `text-accent` | 品牌色、选中底、活动指示 |
| 悬停 | `--hover` | `bg-hover` | 行 hover、ghost 按钮 |
| 选中 | `--selected` | `bg-selected` | 列表当前项、slash 菜单高亮 |
| 焦点 | `--focus-ring` | `outline-*` / ring | 键盘焦点 |
| 成功 | `--success` / `--success-soft` | `text-success` / `bg-success-soft` | Badge、Status ok |
| 警告 | `--warning` / `--warning-soft` | 同上 | 倒计时、软告警 |
| 危险 | `--danger` / `--danger-soft` | 同上 | 错误、破坏性操作 |
| 边框 | `--border-subtle` / `--border-strong` | `border-border-subtle` | 分割与输入框 |
| 遮罩 | `--scrim` | `bg-scrim` | Dialog overlay |

主按钮：`--btn-primary` → `bg-btn-primary`，前景 **必须**为 `--surface` 白字（见 `Button` `primary` variant）。

---

## 5. 字阶与排版

- **Sans**：`--font-sans`（系统栈，含 PingFang / 微软雅黑）
- **Mono**：`--font-mono`（代码块、路径、ID）

常用字号（`--text-*` → `text-12` 等 utility）。档位名保持历史 class，现行渲染比后缀大 1px，使正文 `text-13` / `--text-body` 为 14px。

| Token | 用途 |
|-------|------|
| `9`–`11` | 状态点旁标签、Badge、紧凑元数据 |
| `12`–`13` | 默认 UI 正文、列表行、表单（`text-13` 渲染 14px） |
| `14`–`15` | 小节标题、强调正文；聊天 Markdown 正文 `text-14`（15px） |
| `16`+ | 页面级标题（少用） |
| `36` / `48` | Catalog 封面 / 编辑风 display（sandbox 主页） |

字重：`font-500` 默认按钮；`font-semibold` 小节标题；避免 700+ 粗体墙。

行高：正文 `leading-145` / `leading-15`；紧凑列表 `leading-compact`。

---

## 6. 间距、圆角与布局

- **间距**：仅使用 `--space-*` 映射的 Tailwind 数字 utility（`p-12`、`gap-8`…）；`css-contracts` 禁止未声明数字。
- **控件高度**：`--control-height-default`（38px）、`compact`（32px）；T2 默认按钮 36px；触控加粗 `pointer-coarse:min-h-44`。
- **圆角**：交互控件 `rounded-8`；Composer `rounded-(--composer-radius)`（18px）；Pill `rounded-full`。
- **内容宽度**：聊天 `--container-chat-content` / `--chat-content-max`（752px）；Composer `--container-composer-launch` / `--composer-launch-max`（736px）；弹窗见 `--container-*` 系列。
- **壳层网格**：`--grid-cols-shell`（280px 侧栏 + 1fr）；桌面收窄 `240px`。

---

## 7. 阴影与层级

原则：**能不用阴影就不用**；白底产品靠边框分层。阴影从轻到重分五档 canonical tier，语义别名指向对应档位。

| Tier | Token | 用途 |
|------|-------|------|
| sm | `--shadow-sm` | 微抬升（Composer 壳、表格浮动按钮） |
| md | `--shadow-md` | 卡片、Workbench 侧栏 |
| lg | `--shadow-lg` | Dropdown、Popover、Toast |
| overlay | `--shadow-overlay` | Tooltip、FAB、Workbench 浮层 |
| dialog | `--shadow-dialog` | Dialog、AlertDialog |
| — | `--shadow-focus-ring` | 焦点环、运行中 activity 光晕 |

语义别名：`--shadow-subtle` / `--shadow-composer-overlay` → sm；`--shadow-raised` → md；`--shadow-popover` → lg；`--shadow-accent-ring` → focus-ring。

`z-index`：模态与 toast 由 Kobalte / 门户管理；业务勿随意叠 `z-50`。

---

## 8. 动效

- 默认过渡：`120ms ease`（按钮、边框、背景），见 `Button` base classes。
- **Spinner**：`.ui-spinner`（`primitives.css`），按钮 `busy` 时展示并 `aria-busy`。
- **Skeleton**：`.ui-skeleton`（`primitives.css`）shadcn 式扫光占位；对话 thinking gap 用 Skeleton 条，不用 spinner 文案行。`prefers-reduced-motion` 下停扫光。
- **Reduced motion**：streaming / ping 动画须尊重 `prefers-reduced-motion`（见 chat 工作状态行实现）。
- 禁止无意义入场动画；`fade-in` 仅用于轻量出现（popover）。

---

## 9. 组件目录（`packages/ui/src/components`，公共入口 `@peri/ui`）

| 组件 | 用途 | 关键 variant / 约定 |
|------|------|---------------------|
| `Button` / `IconButton` | 一切可点击主操作 | `primary` / `secondary` / `ghost` / `danger`；`busy` + spinner |
| `TextField` / `Textarea` / `SelectField` | 表单输入 | 错误态由 Field 包裹；label 关联 |
| `Checkbox` / `RadioGroup` | 设置、elicitation | Kobalte 原生 a11y |
| `Dialog` | 模态确认、设置、导入 | `DialogFooter` 右对齐主/次按钮 |
| `Popover` / `DropdownMenu` / `Listbox` | 菜单、slash 补全 | Listbox 键盘导航；slash 高亮 `bg-selected` |
| `Tabs` | 设置/面板分区 | 指示器用 accent |
| `Tooltip` | Icon-only 说明 | `IconButton` 默认内置；侧栏已有可见语义的动作使用 `showTooltip={false}` |
| `Toast` | 全局短暂反馈 | `showToast` / `dismissToast` |
| `Badge` | 紧凑标签 | `neutral` / `ok` / `warn` / `err` |
| `Status` | 连接/运行点 + 文案 | `live` → `aria-live` |
| `InlineNotice` | 流内告警条 | `info` / `success` / `warning` / `danger` |
| `EmptyState` / `LoadingState` | 空与加载 | 必须覆盖错误/重试路径 |
| `Spinner` | 内联等待 | 非按钮场景 |
| `Skeleton` | 扫光占位 | 对话 thinking gap、列表预载；须另有 live region |
| `CopyButton` | 复制代码/ID | 成功反馈 toast |
| `Collapsible` | 可折叠区块 | 侧栏归档区等 |

**图标**：统一 `Icon` 组件 + lucide 路径；**禁止**在 widget 内联 `<svg>` 画布（css-contracts 约束）。

**业务 Badge**：运行时/连接态等领域映射在 `features/shell/runtime-status-badge.ts`；视觉须委托 `@peri/ui` `Badge` 与 token，widget 内不得再维护独立 Badge 组件。

---

## 10. Widget 层模式

| 区域 | Widget 路径 | UI 要点 |
|------|-------------|---------|
| 壳层 | `widgets/shell` | AppShell 网格、`PwaRuntime`、ErrorCenter、ConnectionProblem、StatusArea、System About「This browser」 |
| 侧栏 | `widgets/sidebar` | 28px 行高、选中 `bg-selected`、`For` 稳定 key |
| 聊天 | `widgets/chat` | Transcript 窗口化、Permission/Elicitation 队列、Markdown、`ToolCallActivity`（`@peri/ui` `ToolActivityRow` + `features/chat/tool-call-activity.ts`） |
| 输入 | `widgets/composer` | `Composer.tsx` 内联 editor/toolbar；`@peri/ui` `SlashMenuListbox` + `features/composer/slash-menu-catalog.ts`；drop / Add attachment 共用上传队列，ready 后仅插入 `@relative/path` |
| 资源 | `widgets/resource` | 右/左 `ResourceFloatingPanel`（Explorer·SCM·Graph / 文件预览）；Explorer folder/root drop target 与批次状态；Git diff 占主区；44px 触控目标 |
| 认证 | `widgets/auth` | AuthGate 卡片 `--container-auth-card` |

Widget **可以**读 `store`；**不得**直发 WebSocket 帧。复杂逻辑下沉 `features/*`。

### 10.1 壳层信息架构（定稿）

- **侧栏为全局会话 chrome 的唯一位置**：`ProjectSidebar` 顶部保留 instance/品牌行与 `SidebarNavBar`（New session、Search、More）。**不**把这些动作迁入 AppShell 全局顶栏。
- **`ChatHeader`**（对话区内）：`ChatView` 内联 `@peri/ui` `ChatHeader`，标题由 `features/chat/chat-header-title.ts` 的 `resolveChatHeaderTitle` 解析；含 ACP session 切换与打开资源入口；不重复侧栏的全局新建/搜索。
- 调整导航密度时只改 `widgets/sidebar` / `sidebar-parts`，勿并行维护第二套顶栏会话 UI。

### 10.1.1 Standalone / 本机安装

- 已安装窗口使用 `display: standalone`。`theme-color` 与 manifest 画布均为 `#ffffff`（不是 accent）。
- 安装入口只在 System → About「This browser」（诊断弹窗的浏览器 chrome，不是用户偏好）：互斥展示 `Install`（Chrome / Edge `beforeinstallprompt`）、`Installed`（standalone，`role="status"`）、Safari `Open Share, then Add to Home Screen`（仅 `isIosLike && isSecureContext && isLoopbackHost`）、或 `Cannot install here`。
- 有安装动作时，文案使用**当前页** `location.origin`（由 widget 注入），并说明这是本机快捷方式：断开本机 server 后窗口不可用。规范 loopback 配方 `http://127.0.0.1:8456/` 只作文档默认入口，不得写成「这次安装」的 origin。iOS Home Screen 应用是独立存储，可能要再登录一次。LAN HTTP 不得提示 Add to Home Screen，也不得发明 127.0.0.1 快捷方式。无动作时隐藏安装说明段。
- **不**把 Install 放进侧栏 More、AuthGate 登录卡、`ConnectionProblem` 或 Toast。无 Service Worker，因此无 Reload-for-update。
- standalone 安全区用 T1 `pt-safe` / `pb-safe` / `p-safe`（AuthGate 登录页用 `p-safe-min-24`，AppShell / Toast 视口用 `p-safe`）。Composer 底部复用 `--composer-safe-bottom`。禁止 `pt-[env(...)]`。

### 10.2 资源工作台浮窗

| 视口 | 位置 | 内容 |
|------|------|------|
| 桌面 · 右 | `ResourceFloatingPanel`（`anchor=right`） | Explorer、Source Control、Git Graph；`widthProfile` 为 `workspace` 或 `graph` |
| 桌面 · 左 | `ResourceFloatingPanel`（`anchor=left`，`widthProfile=preview`） | 只读文件预览；可与右侧文件树同时显示 |
| 桌面 · 主区 | `conversation-pane` | 默认 `ChatView`；**Git diff** 预览占满主区并暂挂右侧资源 view |
| 移动 | Dialog + 左浮动预览 | 资源 drawer；文件预览与桌面一致为 `ResourceFloatingPanel`（`leftOffset` 仅边距） |

宽度默认值、sessionStorage 键与 `leftOffset`（侧栏宽 + 边距）见 `widgets/resource/resource-panel-layout.ts`。

---

## 11. 响应式与密度

断点策略（与审计一致）：

| 视口 | 行为要点 |
|------|----------|
| ≥ 1280 | 默认三栏壳层 |
| 1024 | 状态栏资源入口须可打开 Workbench |
| 768 | 抽屉化侧栏/资源；全场景无横向溢出 |
| ≤ 430 高度 | Launch 页流式滚动，composer 不与 prompt 重叠 |

触控：`pointer-coarse:` 前缀加高按钮与行高（最小 44px）。

高对比：`forced-colors` 下边框/文字仍须可辨（浏览器契约覆盖）。

---

## 12. 写作与微文案

- 按钮：**动词开头**（`Open`, `Retry`, `Allow once`, `Install`）；破坏性用 `danger` variant，文案明确（`Delete`, `Revoke`）。
- 本机安装：`Install` / `Installed` / `Open Share, then Add to Home Screen`；说明快捷方式仍依赖本机 server，iOS 可能要再登录。
- 错误：说明发生了什么 + 单一主恢复动作；`delivery_unknown` 保留证据 + acknowledge 路径。
- 空状态：一句说明 + 可选主 CTA；不用俏皮语气。
- 加载：`Loading…` / `Connecting…` / `Calibrating…` 区分语义；禁止无限 spinner 无文案。thinking gap 用 `Skeleton` 扫光，文案只进 live region。

---

## 13. 新增 UI 的检查清单

- [ ] 颜色/间距/半径仅来自 token utility，无魔法数 hex（除 token 文件自身）
- [ ] 交互状态完整：default、hover、focus-visible、disabled、error（如适用）
- [ ] 文案英文；日志英文
- [ ] 使用 `@peri/ui` barrel，不 deep import
- [ ] 单文件 &lt; 500 行；超复杂则拆 widget + feature
- [ ] `cd web && bun run test` 与相关浏览器契约通过
- [ ] 若引入新 token，先改 `packages/ui/src/styles/tokens.css` + `theme.css`，再写组件

---

## 14. 后续演进（非阻塞）

- [ ] 深色主题：需先在 `tokens.css` 定义 `.dark` 语义映射，再更新 `theme.css`
- [ ] Storybook / visual-fixture 与本文 token 表自动对账

---
status: accepted
date: 2026-08-30
---

# Peri Studio Web UI 规范（权威版）

> **本文是产品视觉与交互组件的单一事实源。** 实现以代码为准：`web/src/styles/tokens.css`、`web/src/shared/ui/`、`web/tests/css-contracts.test.mjs`。
>
> 关联：[frontend-architecture.md](frontend-architecture.md)（目录分层）、[audit-chat-uiux-2026-08.md](../audit-chat-uiux-2026-08.md)（UX 审计与修复记录）、ADR [0004](../adr/0004-web-frontend-layered-architecture.md)。

---

## 1. 过时材料（勿再对齐）

| 文件 | 状态 | 说明 |
|------|------|------|
| [`style-demo.html`](style-demo.html) | **已废止** | 暖橙 accent（`#c4571f`）、暖灰侧栏、含深色主题草稿；**与现行产品不一致** |
| [`../arch/workspace-ui-concept.html`](../arch/workspace-ui-concept.html) | **概念稿** | Workspace/Project/Session 信息架构讨论用；颜色与组件均非生产规范 |
| 任意截图 / Figma 未回写 token | **无效** | 必须以 `tokens.css` 与 `shared/ui` 为准 |

**现行视觉身份**：白底画布 + 发丝线分割 + **绿色 accent**（`#16865a`），层次靠间距与边框而非大面积灰底块。深色主题尚未在产品中启用（`style-demo` 中的 `.dark` 仅为历史探索）。

---

## 2. 设计原则

1. **Calm & dense**：开发者工具密度；默认安静，活动态（streaming、权限、错误）才提高对比。
2. **Server 事实优先**：UI 只渲染投影；不伪造历史、不从标题猜类型、未知协议值 fail closed（见 `architecture.md` §3.0）。
3. **白画布 + 线框层次**：`--app-bg` / `--sidebar-bg` / `--surface` 均为白或近白；次级面用 `--surface-muted`，禁止用大面积色块区分区域。
4. **语义色克制**：accent 仅用于主操作与正向强调；`success` / `warning` / `danger` 仅用于状态与告警，不装饰化。
5. **英文 UI 文案**：按钮、标签、toast、空状态、错误信息一律英文；文档与代码注释用中文。
6. **可访问性默认**：焦点环可见、触控目标 ≥ 44px（`pointer-coarse`）、`forced-colors` 安全边界、模态焦点陷阱由 Kobalte 基元保证。
7. **组件自给自足**：基础组件在 `shared/ui` 内具备 default / hover / disabled / focus / error 全套状态，**不得**依赖页面偶然样式才能用。

---

## 3. 事实源栈（实现顺序）

```
tokens.css          ← 颜色、间距、半径、字阶、阴影、布局容器的唯一数值源
    ↓
theme.css           ← Tailwind v4 @theme inline，把 token 映射为 bg-* / text-* / p-* 等 utility
    ↓
base.css            ← 浏览器 reset；不含产品色
primitives.css      ← .ui-spinner、滚动条、状态点等跨组件原子 class
    ↓
panel/styles/*.css  ← 功能域布局（chat、sidebar、composer…）；只消费 token utility
    ↓
shared/ui/*.tsx     ← Kobalte 封装；对外唯一入口 shared/ui/index.ts（@/shared/ui）
    ↓
widgets/*           ← 业务组合；禁止深层 import 单个 ui 文件，禁止裸 SVG 图标画布
```

**契约测试**：`web/tests/css-contracts.test.mjs` 强制执行 spacing token 完备性、样式只引用已声明 token、widget 对 ui barrel 的消费边界。

---

## 4. 色彩系统

### 4.1 语义 token（`:root`，见 `tokens.css`）

| 语义 | CSS 变量 | 典型 utility | 用途 |
|------|-----------|--------------|------|
| 画布 | `--app-bg` | `bg-app-bg` | 主内容区背景（`#ffffff`） |
| 侧栏 | `--sidebar-bg` | `bg-sidebar-bg` | 与画布同级白，靠分隔线区分 |
| 表面 | `--surface` | `bg-surface` | 卡片、输入框、弹层面 |
| 次级表面 | `--surface-muted` | `bg-surface-muted` | 空状态标记、弱强调底 |
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

### 4.2 与废止 `style-demo` 的差异

| 维度 | style-demo（废止） | 现行产品 |
|------|-------------------|----------|
| Accent | 暖橙 `#c4571f` | 绿 `#16865a` |
| 背景 | 暖灰 `#faf9f7` | 纯白 `#ffffff` |
| 侧栏 | 灰底 `#f3f2ee` | 白底 + 线框 |
| 深色主题 | 有 `.dark` 草稿 | **未启用** |

---

## 5. 字阶与排版

- **Sans**：`--font-sans`（系统栈，含 PingFang / 微软雅黑）
- **Mono**：`--font-mono`（代码块、路径、ID）

常用字号（`--text-*` → `text-12` 等 utility）：

| Token | 用途 |
|-------|------|
| `9`–`11` | 状态点旁标签、Badge、紧凑元数据 |
| `12`–`13` | 默认 UI 正文、列表行、表单 |
| `14`–`15` | 小节标题、强调正文 |
| `16`+ | 页面级标题（少用） |

字重：`font-500` 默认按钮；`font-semibold` 小节标题；避免 700+ 粗体墙。

行高：正文 `leading-145` / `leading-15`；紧凑列表 `leading-13`。

---

## 6. 间距、圆角与布局

- **间距**：仅使用 `--space-*` 映射的 Tailwind 数字 utility（`p-12`、`gap-8`…）；`css-contracts` 禁止未声明数字。
- **控件高度**：`--control-height-default`（34px）、`compact`（28px）；触控加粗 `pointer-coarse:min-h-44`。
- **圆角**：交互控件 `rounded-8`；Composer `rounded-[var(--composer-radius)]`（18px）；Pill `rounded-full`。
- **内容宽度**：聊天 `--container-chat`（960px）；Composer `--composer-max`（864px）；弹窗见 `--container-*` 系列。
- **壳层网格**：`--grid-cols-shell`（280px 侧栏 + 1fr）；桌面收窄 `240px`。

---

## 7. 阴影与层级

原则：**能不用阴影就不用**；白底产品靠边框分层。

| Token | 用途 |
|-------|------|
| `--shadow-popover` | Dropdown、SlashMenu、Popover |
| `--shadow-float` | 轻悬浮卡片 |
| `--shadow-composer-overlay` | Composer 上浮层 |
| `--shadow-recovery` | 恢复/告警条 |
| `--shadow-accent-ring` | 运行中 activity 光晕 |

`z-index`：模态与 toast 由 Kobalte / 门户管理；业务勿随意叠 `z-50`。

---

## 8. 动效

- 默认过渡：`120ms ease`（按钮、边框、背景），见 `Button` base classes。
- **Spinner**：`.ui-spinner`（`primitives.css`），按钮 `busy` 时展示并 `aria-busy`。
- **Reduced motion**：streaming / ping 动画须尊重 `prefers-reduced-motion`（见 chat 工作状态行实现）。
- 禁止无意义入场动画；`fade-in` 仅用于轻量出现（popover）。

---

## 9. 组件目录（`shared/ui`）

| 组件 | 用途 | 关键 variant / 约定 |
|------|------|---------------------|
| `Button` / `IconButton` | 一切可点击主操作 | `primary` / `secondary` / `ghost` / `danger`；`busy` + spinner |
| `TextField` / `Textarea` / `SelectField` | 表单输入 | 错误态由 Field 包裹；label 关联 |
| `Checkbox` / `RadioGroup` | 设置、elicitation | Kobalte 原生 a11y |
| `Dialog` | 模态确认、设置、导入 | `DialogFooter` 右对齐主/次按钮 |
| `Popover` / `DropdownMenu` / `Listbox` | 菜单、slash 补全 | Listbox 键盘导航；slash 高亮 `bg-selected` |
| `Tabs` | 设置/面板分区 | 指示器用 accent |
| `Tooltip` | Icon-only 说明 | `IconButton` 内置 |
| `Toast` | 全局短暂反馈 | `showToast` / `dismissToast` |
| `Badge` | 紧凑标签 | `neutral` / `ok` / `warn` / `err` |
| `Status` | 连接/运行点 + 文案 | `live` → `aria-live` |
| `InlineNotice` | 流内告警条 | `info` / `success` / `warning` / `danger` |
| `EmptyState` / `LoadingState` | 空与加载 | 必须覆盖错误/重试路径 |
| `Spinner` | 内联等待 | 非按钮场景 |
| `CopyButton` | 复制代码/ID | 成功反馈 toast |
| `Collapsible` | 可折叠区块 | 侧栏归档区等 |

**图标**：统一 `Icon` 组件 + lucide 路径；**禁止**在 widget 内联 `<svg>` 画布（css-contracts 约束）。

**业务 Badge**：`widgets/shell/Badge` 的 `MessageStatusBadge` 等领域适配器允许存在，但视觉须委托 `shared/ui` token。

---

## 10. Widget 层模式

| 区域 | Widget 路径 | UI 要点 |
|------|-------------|---------|
| 壳层 | `widgets/shell` | AppShell 网格、ErrorCenter、ConnectionProblem、StatusArea |
| 侧栏 | `widgets/sidebar` | 28px 行高、选中 `bg-selected`、`For` 稳定 key |
| 聊天 | `widgets/chat` | Transcript 窗口化、Permission/Elicitation 队列、Markdown |
| 输入 | `widgets/composer` | Composer 圆角容器、slash overlay、`aria-activedescendant` |
| 资源 | `widgets/resource` | Explorer 树 24px 行、diff 编辑器、44px 触控目标 |
| 认证 | `widgets/auth` | AuthGate 卡片 `--container-auth-card` |

Widget **可以**读 `store`；**不得**直发 WebSocket 帧。复杂逻辑下沉 `features/*`。

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

- 按钮：**动词开头**（`Open`, `Retry`, `Allow once`）；破坏性用 `danger` variant，文案明确（`Delete`, `Revoke`）。
- 错误：说明发生了什么 + 单一主恢复动作；`delivery_unknown` 保留证据 + acknowledge 路径。
- 空状态：一句说明 + 可选主 CTA；不用俏皮语气。
- 加载：`Loading…` / `Connecting…` / `Calibrating…` 区分语义；禁止无限 spinner 无文案。

---

## 13. 新增 UI 的检查清单

- [ ] 颜色/间距/半径仅来自 token utility，无魔法数 hex（除 token 文件自身）
- [ ] 交互状态完整：default、hover、focus-visible、disabled、error（如适用）
- [ ] 文案英文；日志英文
- [ ] 使用 `@/shared/ui` barrel，不 deep import
- [ ] 单文件 &lt; 500 行；超复杂则拆 widget + feature
- [ ] `cd web && bun run test` 与相关浏览器契约通过
- [ ] 若引入新 token，先加 `tokens.css` + `theme.css`，再写组件

---

## 14. 后续演进（非阻塞）

- [ ] 深色主题：需先在 `tokens.css` 定义 `.dark` 语义映射，再更新 `theme.css`；废止 demo 的橙色映射 **不得**直接搬入
- [ ] 将 `style-demo.html` 重写为只读 token 画廊（只读现行绿/白规范）或移入 `docs/archive/`
- [ ] Storybook / visual-fixture 与本文 token 表自动对账

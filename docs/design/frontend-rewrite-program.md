---
status: accepted
date: 2026-09-08
---

# Web 前端重写纲领

> **本文是 Phase 6+ 的执行策略**（拆假分层、换无头底层、冻结 CSS 闸门）。
> **目录与依赖的单一事实源仍是** [`frontend-architecture.md`](frontend-architecture.md)。
> **视觉与组件契约仍是** [`ui-specification.md`](ui-specification.md)。
> **T1/T2 包边界与 Catalog 工作流是** [`ui-package-migration.md`](ui-package-migration.md)。
> **sandbox → 生产的历史映射证据是** [`ui-implementation-plan.md`](ui-implementation-plan.md)。
> **有意延后项** [`web-ui-deferrals.md`](web-ui-deferrals.md)。
> 关联 ADR：[0004](../adr/0004-web-frontend-layered-architecture.md)。

---

## 0. 红线：不破坏原有业务逻辑

结构、目录、JSX、primitive 底层可以推倒。**可观察的业务语义必须保持等价。**

协议、投递、权限、会话激活、ysync、`commandId` 幂等、reset 覆盖范围与相对顺序、ack / 失败 / unknown、工具路径规则——只许搬家和换皮，不许顺手改行为。拿不准时保留旧行为，行为变更必须独立成文、独立 PR，不得夹在重构里。

| 必须保持 | 可以改 |
|----------|--------|
| Action / 下行帧形状、`commandId` 幂等、ack / 失败 / unknown | JSX 结构、class、token |
| 投递阶段、重试、acknowledge 的触发条件 | 按钮 variant、密度、hover 显隐 |
| 权限 / elicitation 选项含义与提交顺序 | 选项间距（选项集合不变） |
| ysync subscribe/unsubscribe 时机与 doc 集合 | Dialog 换社区皮肤 |
| `resetAuthenticatedSession` 清理的模块集合与相对顺序 | store 从巨 switch 改为注册表（顺序锁死） |
| `onFrame` 各 `t` 的处理函数 | 处理函数换文件，不换实现 |
| Session 打开、QuickStart、模型/effort 写入路径 | 模型菜单换装配位置，仍调同一 mutation |
| `features/chat/tool-file-link` 的可点击路径规则 | 链接样式 |
| Enter 发送 / IME 组合态 / slash 命中 | Composer 拆文件、换 Toolbar primitive |

禁止夹带：改默认模型、token 预算公式、follow 的业务条件、重连退避、权限 deny 语义、已接线的 runtime 门闩。

**停手规则：** 领域测试红了，先复原行为再谈分层。不允许用「新架构更合理」覆盖失败断言。

---

## 1. 诊断（2026-09，迁移前历史快照）

五层目录已搭好，运行时真相仍是 `panel/lib` 单体：

| 声称 | 实际 |
|------|------|
| `features/*` 是用例层 | `connection` / `message` / `runtime` 仅 `.gitkeep`；投递、权限、连接在 `panel/lib` |
| `store` 薄组合根 | `store/index.ts` ~710 行：`onFrame` 巨 switch + 全站 reset + 30+ `panel/lib` import |
| widgets 只装配 | Composer / MessageList / Sidebar / AppShell 直连 `panel/store` 与 `panel/lib`；`RemoteDirectoryDialog` 直调 `sendFrame` |
| `entities` 只读投影 | 仍 import deprecated `panel/lib/yjs-values` |
| `shared/ui`（已迁至 `@peri/ui`） | 迁移前 IconButton 吞掉 `variant`/`busy`；ListboxItem 无行配方；控件高度 32/34 三处打架 |
| Tailwind 唯一表达 | `extra.css` 仍开口；`p-2.5` 等未入 theme 的小数；bracket 任意值漏检 |
| 自研 Kobalte 包装 | 无头半用，皮肤与 API 残缺，widget 在替设计系统打工 |

目录迁移约 30%，领域迁移约 20%。`frontend-architecture.md` Phase 1–5 标「已完成」只覆盖脚手架与部分垂直切片；**Phase 6 起按本文执行，停止「只加 shim 不删旧实现」。**

---

## 2. 原则

1. **业务逻辑冻结，只迁不改。** 见 §0。先钉测试再动刀；缺的补 characterization test（锁定今日行为）。
2. **一次切断 `panel/`。** 禁止新 deprecated re-export。迁完即删目录，CI 禁止 `web/src/panel`。删除前置：测试与调用点已切到新模块且行为对照通过。
3. **features 必须有实现。** 空目录填满（旧模块物理搬入 + 旧测试跟随）或从架构文档删除。禁止 `.gitkeep` 占位。
4. **widget 禁止领域状态机。** 状态机原文进入 features；widget 只绑同一套 store 窄 API，参数与错误语义不变。
5. **primitive 先于业务 UI。** 无头行为来自社区（§4），自己只做 token 皮肤与 Peri 语义。
6. **sandbox 是视觉编译器，不是复制源。** 只同步视觉契约；间距按生产 `--space-*` 换算。禁止把 sandbox 的 `gap-2` / `p-2.5` 原样抄进 `web/`。
7. **边界测试锁层。** eslint-boundaries + 扩展 `css-contracts`（任意值、未声明 spacing、新 css、`panel` import、widget 内 `<style>`）。
8. **文件硬上限。** `store/index.ts` < 200 行装配；widget < 250 行；feature 单文件 < 400 行。拆文件不等于拆逻辑。
9. **未接线 UI 可删，已接线逻辑不可删。** Approval / Voice / 无数据 Account 须证明无协议、无调用、无持久状态才可从主路径移除。凡已影响发送、会话、连接、权限的，即使 UI 丑也先原样装配。

---

## 3. CSS / Tailwind（零手写、零任意值）

业务与组件层 **禁止手写 CSS**。布局、状态、密度只走 Tailwind utility。`packages/ui/src/styles/tokens.css` / `theme.css` 是唯一数值源。

| 允许 | 禁止 |
|------|------|
| JSX 上已声明 utility：`gap-8`、`p-10`、`min-h-32`、`bg-surface`、`max-compact:px-8`、`grid-cols-split-auto` | 新 `.css` 文件、组件内 `<style>`、widget 旁路 stylesheet |
| 新值：先改 `tokens.css` + `theme.css` `@theme` 映射 | `p-[…]` `w-[…]` `h-[…]` `z-[…]` `max-[…]` `[&_…]` `content-['']` |
| 重复布局 → `--grid-cols-*` → `grid-cols-*` | 在 `extra.css` 登记「图省事」的语义 class |
| `primitives.css` 仅保留无法用 utility 表达的跨组件原子（滚动条、spinner keyframes），清单冻结 | 用 `extra.css` 表达本可用 `@theme` 表达的间距/层级/网格 |

`extra.css` / `primitives.css` 政策为 **冻结清单**：只许删除，或把规则升格为 token + 具名 utility。新增一行必须证明 Tailwind v4 `@theme` **表达不了**（WebKit scrollbar、第三方 Mermaid SVG 等）。证明不了就不写。升格时不得改变计算后的像素/颜色，除非对照表证明等价。

`css-contracts` 覆盖 `packages/ui`、`web/src/**/*.{tsx,ts}` 与 `ui-sandbox`。现有 `[color:var(--content-on-accent)]` 等必须消灭为 theme 色或具名 utility。

---

## 4. 社区无头优先（替换底层，不重写行为）

当前栈：Solid + `@kobalte/core` + 自研薄包装。问题不是「没用无头库」，而是包装残缺后在业务层补行为。

决策树：

1. **无头行为**（焦点、键盘、typeahead、modal、roving tabindex）→ 社区实现。默认继续 **Kobalte**。若某 primitive 在封装上已不可救（`IconButton`、`Listbox`、`Collapsible`、手写 `DialogClose`），允许换成同一生态内更完整的一层（维护中的 Solid + Kobalte 设计系统），**整组替换**，禁止单文件混两套无头库。
2. **皮肤** → 本仓库 token + CVA variant。剥掉社区默认色/间距。
3. **Peri 语义**（Session 行、Composer toolbar、投递错误）→ `widgets` / `features`，不得做进 `@peri/ui`。
4. **禁止自研：** 自定义 focus trap、自定义 menu 键盘、自定义 toast 队列（社区 Toast 已覆盖时）、自定义 Combobox 过滤核心、再写一套 Select。
5. **领域特例才自研：** xterm、Mermaid、Shiki、MCP App iframe、Git graph 画布。容器与主题仍走 token，不准为此重开 `extra.css` 闸门。

替换判据（满足任一条就换底层，不要继续补丁）：

- API 接受 `variant` 但不实现（现 `IconButton`）
- 只有 Kobalte 根、零默认 item 配方（现 `Listbox` / `Collapsible`）
- 关闭按钮手写尺寸而不用 `IconButton`（现 `DialogClose`）
- 同时存在两套无文档分工的 API（`Select` + `SelectField`）

换底层的交互契约：**只许等于或严格包含旧行为**（Esc 关、focus trap、disabled 时机）。社区默认不同时，必须配置到与当前产品一致，或先补测试再改，不在「换库」PR 里改交互契约。

sandbox 与 web **共用 `@peri/ui` 包内的同一包装模块**，禁止各写一套 Button。

---

## 5. 目标结构

与 [`frontend-architecture.md`](frontend-architecture.md) §3 一致。落地后不允许第二真相：

```
packages/ui/      T1 token/theme + T2 Base UI；唯一公共入口 @peri/ui

web/src/
  app/            bootstrap
  pages/          薄装配
  widgets/        JSX + Tailwind；只读 @/store 与 features 查询
  features/       纯 TS 用例 + 注入端口
    connection/   ws、帧、重连、ysync 端口
    message/      投递、follow、quick-start
    runtime/      permission、elicitation、rewind、turn
    composer/     slash、draft、prediction、budget
    session/      activation、order
    catalog/
    resource/     从 resource-store 切开
  entities/       只依赖 @/shared
  shared/
    lib/          keyboard、rfc3339、pick-directory
    protocol/     全部 Action/Ack（现 panel/lib/protocol.ts）
    yjs/
  store/          信号 + install* + 一行委托
```

`panel/` 已删除。widget 与 `@peri/ui` **不并列维护 T2 CSS**；Web 只拥有应用/widget 样式。

---

## 6. 领域包（搬家清单）

每包固定工序：

```
锁定今日测试 → 原样搬实现 → 改 import → 对照同一测试 → 删旧文件
```

禁止边搬边改算法。拆函数可以，分支条件必须能对上旧文件。

| 包 | 源 | 落点 | 注意 |
|----|----|------|------|
| **A 协议与连接** | `protocol` / `connection` / `ws-client` / `command-tracker` | `shared/protocol` + `features/connection` | widget `sendFrame` 即 CI 红；`RemoteDirectoryDialog` 只改装配，subscribe 时机不动 |
| **B 消息与回合** | `message-delivery` / follow / quick-start / permission / elicitation / runtime-control | `features/message` + `features/runtime` | 旧 `panel/lib/*.test.ts` 跟随；Composer 只调同一 façade |
| **C 共享基建** | `yjs-values` / `rfc3339` / `keyboard` / `prompt-budget` / `pick-directory` | `shared/yjs`、`shared/lib` | 函数体不动；entities 只认 `@/shared` |
| **D Store** | `onFrame`、`resetAuthenticatedSession` | feature `handleDownstream` + reset 注册表 | 每个 `t` 仍进原函数；reset 顺序用现有 reset 测试锁死 |
| **E Composer** | `widgets/composer/Composer.tsx` | 壳 + Toolbar + 单一附件 | 可拆文件；可删已证明未接线的 Approval/Voice；不可改 payload / IME / slash |
| **F Chat** | MessageList / ConversationMessage | 列表装配 + Spinner | follow / replay-boundary 条件不改 |
| **G Sidebar** | `ProjectSidebar.tsx` 等 | 树 / 行 / Nav / 归档 / 远程目录 | 排序、pin/archive、目录协议不改；logout 须有同等入口 |
| **H Resource** | `resource-store.ts` | `features/resource` | 按现有选择器切开，不合并状态形状 |

---

## 7. 执行顺序

```
0. 锁边界（eslint-boundaries + css-contracts）——不改运行时行为
        ↓
1. 社区 primitive（对照组件测试；键盘/焦点与今日一致）
        ↓
2. 包 A + C（纯搬家）
        ↓
3. 包 B + D（纯搬家 + 接线；reset / onFrame 测试先绿）
        ↓
4. 并行 E / F / G（换皮与拆文件，调用同一 façade）
        ↓
5. 删除 panel/（rg 零命中且 `cd web && bun run test` 全绿）
        ↓
6. 包 H；MCP / terminal 只收口 import
        ↓
7. sandbox → 生产刻度收敛（全程 Tailwind token，不改变点击与提交语义）
```

视觉对齐放最后：primitive 不稳时对齐会作废。

每个包必须删旧文件。只加不删不算完成。重构 PR 的领域分支应能 drope 到旧 `panel/lib` 对应函数；不能则拆出独立「行为变更」PR。

---

## 8. 完成定义

- `web/src/panel` 不存在；`rg "panel/lib|panel/store" web/src` 零命中（含 fixture）。
- `features/connection|message|runtime` 有实现与 `*.test.ts`，无 `.gitkeep`。
- widgets 零 `sendFrame`；features 零 `import … store`。
- `store/index.ts` 无按帧业务分支。
- `web/src/**/*.{tsx,css}` 无任意值 class；`extra.css` 相对本文基线只减不增。
- Composer Send 无 `bg-accent-solid` 长 class，只靠 `IconButton variant="primary"`。
- `@peri/ui` 每个导出组件的行为来自社区无头，或已记录的基础设施特例（Terminal）。
- 每个已迁模块：旧测试以新路径全绿，断言未改弱。
- `onFrame` 帧类型集合与处理函数对照表齐全；reset 模块列表有测试锁顺序。
- `cd packages/ui && bun run test`、`cd ui-sandbox && bun run typecheck && bun run build`、`cd web && bun run test && bun run build` 全绿。
- 本文取代「继续绞杀、无限期保留 shim」；`frontend-architecture.md` Phase 6+ 指向本文。

---

## 9. 风险（只盯业务等价）

| 陷阱 | 做法 |
|------|------|
| delivery / permission 自己 `createSignal`，store 再包一层 | 先画数据流，只留一处状态；对照旧信号名与更新时机，禁止顺手合并 |
| `onFrame` 拆文件后漏 case 或改顺序 | 帧表测试：每个 `t` 仍进原函数 |
| reset 漏一项 | 保持今日调用列表与顺序（`store-session-reset` 等） |
| 换 Kobalte 包装改变提交/关闭时机 | 组件测试锁 Enter、Esc、disabled |
| Composer 重写漏 IME / 附件 / slash | 先跑 `features/composer/*.test.ts`，widget 只换壳 |
| 修正 `gap-2`、默认 ghost、隐藏死按钮 | UI 可改；已接线门闩须先核对再删 |
| visual-fixture 仍指向 panel | 第 5 步同步，避免测旧接线、跑新接线 |
| 大 PR 混进协议字段整理 | 拒绝合入；重构 PR 只许路径与 JSX |

---

## 10. 与现有文档

| 文档 | 关系 |
|------|------|
| [`frontend-architecture.md`](frontend-architecture.md) | 层、依赖、别名、测试落点的权威；本文不改依赖表 |
| [`ui-specification.md`](ui-specification.md) | 视觉/a11y/文案权威；本文收紧「如何实现」（只 Tailwind、社区无头） |
| [`ui-implementation-plan.md`](ui-implementation-plan.md) | sandbox 映射；执行顺序上服从本文 §7（primitive 与搬家先于像素对齐） |
| [`architecture.md`](../architecture.md) §3.0 / §10 | 产品行为契约；重写不得违反 |
| ADR [0004](../adr/0004-web-frontend-layered-architecture.md) | 五层决策仍成立；绞杀者收口策略由本文接替 |

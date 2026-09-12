---
status: accepted
date: 2026-09-12
---

# Web UI 有意延后项（@peri/ui 迁移收口）

> 记录迁移完成后仍保留的边界与未接线能力；非 bug backlog。实现细节以源码为准。

## 1. MessageList：仅复用 MessageScroller 外壳

**现状**：`widgets/chat/MessageList.tsx` 使用 `@peri/ui` 的 `MessageScroller` / `MessageScrollerViewport`（scroll-fade、`ui-scrollbar`），`MessageScrollerProvider` 设 `autoScroll={false}`。

**延后**：未采用 `MessageScrollerItem` / `MessageScrollerContent`。列表虚拟化、吸底、`hasNewContent`、40px 阈值与 `TranscriptWindow` 变量高度锚定由 `MessageList` + `entities/chat/transcript-window` 承担；二者与 package 内基于固定行高的 item/content 模型不兼容。

**恢复条件**：`TranscriptWindow` 测量与锚定契约可映射到 package API，或 package 提供不假设等高的 scroller 插槽。

## 2. Sidebar：`collapsible` 与 AppShell 网格拖拽

**现状**：

- `widgets/shell/SidebarChrome.tsx`：`Sidebar` 固定 `collapsible="none"`（`@peri/ui` 的 `offcanvas` / `icon` 折叠未接入）。
- `widgets/shell/AppShell.tsx`：桌面侧栏宽度由 `grid-template-columns` + 分隔条 pointer/keyboard 拖拽（220–480px，默认 242px）；`max-desk` 走 `ProjectDrawer` 抽屉，非 Sidebar offcanvas。

**延后**：不在同一壳层同时启用 `@peri/ui` Sidebar 折叠态与 AppShell 列宽 resize；避免两套宽度/开关状态冲突。

**恢复条件**：统一侧栏宽度与移动端显隐的单一状态源（store 或 shell feature），再评估 `collapsible="icon"` 或 offcanvas 是否取代/合并现有 resize 条。

## 3. 生产边界二次构建（commit `8fad9a9`）

**变更**：移除 `web/scripts/verify-production-boundary.mjs` 与 `web/scripts/visual-contract.mjs`；`bun run test` 不再在测试末尾额外执行 `vite build` 产物扫描或跨视口 visual 矩阵。

**仍保留**：

- `bun run test`：`tsc --noEmit` + `node --test tests/*.test.mjs`（含 `css-contracts.test.mjs`）+ `vitest run`
- `bun run test:browser`：Playwright 浏览器契约（真实布局、焦点、虚拟化、Mermaid；不含 token 像素快照）
- 发布前仍须 `bun run build`（Rust `build.rs` 内嵌 `web/dist`）

**理由**：二次 build 与 dev/prod 模块图漂移的对抗价值已由分层门禁、css-contracts 与 CI 独立 `build` 步骤覆盖；视口矩阵与 Playwright 交互契约重复且维护成本高。

# Peri Studio UI Sandbox

设计稿沙箱：四级组件体系与设计 tokens。与 `web/` 生产构建完全隔离。

```bash
cd ui-sandbox
bun install
bun run dev   # http://127.0.0.1:5273/

# 或从仓库根目录：
./dev-sandbox.sh
```

## 导航

- **顶栏**：T1 + T2（5 页）+ T3 + T4 Tab 切换 tier
- **左侧章节栏**：当前页内快速跳转（如 Markdown、User bubble…）
- **小屏**：章节栏收进抽屉，点顶栏列表图标打开
- **深链**：`#/blocks/markdown` 直达某章节

| Tier | 路由 | 目录 | 职责 |
|------|------|------|------|
| **T1 · Tokens** | `#/tokens` | `src/styles/tokens.css` | Palette → semantic → component 数值源 |
| **T2 · Core** | `#/components` | `@peri/ui` | 核心原语（Button、Input、Dialog…） |
| **T2 · Forms** | `#/components-forms` | `@peri/ui` | 表单、日期、Field、DataTable、Questionnaire |
| **T2 · Overlays** | `#/components-overlays` | `@peri/ui` | 表面、浮层、导航、侧栏 |
| **T2 · Chat** | `#/components-chat` | `@peri/ui` | shadcn 聊天原语（Message、Tool、Composer） |
| **T2 · AI** | `#/components-ai` | `@peri/ui` | AI Elements 对齐组件 |
| **T3 · Domain blocks** | `#/blocks` | `src/components/blocks/{chat,composer,chrome}/` | 单域块：Markdown、SlashMenu、ChatHeader… |
| **T4 · Compositions** | `#/layers` | `src/layers/{shell,chat,composer,…}/` | 业务组合：侧栏、transcript、composer、决策面… |

依赖方向：T4 → T3 → T2 → T1（禁止反向）。

## 设计定稿（2026-08-30）

- Accent：湛蓝 `#2563eb`
- 选中态：浅灰底 `bg-sidebar-selected`，不用主色边框
- Badge：中性灰字 + 状态点
- 控件高：24 / 32 / 40

权威规范见主仓 `docs/design/ui-specification.md`。

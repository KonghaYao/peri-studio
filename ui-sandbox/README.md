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

- **封面**：空 hash 与 `#/home` 进入编辑风主页（无左侧章节栏）
- **顶栏**：Home · T1 · T2 · Comp Tab 切换 tier；品牌名回封面
- **左侧章节栏**：当前页内快速跳转（如 Markdown、User bubble…）
- **小屏**：章节栏收进抽屉，点顶栏列表图标打开
- **深链**：`#/components-markdown/markdown-render` 直达某章节

| Tier | 路由 | 目录 | 职责 |
|------|------|------|------|
| **Cover · Home** | `#/home` | `src/pages/HomePage.tsx` | Catalog 封面：原则、Fields、索引 |
| **T1 · Tokens** | `#/tokens` | `src/styles/tokens.css` | Palette → semantic → component 数值源 |
| **T2 · Core** | `#/components` | `@peri/ui` | 核心原语（Button、Input、Dialog…） |
| **T2 · Forms** | `#/components-forms` | `@peri/ui` | 表单、日期、Field、DataTable、Questionnaire |
| **T2 · Overlays** | `#/components-overlays` | `@peri/ui` | 表面、浮层、导航、侧栏 |
| **T2 · AI** | `#/components-ai` | `@peri/ui` + blocks | Chat 原语与 AI Elements |
| **T2 · Markdown** | `#/components-markdown` | blocks | 富文本渲染与 CodeBlock |
| **Comp · Shell / Composer / Explorer / Git** | `#/components-shell` 等 | `src/layers/` + `src/components/blocks/` | 区域组合与域块 |

依赖方向：Comp → T2 → T1（禁止反向）。旧 `#/layers/*`、`#/blocks/*` 自动重定向。

## 设计定稿（2026-08-30）

- Accent：湛蓝 `#2563eb`
- 选中态：浅灰底 `bg-sidebar-selected`，不用主色边框
- Badge：中性灰字 + 状态点
- 控件高：24 / 32 / 40

权威规范见主仓 `docs/design/ui-specification.md`。

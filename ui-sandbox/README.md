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

- **顶栏**：T1–T4 四个 Tab 切换 tier
- **左侧章节栏**：当前页内快速跳转（如 Markdown、User bubble…）
- **小屏**：章节栏收进抽屉，点顶栏列表图标打开
- **深链**：`#/blocks/markdown` 直达某章节

| Tier | 路由 | 目录 | 职责 |
|------|------|------|------|
| **T1 · Tokens** | `#/tokens` | `src/styles/tokens.css` | Palette → semantic → component 数值源 |
| **T2 · Base UI** | `#/components` | `@peri/ui` | 核心原语（Button、Input、Dialog…） |
| **T2 · Base UI 2** | `#/components2` | `@peri/ui` | 扩展原语与新一轮 shadcn 补齐组件 |
| **T3 · Domain blocks** | `#/blocks` | `src/components/blocks/{chat,composer,chrome}/` | 单域块：Markdown、SlashMenu、ChatHeader… |
| **T4 · Compositions** | `#/layers` | `src/layers/{shell,chat,composer,…}/` | 业务组合：侧栏、transcript、composer、决策面… |

依赖方向：T4 → T3 → T2 → T1（禁止反向）。

## 设计定稿（2026-08-30）

- Accent：湛蓝 `#2563eb`
- 选中态：浅灰底 `bg-sidebar-selected`，不用主色边框
- Badge：中性灰字 + 状态点
- 控件高：24 / 32 / 40

权威规范见主仓 `docs/design/ui-specification.md`。

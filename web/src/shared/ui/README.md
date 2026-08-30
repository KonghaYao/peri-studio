# shared/ui

Peri Studio Web **设计系统层**（Kobalte 封装）：Button、Dialog、Listbox 等通用组件，**零** server / session / project 业务语义。

- **唯一入口**：`shared/ui/index.ts`（`@/shared/ui`）
- **视觉规范**：[`docs/design/ui-specification.md`](../../../docs/design/ui-specification.md)
- **Token 事实源**：`web/src/styles/tokens.css` → `theme.css`

Widget 层组合业务 UI；不得 deep import 本目录单文件，不得内联裸 SVG（见 `css-contracts.test.mjs`）。

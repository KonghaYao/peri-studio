# peri-studio Web（SolidJS 前端）

peri-studio 的浏览器客户端：SolidJS + Vite + Tailwind v4。它只消费 server 的协议事实，
不在浏览器里伪造对话历史（与 server 的边界见仓库根 README 与 docs/architecture.md）。

## 开发命令

```bash
bun install        # 安装依赖
bun run dev        # 启动 Vite 开发服务器（生产入口 index.html）
bun run visual:dev # 启动 Vite 开发服务器（--host 127.0.0.1，visual fixture 入口）
bun run typecheck  # tsc --noEmit
bun run build      # 生产构建
```

## 测试双轨分工

Web 前端维护两套互补的测试轨道，职责不同、互不替代：

| 轨道 | 位置 | 运行器 | 定位 |
| --- | --- | --- | --- |
| 契约门（快速） | `tests/*.test.mjs` | node:test（`node --test`） | 纯 Node 断言，无 DOM、无浏览器。守护状态机/纯函数契约、CSS 结构/token/媒体查询契约、visual fixture 隔离契约。CI 快速门，毫秒级完成 |
| 单元测试 | `src/**/*.test.ts(x)` | vitest（jsdom） | 组件渲染、store/模块行为的单元级验证，与产物代码同目录 |
| 浏览器契约 | `tests/browser/*.spec.mjs` | Playwright | 真实浏览器中验证 visual fixture 的交互与几何（含 locale/timezone 证据），需要浏览器环境 |

`tests/` 契约门按主题拆分为多个文件，每个文件独立可跑：

- `tests/state-contracts.test.mjs` — 纯函数契约（action-state / recovery-state / message-time / markdown / message-follow / overlay-state / auth-feedback / session-search / runtime-state 等）与 store/connection/protocol 等模块行为契约；
- `tests/css-contracts.test.mjs` — CSS 结构 / design token / 媒体查询断言，以及特性组件对 UI 库的消费边界（barrel、SVG 画布、按钮行为、色彩、Badge/Tooltip/Drawer 视觉委托）；
- `tests/fixture-contracts.test.mjs` — visual fixture 入口隔离（dev-only、不绕过生产鉴权）与 overlay 几何断言；
- `tests/onframe-routing.test.mjs` — store.onFrame 下行帧路由契约（不丢帧、无死 case）；
- `tests/session-import.test.mjs` — session 导入相关契约。

## 验证命令

```bash
bun run test        # 完整 CI 门：tsc --noEmit + node --test tests/*.test.mjs + vitest run + 生产边界验证
bun run test:browser # Playwright 浏览器契约（自动拉起 visual dev server，需先 bun install 的浏览器）
```

`bun run test` 是提交前的必跑门；`bun run test:browser` 在有浏览器环境（或 CI）时运行。

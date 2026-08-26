# 已鉴权界面视觉样例

这个仅用于开发环境的入口，会用确定性的合成 Store 数据渲染真实
`AppShell`。它用于检查通常依赖在线 Server、ACP 进程和浏览器 Cookie
才能出现的界面状态。

```bash
cd peri-studio/web
bun run visual:dev
# 打开 http://127.0.0.1:5173/visual-fixture.html?scenario=conversation
```

桌面宽度下，fixture 左侧目录提供以下场景：`conversation`、
`long-conversation`、`markdown`、`tools`、`permission-streaming`、
`elicitation`、`subtasks`、`resources`、`assets`、`terminal-readonly` 和
`catalog`。未知值回退到基础对话。增加 `sidebar=projects` 可以临时显示真实项目侧栏，
供项目导航契约验收使用。

## 安全边界

- 生产 `index.html`、`AuthGate`、传输层和 Server 路由不会导入或分支到该 fixture。
- 常规 `vite build` 只有一个显式入口，不会输出此 HTML、fixture JavaScript 或 CSS。
- 场景数据全部为合成数据，不包含凭据材料。
- Fixture 控件只验收渲染、焦点、折叠和本地浮层。Fixture 不会修改 Store 私有的
  `ready` 或 `currentCid` 传输状态，因此 Server 操作仍受生产门禁约束。

修改任一入口后运行 `bun run verify:production-boundary`。Server Web 路由测试会独立证明
内嵌资源中不存在该 fixture。

`scripts/visual-contract.mjs` 是跨视口矩阵使用的浏览器几何与状态断言契约；截图只作为
审查证据，不作为脆弱的像素基线。

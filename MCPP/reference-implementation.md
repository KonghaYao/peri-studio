# 附录 A：本仓库参考实现

[文档库首页](index.md) · [上一篇：一致性要求](conformance.md) · [下一篇：术语](glossary.md)


本仓库以两层结构落地 MCPP（即 1.1「项目身份」的实现示例）：

- [`packages/mcpp`](../packages/mcpp)：规范行为即代码的 SDK——skills 扫描/摘要/资源挂载（`ResourceForSkills`，第 3.4 双通道投影参考实现）、双模式启动（stdio + streamable HTTP）、默认 `127.0.0.1:8457`、`createGateway` 聚合与只读 Server Catalog（第 3.7–3.7.1）、`plugin.json`/`mcp.json` 校验。
- [`examples/plugins/monorepo`](../examples/plugins/monorepo)：聚合上层（monorepo 拓扑，第 3.7）——单一 HTTP 出口包含 `/catalog/mcp`、`/openspec/mcp` 与根路径 HTML + CDN Catalog demo；Catalog 仅解析静态 Child endpoint，不提供安装或下发。`openspec/skills` 打包第三方 OpenSpec 技能集（通道 A 素材），由子 server 投影为 `skill://` 资源（通道 B）。
- [`examples/plugins/.mcp.json`](../examples/plugins/.mcp.json)：MCP 客户端级配置（`streamable-http` 指向聚合出口），与第 3.3 的插件级 `mcp.json` 同构——客户端把插件的便携 `mcp.json` 映射到自身原生 MCP 配置。

**待办标记**（通往完整 MCPP conforming）：

- 为聚合上层补齐插件清单 `plugin.json`（对应 3.2）；
- 实现 `skills/list` / `skills/get` / `directoryRead`（对应 S4/S5）与 `io.mcpp/*` 编排字段解析（对应 A7）；
- 为 `packages/mcpp` 实现第 8.2 节 `ChannelManager` / `Channel` / `ChannelStore`、`send()` / `receive()`、标准 `subscriptions/listen` sink 与 `tools/call` dispatcher 适配、有界背压及 Durable Event Log / inbound 幂等 conformance 测试；不得引入 Claude/vendor Channel 线级扩展；
- 为 `packages/mcpp` 补充 NPM keyword / manifest Store projection、dist-tag 版本解析证据、MCP JSON、Worker Isolate `WorkerOrchestrator` adapter、Deployment 状态机、Mono Server MCP 透明路由及 source 环境变量重定向（见 [`MCP_REGISTRY.md`](../MCP_REGISTRY.md)）。

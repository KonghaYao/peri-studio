# monorepo —— MCPP 聚合 server 示例

演示 [MCPP 3.7–3.7.1] 的 monorepo 拓扑：**单一 HTTP 出口、只读 Server Catalog、路径路由到独立 Child MCP**。

## 形态

```
                    ┌────────────────────────────────────────┐
  客户端             │  monorepo（单一 HTTP server，端口 8457） │
                    │                                        │
  GET / ────────────►  Catalog HTML + Tailwind CDN demo       │
  GET/POST /catalog/mcp ─►  只读 Server Catalog               │
  GET/POST /openspec/mcp ─► OpenSpec Child MCP（skills）      │
  其他路径                  ─► 404（挂载表可审计）            │
                    └────────────────────────────────────────┘
```

- `/catalog/mcp` 是**独立的只读 Catalog origin**：它枚举和解析已静态挂载的 Child endpoint，但不暴露或代理它们的 tools/resources/skills；`resolve` 也不会安装、下发、启动或 provision Server。
- `/openspec/mcp` 是**独立的 Child MCP endpoint / origin**：客户端解析 Catalog 后仍须独立连接和协商，skills、tools、resources 不会与 Catalog 或其他 Child endpoint 混淆。
- Catalog 只返回同 authority 的相对 `endpointPath`，Agent 将其解析到 Catalog 的 scheme / host / port；不会由 Catalog 引导跨域连接或转交凭据。
- **stdio 不适用该形态**：stdio 没有 URL/路径概念，无法表达多端点挂载（MCPP 3.7 边界）。
- 聚合逻辑由 [`@peri-code/mcpp`](../../../packages/mcpp) 的 `createGateway` 承担：挂载表即路由表，每个 Child server 独立实例、相互隔离。

## 目录结构

```
monorepo/
├── package.json          # 聚合根：依赖 @peri-code/mcpp
├── src/
│   └── index.ts          # 聚合入口（createMonorepoGateway / createMonorepoRoutes）
├── catalog-demo.html       # 本机 Bun 根路径返回的 HTML + Tailwind CDN 检查页
├── test/smoke.ts           # Catalog、Child endpoint、多会话、HTML 与 Worker 契约
├── worker.ts               # Cloudflare Workers 部署入口（只暴露 MCP 路由）
├── wrangler.jsonc        # CF 部署配置
├── mcp.json              # 聚合出口的 mcp.json 承载声明
└── openspec/             # openspec 子 server（自包含）
    ├── server.ts         # 构造 openspec 子 server（投影 openspec/skills）
    └── skills/           # 第三方 skills 集（Fission-AI/OpenSpec，12 个 openspec-*）
```

## 运行

```sh
# 启动聚合出口（默认端口 8457）
bun src/index.ts        # → http://127.0.0.1:8457/
#   /            可在浏览器检查 Catalog HTML + Tailwind CDN demo
#   /catalog/mcp 只读 Server Catalog
#   /openspec/mcp OpenSpec Child MCP

# 端到端验证
bun test/smoke.ts       # 官方 StreamableHTTPClientTransport 连接端点
```

## Cloudflare 部署

```sh
bunx wrangler dev       # Worker 预览；仅 MCP 路由，HTML demo 不部署到 Worker
bunx wrangler deploy    # 发布
```

会话注册表为 isolate 内存态（单实例可用）；生产多实例并发需外置会话状态（Durable Objects）。

## 相关

- 规范：[`MCPP.md`](../../../MCPP.md)（第 3.7–3.7.1 monorepo 聚合与 Server Catalog、3.1 承载、3.4 skills 双通道）
- 规范包：`@peri-code/mcpp`（`packages/mcpp`，`createGateway` 实现）
- 承载约定：[agent-plugins.org](https://agent-plugins.org/plugin-authors/manifest)（manifest 规范）

[MCPP 3.7]: ../../../MCPP.md

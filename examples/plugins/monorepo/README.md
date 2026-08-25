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
- `GET /` 由 `@peri-code/mcpp` 的 `createCatalogPageHandler` 提供同源 Catalog 检查页；example 仅配置 Child mount 表，不维护页面实现。
- 本地 Bun 入口以 `ResourceForSkills` 实时投影 `SKILL.md` 和批准目录中的附属文件；Worker 入口使用构建期 `openspec/static-skills.generated.ts`，运行时不读取本地 skills 目录。

## 目录结构

```
monorepo/
├── package.json          # 聚合根：依赖 @peri-code/mcpp
├── src/
│   └── index.ts          # 聚合入口（createMonorepoGateway / createMonorepoRoutes）
├── test/smoke.ts           # Catalog、Child endpoint、多会话、Catalog 页面 helper 与 Worker 契约
├── scripts/
│   └── generate-skills-registry.ts # Worker 构建前生成静态 Skill Resource registry
├── worker.ts               # Cloudflare Workers 部署入口（MCP 路由 + Catalog 页面）
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
#   /            @peri-code/mcpp 提供的 Catalog HTML + Tailwind CDN 检查页
#   /catalog/mcp 只读 Server Catalog
#   /openspec/mcp OpenSpec Child MCP

# 端到端验证
bun test/smoke.ts       # 官方 StreamableHTTPClientTransport 连接端点
```

## Cloudflare 部署

```sh
# Worker 预览；先将受限公开的 Skill 文件生成到静态 registry
bun run generate:skills
bunx wrangler dev

# 可在不部署的情况下验证 Worker bundle
bun run build:worker

# 发布
bunx wrangler deploy
```

会话注册表为 isolate 内存态（单实例可用）；生产多实例并发需外置会话状态（Durable Objects）。

## 相关

- 规范入口：[`MCPP/index.md`](../../../MCPP/index.md)
- 插件承载与 Skills 双通道：[Agent Plugin](../../../MCPP/agent-plugin.md)
- monorepo 聚合与 Server Catalog：[MCP Mono Server](../../../MCPP/mcp-mono-server.md)
- 规范包：`@peri-code/mcpp`（`packages/mcpp`，`createGateway` 实现）
- 承载约定：[agent-plugins.org](https://agent-plugins.org/plugin-authors/manifest)（manifest 规范）

[MCPP 3.7]: ../../../MCPP/mcp-mono-server.md

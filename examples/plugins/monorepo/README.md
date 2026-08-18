# monorepo —— MCPP 聚合 server 示例

演示 [MCPP 3.7] 的 monorepo 拓扑：**单一 HTTP 出口，路径路由到子 server**。

## 形态

```
                    ┌────────────────────────────────────────┐
  客户端             │  monorepo（单一 HTTP server，端口 8787） │
                    │                                        │
  GET/POST /openspec/mcp ──►  openspec 子 server（OpenSpec skills） │
  其他路径                  ──►  404（挂载表可审计）                 │
                    └────────────────────────────────────────┘
```

- 每个路径是**独立的 MCP endpoint / origin**：客户端按 URL 连接，独立协商（skills、tools、resources 互不混淆）。
- **stdio 不适用该形态**：stdio 没有 URL/路径概念，无法表达多端点挂载（MCPP 3.7 边界）。
- 聚合逻辑由 [`@peri-code/mcpp`](../../../packages/mcpp) 的 `createGateway` 承担：挂载表即路由表，每个子 server 独立实例、相互隔离。

## 目录结构

```
monorepo/
├── package.json          # 聚合根：依赖 @peri-code/mcpp
├── src/
│   └── index.ts          # 聚合入口（createMonorepoGateway / createMonorepoRoutes）
├── test/smoke.ts         # 官方 client 连接端点 + 多会话 + 404 断言
├── worker.ts             # Cloudflare Workers 部署入口（纯 fetch handler）
├── wrangler.jsonc        # CF 部署配置
├── mcp.json              # 聚合出口的 mcp.json 承载声明
└── openspec/             # openspec 子 server（自包含）
    ├── server.ts         # 构造 openspec 子 server（投影 openspec/skills）
    └── skills/           # 第三方 skills 集（Fission-AI/OpenSpec，12 个 openspec-*）
```

## 运行

```sh
# 启动聚合出口
bun src/index.ts        # → http://127.0.0.1:8787/
#   /openspec/mcp openspec 子 server（OpenSpec skills）

# 端到端验证
bun test/smoke.ts       # 官方 StreamableHTTPClientTransport 连接端点
```

## Cloudflare 部署

```sh
bunx wrangler dev       # 本地预览（默认也是 8787，与本机进程错开端口）
bunx wrangler deploy    # 发布
```

会话注册表为 isolate 内存态（单实例可用）；生产多实例并发需外置会话状态（Durable Objects）。

## 相关

- 规范：[`MCPP.md`](../../../MCPP.md)（第 3.7 节 monorepo 聚合、3.1 承载、3.4 skills 双通道）
- 规范包：`@peri-code/mcpp`（`packages/mcpp`，`createGateway` 实现）
- 承载约定：[agent-plugins.org](https://agent-plugins.org/plugin-authors/manifest)（manifest 规范）

[MCPP 3.7]: ../../../MCPP.md

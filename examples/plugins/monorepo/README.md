# monorepo —— MCPP 聚合 server 示例

演示 [MCPP 3.7] 的 monorepo 拓扑：**一个进程、一个 HTTP 出口，路径路由到多个子 server**。
顶层是聚合上层，`office/` 是它的子项目（标准 Agent Plugin），被 `/office/mcp` 挂载。

## 形态

```
                    ┌────────────────────────────────────────┐
  客户端             │  monorepo（单一 HTTP server，端口 8787） │
                    │                                        │
  GET/POST /office/mcp   ──►  office 子 server（skills/ 全量）       │
  GET/POST /hello/mcp    ──►  hello 子 server（最小 tool）          │
  GET/POST /openspec/mcp ──►  openspec 子 server（OpenSpec skills） │
  其他路径                  ──►  404（挂载表可审计）                 │
                    └────────────────────────────────────────┘
```

- 每个路径是**独立的 MCP endpoint / origin**：客户端按 URL 连接，各自独立协商（skills、tools、resources 互不混淆）。
- **stdio 不适用该形态**：stdio 没有 URL/路径概念，无法表达多端点挂载（MCPP 3.7 边界）。
- 聚合逻辑由 [`@peri/mcpp`](../../../packages/mcpp) 的 `createGateway` 承担：挂载表即路由表，每个子 server 独立实例、相互隔离。

## 目录结构

```
monorepo/
├── package.json          # 聚合根：依赖 @peri/mcpp + office（workspace:*）
├── src/
│   ├── index.ts          # 聚合入口（createMonorepoGateway）
│   ├── servers/hello.ts  # 第二个子 server（最小编制，验证多 server 聚合）
│   └── servers/openspec.ts # 第三方 skills 子 server（投影 openspec/skills）
├── test/smoke.ts         # 官方 client 分连各端点 + 404 断言
├── office/               # 子项目（标准 Agent Plugin）
│   ├── src/index.ts      # createOfficeServer：skills 投影 / 订阅 / tools
│   ├── skills/           # skill 源目录，经 server 自动挂载为 skill:// 资源
│   └── test/             # demo + 三路径 smoke
└── openspec/             # 第三方 skills 集（Fission-AI/OpenSpec，12 个 openspec-*）
    └── skills/           # 由 openspec 子 server 投影：/openspec/mcp 发现与读取
```

`office` 通过 workspace 依赖（`"office": "workspace:*"`）暴露 `createOfficeServer`；
被聚合导入时其自身入口被 [`import.meta.main`](office/src/index.ts) 保护，不产生独立启动副作用。

## 运行

```sh
# 启动聚合出口
bun src/index.ts        # → http://127.0.0.1:8787/
#   /office/mcp   office 子 server
#   /hello/mcp    hello 子 server
#   /openspec/mcp openspec 子 server（OpenSpec skills）

# 端到端验证
bun test/smoke.ts       # 官方 StreamableHTTPClientTransport 分连各端点
```

## office 子项目单独运行

```sh
cd office
bun src/index.ts            # 单 server streamable HTTP（http://127.0.0.1:8457/mcp）
bun src/index.ts --stdio    # stdio 模式（配 Claude Desktop / MCP Inspector）
bun test/demo-client.ts     # 进程内端到端演示（skills/订阅/tools）
bun test/smoke.ts           # stdio / HTTP / gateway 三路径冒烟
```

## 相关

- 规范：[`MCPP.md`](../../../MCPP.md)（第 3.7 节 monorepo 聚合、3.1 承载、3.4 skills 双通道）
- 规范包：`@peri/mcpp`（`packages/mcpp`，`createGateway` 实现）
- 承载约定：[agent-plugins.org](https://agent-plugins.org/plugin-authors/manifest)（manifest 规范）

[MCPP 3.7]: ../../../MCPP.md
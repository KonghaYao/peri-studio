# 4. MCP Registry 体系：NPM 投影、Worker Dynamic Host 与 Mono Server

[文档库首页](index.md) · [上一篇：MCP Mono Server](mcp-mono-server.md) · [下一篇：MCP Skills 与 Agents](mcp-skills.md)

Registry 与 Dynamic Host 的完整权威设计见 [`MCP_REGISTRY.md`](../MCP_REGISTRY.md)。

MCP Registry、MCP NPM Registry、MCP Mono Server 三个系统的职责、依赖、故障边界，以及 Dynamic Host 的部署协调方案，已迁移到独立权威设计 [`MCP_REGISTRY.md`](../MCP_REGISTRY.md)。本页只保留 MCPP 的衔接契约和稳定章节编号。

MCPP 对 Registry 集成规定以下底线：

- **MCP Registry**：按 NPM keyword 搜索并从 package manifest 动态投影 Store 与 MCP JSON；projection 可缓存但 MUST 可由 NPM 重建，不得持久化第二份定义表；
- **MCP NPM Registry**：拥有 keyword、package metadata、dist-tag、tarball、integrity 与 NPM 权限，是目录和版本唯一权威；version selector MUST 跟随 dist-tag；
- **MCP Mono Server**：作为统一 HTTP 主 Server，拥有 endpoint route 与 active Worker binding，并透明转发 MCP；不得聚合或改写 Child 能力；
- **Dynamic Host**：MUST 通过成熟 Worker Isolate orchestrator adapter 部署 Server runtime；记录 dist-tag 当次解析出的 exact version / integrity，并向 Mono Server register / replace / drain Worker；
- **Agent Plugin**：一个插件可映射任意数量 MCP server，本规范暂不设数量上限；
- **NPM 路由**：`/npm/{sourceId}/` 直接路由到 source URL；配置的环境变量 MAY 重定向 base URL，但不得改变 source/package/dist-tag identity 或泄露凭据；
- **Client 与 stdio**：Client 只消费 `mcpServers`；stdio 在本地从 MCP NPM Registry 取包，不经过 Dynamic Host 或 Mono Server，也不得转换为 HTTP。

具体数据模型、流程与首轮实现范围以 [`MCP_REGISTRY.md`](../MCP_REGISTRY.md) 为准；若本文摘要与独立设计冲突，以独立设计为准。

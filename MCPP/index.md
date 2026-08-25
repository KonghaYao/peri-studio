# MCPP —— MCP Plus：构建于 MCP 2026-07-28 之上的 Agent 层交互规范

> 状态：Draft v0.2（2026-08-25）
> 基础协议：[MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
> 扩展基准：[SEP-2640 Skills Extension](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640)（Extensions Track，Draft）、[Agent Skills 规范](https://agentskills.io/specification)与 [Claude Code custom subagents](https://code.claude.com/docs/en/sub-agents)（MCP Agents 文件形态参考；非线级依赖）
> 定位：MCPP 具有**双重身份**——
> - **规范身份**：一份构建于 MCP 2026-07-28 之上的**规范化规范**（conforming spec），即 Agent 层交互指南，规范 Agent 如何发现、评估、使用基于 MCP 传递的 Skills、Tools 与 Resources，不改变 MCP 线级语义；
> - **项目身份**：其实现又是一个遵循 **Agent Plugin 1.0.0 格式**的标准插件项目（`plugin.json` + `skills/` + `mcp.json`），执行能力由 MCP server 承载。

---

> **权威入口**：`MCPP/index.md` 是 MCPP 规范文档库的唯一内容入口。根级 `MCPP.md` 仅用于兼容旧链接，不承载规范正文。

## 文档地图

| 主题模块 | 原章节 | 职责 |
| --- | --- | --- |
| [引言](introduction.md) | 第 1 章 | 定位、范围、读者、文档约定与上游规范分工 |
| [核心模型](core-model.md) | 第 2 章 | 能力三角、Agent 生命周期、渐进披露、origin 与多 server 共存 |
| [Agent Plugin](agent-plugin.md) | 第 3.1–3.6 节 | 插件布局、manifest、MCP 承载、Skills 双通道与加载隔离 |
| [MCP Mono Server](mcp-mono-server.md) | 第 3.7 节 | HTTP 多端点与只读 Server Catalog |
| [MCP Registry](mcp-registry.md) | 第 4 章 | Registry / NPM / Dynamic Host / Mono Server 的衔接契约 |
| [MCP Skills 与 Agents](mcp-skills.md) | 第 5 章 | Skill / Agent 资源格式、发现、校验、编排与激活 |
| [MCP Tools](mcp-tools.md) | 第 6 章 | Tool 元数据、命名、状态、错误与懒加载 |
| [MCP Resources 发现与缓存](mcp-resources.md) | 第 7 章 | Resource 发现、annotations、MCPP Cache 与分页 |
| [MCP Resources 使用](resource-usage.md) | 第 8.1、8.3–8.6 节 | Resource 读取、引用、MRTR、状态句柄与大载荷传递 |
| [MCP Channel](mcp-channel.md) | 第 8.2 节 | 标准 Resource Subscription、双向语义、事务、授权与恢复 |
| [Channel SDK 接口](channel-sdk.md) | 第 8.2.1 节 | `ChannelManager`、`Channel`、`ChannelStore`、`send`、`receive` 的 TypeScript 风格契约 |
| [MCP Extension](mcp-extensions.md) | 第 9 章 | 扩展标识、能力位、协商与最低实现面 |
| [安全与信任](security.md) | 第 10 章 | 不可信内容、origin、批准、权限与缓存隔离 |
| [一致性要求](conformance.md) | 第 11 章 | Server / Skill 与 Agent / Host 的可验证要求 |
| [参考实现](reference-implementation.md) | 附录 A | 规范与仓库实现的映射及待办 |
| [术语](glossary.md) | 附录 B | 全库统一术语定义 |

## 推荐阅读路径

- **MCP Server / Plugin 作者**：[引言](introduction.md) → [核心模型](core-model.md) → [Agent Plugin](agent-plugin.md) → 对应的 [Skills](mcp-skills.md) / [Tools](mcp-tools.md) / [Resources](mcp-resources.md) → [安全与信任](security.md) → [一致性要求](conformance.md)。
- **Mono Server / Registry 实现者**：[MCP Mono Server](mcp-mono-server.md) → [MCP Registry](mcp-registry.md) → [`MCP_REGISTRY.md`](../MCP_REGISTRY.md) → [安全与信任](security.md) → [一致性要求](conformance.md)。
- **Channel SDK 实现者**：[MCP Channel](mcp-channel.md) → [Channel SDK 接口](channel-sdk.md) → [MCP Resources 发现与缓存](mcp-resources.md) → [MCP Extension](mcp-extensions.md) → [一致性要求](conformance.md)。
- **Agent / Host 实现者**：[核心模型](core-model.md) → [MCP Skills 与 Agents](mcp-skills.md) → [MCP Tools](mcp-tools.md) → [MCP Resources](mcp-resources.md) → [安全与信任](security.md) → [一致性要求](conformance.md)。

## 版本与编号策略

- 规范版本、基础协议版本和扩展基准只在本页维护；主题文档不复制版本头，避免多份事实源。
- 原章节编号暂时保留，作为规范性条款、实现和测试之间的稳定引用；新增导航优先链接文件名与标题。
- 各主题文档负责一个高内聚模块；跨模块依赖通过本索引和页首导航显式连接。

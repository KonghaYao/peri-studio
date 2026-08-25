# 附录 B：术语

[文档库首页](index.md) · [上一篇：参考实现](reference-implementation.md)


| 术语 | 定义 |
| --- | --- |
| MCPP / MCP Plus | 本文档：MCP 2026-07-28 之上的 Agent 层交互规范 |
| **MCP Skills** | MCPP 顶层特性（第 5 章）：Skill 的跨协议传递、检校、激活与编排约定 |
| **MCP Agents** | MCPP 顶层特性（5.10）：以 `agent://.../agent.md` Resource 下发 subagent 配置，并约束发现、激活、缓存、content-bound 批准与最小权限收敛 |
| **MCP Registry** | NPM keyword / manifest 的动态 Store 投影与 MCP JSON；无持久定义表，缓存可由 NPM 重建 |
| **MCP NPM Registry** | package、keyword、dist-tag、tarball、integrity 与权限的唯一权威；支持 source URL 环境变量重定向 |
| **MCP Mono Server** | 统一 HTTP 主 Server：拥有 route 与 active Worker binding，透明转发 MCP 到 Worker Child endpoint |
| **Dynamic Host** | Worker Isolate 编排适配：从 NPM 拉包、记录 Deployment，并向 Mono Server 注册 Worker；不处理 stdio |
| **MCP Resources** | MCPP 顶层特性（第 7/8 章）：Agent 层资源发现与使用的统一约定 |
| **MCPP Channel** | MCPP SDK 的 Server 侧应用层抽象（8.2），由 `ChannelManager`、`Channel`、`ChannelStore`、`send` 与 `receive` 组成；出站映射标准 Resource Subscription，入站映射标准 Tool，不是 MCP primitive 或 extension |
| **ChannelManager** | 注册 Channel、适配标准 Resource 与 Tool 方法、接入 subscription sink、执行授权隔离、幂等、背压和生命周期管理的 Server 内部组件 |
| **Channel** | 具有稳定身份、方向、schema、授权、存储、durability / retention，以及与方向匹配的 Resource / Tool binding 的强类型单向或双向 SDK 对象 |
| **send** | 先原子提交 Resource 事实、再向已授权且已订阅 sink enqueue `notifications/resources/updated` 的 Server API；成功不等于 Client 或模型已处理 |
| **receive** | 注册唯一强类型 Server handler 的 SDK API；Client 消息只经绑定 Tool 的标准 `tools/call` 进入，handler 返回直接 Tool result，`context.reply()` 独立走 `send()` |
| **MCPP Cache** | MCPP 顶层特性（7.3）：对 MCP Caching 的 Agent 层消费约定及统一缓存抽象；包含 Server Cache Version、MCPP Response Cache 与 Resource Content Cache |
| **MCP Tools** | MCPP 顶层特性（第 6 章）：Agent 侧工具使用约定与 Server / Skill 作者的「可被正确调用」要求 |
| **MCP Extension** | MCPP 顶层特性（第 9 章）：MCPP 扩展的声明与双向协商约定（扩展标识、版本、能力位、最低实现面） |
| Agent Plugin | agent-plugins.org 1.0.0 定义的部署单元：plugin.json + 可选 skills/ 与 mcp.json（第 3 章）；MCPP 的标准分发形态 |
| origin | Agent 可区分的能力来源：一个连接的 server、或一个插件（含其打包技能）各构成一个 origin；以 host-assigned 标签标识 |
| manifest（plugin.json） | 插件可移植清单：身份与元数据的闭合字段集（3.2） |
| mcp.json | 插件内 MCP 执行承载声明：`mcpServers` 的闭合字段集（3.3） |
| 双通道分发 | 插件技能的两条通道：`skills/` 打包（静态、filesystem origin）与 MCP `skill://`（动态、server origin），同源投影（3.4） |
| Skill | 目录 + SKILL.md（frontmatter + 指令正文）+ 可选的 references/scripts/assets |
| 渐进式披露 | Discover（元数据）→ Activate（正文）→ Execute（按需加载支持文件）的阶段模型 |
| content-bound 批准 | 批准绑定观察到的 `resources` 集合（{uri, digest}），集合变化即撤销 |
| 编排（orchestration） | MCPP 新增（MCP Skills 子能力）：依赖拓扑加载、工具绑定、上下文预算的 Agent 层协作 |
| registry | Agent 侧能力目录：每个能力只存元数据（name/description/origin/URI） |
| 部署形态（deployment form） | Dynamic Host 将 NPM Store projection 部署为 Worker Isolate，Mono Server 透明转发 HTTP MCP；stdio 走 Client → NPM 本地链路（第 4 章） |
| MCP Registry projection | `(sourceId, packageName, distTag)` 的非持久视图；由 NPM keyword / manifest 动态重建 |
| Dynamic Deployment | 运行事实：NPM 当次 exact version、integrity、Worker 状态和目标 route |
| MCP Registry HTTP 配置 | 只有 Mono Server active Worker binding 才能生成 `streamable-http` URL |
| MCP Registry stdio 配置 | 生成 Client-local `npx` 参数；不创建 Worker Deployment |
| MCP R | MCP NPM Registry 的 keyword 候选集及其动态 MCP 语义投影，不是独立持久表 |

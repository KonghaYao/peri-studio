# 9. MCP Extension：扩展声明与协商

[文档库首页](index.md) · [上一篇：Channel SDK 接口](channel-sdk.md) · [下一篇：安全与信任](security.md)

Channel 不属于 MCP Extension；其纯标准绑定见 [MCP Channel](mcp-channel.md)。


本章定义 **MCP Extension**——MCPP 已登记扩展能力的声明与双向协商约定：扩展标识与版本、能力位、最低实现面。MCPP 不发明新的传输语义，协商机制沿用 MCP 扩展机制。[MCP Channel](mcp-channel.md) 不属于 MCP Extension：`ChannelManager` / `Channel` / `send` / `receive` 仅为 SDK 内部抽象，线级仅使用标准 Resources、Subscriptions 与 Tools，因此不得为 Channel 增加 extension capability 或私有 JSON-RPC method。

## 9.1 扩展标识与版本

MCPP 的能力需要 server 与 Agent 双向显式协商，遵循 MCP 扩展的协商机制（SEP-2133）。

- **协议版本**：MCPP 版本以 `MCPP-Version: 1.0`（当前草案）声明。Agent MUST 在每请求 `_meta` 中携带其支持的 MCPP 版本；Server SHOULD 忽略高于其实现的 MCPP 版本字段，按既有版本处理。
- **扩展命名空间**：MCPP 自身扩展的 capabilities 键使用保留前缀 `io.mcpp/`。Skill 传输能力**不新造 extension id**，直接复用官方 `io.modelcontextprotocol/skills`（其下新增的编排字段在 frontmatter `metadata."io.mcpp/*"` 中，见 5.2）。

> 设计说明：MCPP 不引入并行的 skills 扩展，而是「官方扩展为体，MCPP 字段为用」，避免生态分裂。

## 9.2 能力位

| 能力位 | 作用域 | 说明 |
| --- | --- | --- |
| `io.modelcontextprotocol/skills`（extension） | server declarations | 承诺实现 `skills/list` 与 `skills/get` |
| `io.modelcontextprotocol/skills.directoryRead` | extension setting | 承诺实现 `resources/directory/read` |
| `io.mcpp/agents` | server declarations | Server 承诺按 5.10 通过标准 Resources 暴露 MCP Agents；不新增 `agents/*` 方法，也不表示 Host 必然支持 subagent runtime |
| `io.mcpp/server-catalog` | server declarations | Catalog endpoint 实现只读 `mcpp/servers/list` / `get` / `resolve`（3.7.1）；不声明即不得调用 |
| `io.mcpp/skill-orchestration` | agent-side（host 声明） | Agent 支持 `io.mcpp/depends_on` / `io.mcpp/tools` 编排字段的解析与拓扑加载 |
| `io.mcpp/context-budget` | agent-side | Agent 支持 `io.mcpp/context_budget` 预算约束 |
| `io.mcpp/server-cache-version` | 双向协商 | Agent 支持按 Server Cache Version 复用 MCPP Cache；Server 声明 opaque `cacheVersion` |

Server 的 skill 能力声明（示意，wire 细节属 MCP 层）：

```jsonc
"capabilities": {
  "extensions": {
    "io.modelcontextprotocol/skills": { "directoryRead": true }
  }
}
```

Agent（客户端）侧的 MCPP 编排能力属于宿主行为声明，主要用于 server 决定 instruction 措辞；Server 不得因 Agent 未声明编排能力而拒绝服务。

Channel Server 不得出现在本表：它只声明标准 `resources` capability（至少 `subscribe: true`，动态目录按需 `listChanged: true`），可选双向动作声明标准 `tools` capability。任何 MCPP/vendor Channel capability 或 Channel notification 均为本规范禁止的私有线级绑定。

## 9.3 Server Cache Version 协商

`io.mcpp/server-cache-version` 为可选的双向协商能力。Agent 声明该能力表示其能够安全保存 MCPP Cache 并按 Server Cache Version 复用；Server 声明该能力时 MUST 在初始化结果的扩展设置中返回非空 opaque `cacheVersion`。该值只用于相等比较，不要求 SemVer、可排序或可逆，且 MUST NOT 包含 token、用户标识等敏感信息。

Server MUST 将 `cacheVersion` 视为其对当前授权可见、声明可缓存状态的整体标识；任何可能改变 `tools/list`、`prompts/list`、`resources/list`、`resources/templates/list`、`skills/list`，或相应 `resources/read`、`skills/get` 等可缓存内容的变化（包括 `agent://` 列表元数据或 `agent.md` 内容变化），MUST 产生不同的 Server Cache Version。`tools/call`、采样、授权、状态推进及其他有副作用或实时语义的方法 MUST NOT 因 Server Cache Version 相等而跳过。

Agent MUST 按 origin 保存带 `cacheVersion` 的 MCPP Cache 条目，并继续遵守 `public` / `private` cache scope：private 条目的 Server Cache Version 与内容 MUST 按 authorization context 隔离。即使两个身份收到相同 `cacheVersion`，也不得跨身份复用 private 内容；不同 origin 即使 `cacheVersion` 字符串相同也不得复用。Server 若无法保证授权视图变化必然改变 Server Cache Version，MUST NOT 声明此能力。

```jsonc
"capabilities": {
  "extensions": {
    "io.mcpp/server-cache-version": {
      "cacheVersion": "sha256:opaque-snapshot-id"
    }
  }
}
```

Server Cache Version 相等只证明 Server 声明的可缓存状态未变化，不提升内容信任等级，也不取消通知失效规则；它仅在重新协商成功后替代对应 MCPP Cache 条目的 TTL 新鲜度判断。客户端移除 Server、authorization context 失效或安全策略要求刷新时，Agent SHOULD 删除对应 MCPP Cache 条目。

## 9.4 最低实现面

- 宣称实现 `io.modelcontextprotocol/skills` 的 Server，**MUST** 至少实现 `skills/list` 与 `skills/get`（空/局部列表合法）；
- 宣称 `directoryRead` 者，**MUST** 对其以独立文件服务的每个 skill 命名空间内目录支持该方法（方法本身通用，不限于 skill scheme）；
- `skills/get` 的未知 URI 返回 `-32602`，与 `resources/read` 未知资源一致；
- 宣称 `io.mcpp/server-catalog` 者，MUST 实现 3.7.1 的 `mcpp/servers/list`、`mcpp/servers/get`、`mcpp/servers/resolve`，且 `resolve` 无副作用；
- Agent 仅在看到对应声明后才调用相应方法；其余情况下 fallback 到 resources 渠道（3.4 的模板/指令基线）。

---

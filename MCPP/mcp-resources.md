# 7. MCP Resources：资源发现（Agent 层）

[文档库首页](index.md) · [上一篇：MCP Tools](mcp-tools.md) · [下一篇：MCP Resources 使用](resource-usage.md)

相关模块：[Resource 使用](resource-usage.md) · [MCP Channel](mcp-channel.md) · [MCP Extension](mcp-extensions.md)


**MCP Resources** 是 MCPP 对 Agent 层资源发现与使用的统称（本页负责发现，[Resource 使用](resource-usage.md)负责读取与引用，[MCP Channel](mcp-channel.md)负责订阅与双向交互）。资源原语的定义与字段在 MCP 规范中；本页规范 Agent「如何发现并组织它们」。

## 7.1 发现渠道

Agent 应综合利用以下渠道构建资源视角：

1. **`resources/list`**：全局资源枚举（分页 + 缓存）。作为基线渠道；
2. **`resources/templates/list`**：参数化资源（RFC 6570 模板）。`skill://{skillName}/SKILL.md` 模板对 Skill 场景尤其重要（见 5.4）；
3. **`resources/directory/read`**（`directoryRead: true` 的 server）：目录资源的下钻导航（Skill 内 references/templates 的目录浏览）；
4. **Skill 内的相对引用**：Skill 目录文件的相对路径解析规则（见 [Resource 读取](resource-usage.md)）；
5. **工具返回的引用**：`resource_link` 与显式 URI（见 [嵌入与引用](resource-usage.md)）。

Agent **SHOULD** 将这三类来源合成统一的资源导航视图，但**MUST** 保留来源标注（global list / template / directory / skill-relative），因为其完整性语义不同。

## 7.2 过滤与优先级（annotations）

资源及其内容块支持 annotations：

| 字段 | 取值 | Agent 规则 |
| --- | --- | --- |
| `audience` | `user` / `assistant` | 为模型选上下文时，Agent 优先 `assistant`；`user` 者按用户需求呈现 |
| `priority` | 0.0–1.0 | 上下文预算有限时按 priority 降序裁减；1.0 （有效必需）者不得因预算省略（除非显式用户指示） |
| `lastModified` | ISO 8601 | 用于排序与新鲜度展示，也辅助缓存决策 |

MCPP 规则：

- Agent **MUST** 将 annotations 视为不可信输入（可能被 server 操纵），其用途仅是**提示排序与呈现**，不构成授权证据；
- Agent 的默认上下文纳入准则是 `audience: assistant` 且 `priority` 高于阈值；阈值由宿主策略决定；
- 仅当资源标注缺失时，Agent 才退化为按名称/描述启发式。

## 7.3 MCPP Cache：缓存与新鲜度

**MCPP Cache** 是 MCPP 对 MCP Caching 的 Agent 层消费约定，也是本规范对缓存能力的总称。MCPP 实现 MUST 提供统一的 cache abstraction，并至少实现 **MCPP Response Cache** 与 **Resource Content Cache**；具体缓存介质、是否持久化、淘汰算法、容量限制或预取策略由宿主决定。`skills/get` 及 Skill references/assets 若通过 MCP Resource 暴露，MUST 复用 Resource Content Cache 语义。Agent SHOULD 按 MCP Caching 规范消费 `resources/list`、`resources/templates/list`、`resources/read`、`skills/list` 与 `skills/get` 完整结果携带的 `ttlMs`、`cacheScope` 及相关失效通知。

### 7.3.1 术语与命名

| 规范术语 | 代码 / 线级名称 | 定义 |
| --- | --- | --- |
| **MCPP Cache** | `McppCache` | 本节全部缓存能力的总称与统一抽象，不表示某一种具体缓存层。 |
| **Server Cache Version** | `cacheVersion` | Server 对当前授权可见、声明可缓存状态的整体 opaque 版本；仅用于相等比较，不是缓存条目本身，也不是 Server 软件版本。 |
| **MCPP Response Cache** | `McppCache` 中按 `method + params` 寻址的条目 | 保存声明可缓存的完整 MCP 响应，并按 origin、scope 和 authorization context 隔离。 |
| **Resource Content Cache** | `McppCache` 中按 Resource URI 寻址的内容条目 | 保存 `resources/read` 及经 MCP Resource 暴露的 Skill 文件内容，是 MCPP Response Cache 的 Resource 专用视图。 |
| **stale** | `stale` | 条目已失效，不得作为新鲜缓存静默使用；与“未存储”不同。 |
| **cache hit / cache miss** | 缓存命中 / 缓存未命中 | 当前层可直接返回 / 必须继续下一层或远程获取。 |
| **remote fetch** | 远程获取 | 通过 MCP 请求从 Server 重新取得响应；不使用“回源”指代该动作。 |

规范正文、实现 API 与测试名称 SHOULD 使用上表术语；`version` 单独出现时不得指代 Server Cache Version，必须写作 `cacheVersion` 或完整术语。

### 7.3.2 客户端强缓存（fresh cache hit）

客户端强缓存指：已有条目的 TTL 尚未到期，且 scope、authorization context、origin 与请求键均匹配时，Agent **MAY 直接复用，不发起任何 MCP 请求**。这里的“强”描述客户端的新鲜度决策，不等同于 HTTP `Cache-Control`，也不允许绕过宿主安全策略。

推荐读取顺序如下；命中即停止，不应为“确认仍然新鲜”而额外访问 Server：

1. **MCPP Response Cache**：按 origin、MCP method、所有影响结果的请求参数、scope 与 authorization context 查找完整响应；分页列表的 `cursor` 是缓存键的一部分；
2. **Resource Content Cache**：对 `resources/read` 及经 Resource 暴露的 Skill / Agent 文件，按 origin、Resource URI、完整请求参数与授权上下文查找内容；
3. **remote fetch**：条目缺失、TTL 到期、已标记 stale 或安全策略要求刷新时，才远程获取。

`cacheScope: private` 的结果 MUST 按 authorization context 隔离，MUST NOT 跨身份复用；`cacheScope: public` 的结果可跨授权上下文复用，但也 MUST NOT 跨 origin 复用。authorization context 必须是宿主生成的 opaque 标识，MUST NOT 包含 token、cookie 或其他凭据。实际执行、有副作用或实时语义的方法不得进入强缓存。

`ttlMs` 是新鲜度上限提示而非内容不变证明。Agent MAY 在 TTL 内直接复用；条目过期后 SHOULD 在下次需要时进入协商缓存或远程获取，MUST NOT 把 TTL 当作后台轮询周期。server 未提供可缓存字段、返回 `ttlMs: 0`，或宿主无法安全构造缓存键时，Agent SHOULD 不存储。

### 7.3.3 客户端协商缓存（Server Cache Version revalidation）

协商缓存用于**避免强缓存未命中后的完整目录与内容重传**，而不是每次读取前的前置请求。它只在双方协商 `io.mcpp/server-cache-version`（9.3）后生效，RECOMMENDED 触发点为：

- 建立或重新建立连接并完成 MCP 初始化时；
- 本地条目 TTL 到期且下一次确实需要该内容时；
- 宿主执行显式 refresh 时。

Agent 将初始化结果中的 `cacheVersion` 与本地同一 origin、cache scope、authorization context 下保存的版本做严格相等比较：

- **相等**：Agent MAY 将该版本覆盖且未被通知或安全策略单独失效的 MCPP Response Cache 与 Resource Content Cache 重新标记为 fresh，并按各条目已保存的 `ttlMs` 从本次成功协商时刻重新计时；无需重取每个 list/read 响应；
- **缺失、不相等或协商失败**：视为协商未命中。Agent MUST 将旧版本覆盖的条目标记 stale，再按需远程获取；MUST NOT 用新 `cacheVersion` 给旧内容续鲜；
- **离线或 Server 不可达**：不构成协商命中。条目保持 stale，只能按本节后述降级展示，不得自动使用。

Server Cache Version 是整体 validator，不是内容、授权或信任凭证。一次协商不得把 `private` 条目迁移到另一 authorization context，也不得跨 origin 复用。为避免“版本相等但通知已精确失效”的回退，Agent MUST 保存该连接世代内的本地 stale 标记；除非后续得到覆盖该变化的新版本并完成相应远程获取，否则单纯重复看到相同版本不得清除该标记。

### 7.3.4 失效、stale 降级与决策摘要

收到 `notifications/resources/list_changed` 时，Agent MUST 将该 origin 的 `resources/list`、`resources/templates/list` 以及由其派生的 Skill / Agent registry 元数据缓存视为 stale；收到 `notifications/resources/updated` 时，Agent MUST 将对应 URI 的 `resources/read` 缓存视为 stale。一次读取若返回多个 `contents[]` URI，Agent SHOULD 使所有受影响的聚合缓存同时 stale；无法精确定位时 MUST 保守地使该 origin 的相关 read 缓存 stale。

重取失败时，Agent MAY 向用户展示 stale 内容，但 MUST 标注 origin、最后接收时间与过期状态；MUST NOT 将 stale 内容静默用于自动上下文注入、Skill 或 Agent 激活、工具执行、授权或安全决策。缓存副本 MUST 保留原始 origin，MUST NOT 伪装成 `file://` 或本地可信资源。

| 当前状态 | 客户端行为 | 是否产生远程请求 |
| --- | --- | --- |
| fresh 且键 / scope / 身份匹配 | 强缓存直接返回 | 否 |
| TTL 到期，连接初始化可协商且 `cacheVersion` 相等 | 协商续鲜后返回 | 仅初始化协商；不逐资源重取 |
| TTL 到期且版本缺失 / 变化 / 协商失败 | 标 stale，按需重取 | 是 |
| 收到精确失效通知 | 标 stale；活跃项主动重取，其余下次使用重取 | 按需 |
| 离线且仅有 stale 副本 | 只可带显著标记展示 | 否；不得自动消费 |

- 列表缓存是新鲜度提示而非完整性/信任证据：目录可能过期、局部、被篡改（见第 10 章）；
- **确定性顺序**在资源列表同样成立：Agent 的排序键 RECOMMENDED 为 `(audience, priority desc, lastModified desc, uri)`，稳定输出以保 LLM prompt cache 收益；
- 订阅（listChanged / resources/updated）是缓存失效的推送通道，见 8.2。

## 7.4 分页与原子性

- 所有 list 方法按 MCP 的 `cursor` / `nextCursor` 契约分页；
- Skill 条目（`skills/list`）的 `resources` 集合**原子**：不得跨页拆分（SEP-2640 要求）；
- Agent 遍历分页时 **MUST** 走完整个游标链，不得假定首页即全集；也不得假定列表非空即完备（局部列表合法）。

---

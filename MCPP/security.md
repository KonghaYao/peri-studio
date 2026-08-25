# 10. 安全与信任（Agent 视角）

[文档库首页](index.md) · [上一篇：MCP Extension](mcp-extensions.md) · [下一篇：一致性要求](conformance.md)


MCPP 把安全规则写成 Agent 侧义务（与 SEP-2640 的安全模型一致），因为「能力如何被消费」最终发生在 Agent 层。

## 10.1 内容不可信与提示注入

- Agent **MUST** 将 MCP 下发的所有内容视为**不可信模型输入**：工具描述、资源注释、Skill 正文、MCP Agent frontmatter / system prompt、指令字段，都可能被恶意或受损 server 用于注入。这包括 description 被改为「要求执行敏感操作」的情形。
- 防御基线：与任何 server 提供文本同级的注入防御（隔离执行上下文、敏感操作二次确认、输出审计）。一个 server 被连接，不等于其内容获得权威地位。

## 10.2 origin 可见与原信任

- Skill 正文进入模型上下文时，Agent **MUST** 携带来源 server 的 **host-assigned 标签**显示（例如 `[来自服务器 office]`），MUST NOT 让远端 Skill 与本地文件系统 Skill 在上下文中不可区分；
- 决定是否遵循 Skill 指令的决策权 MUST 保留给模型本身（开放推理），宿主只能帮助模型看到来源；
- 跨 origin 资源读取是 confused-deputy 向量：由 skill A 触发的内容，Agent **MUST NOT** 顺带用它驱动对 server B 的 `resources/read`；任何跨 origin 读取 MUST 经显式、逐调用、点名双方的批准。
- 命名空间冲突即冒充面：恶意 server 可发布同名 Skill 冒充热门/本地的同名技能。Agent MUST 在 per-origin 命名空间内解析名称、MUST NOT 让远端 Skill 静默遮蔽或拦截其他来源的同名调用，SHOULD 向用户展示冲突。

## 10.3 批准与内容绑定

- **Skill 激活逐 Skill 批准**：作为 3.6 加载规则的补充，远端 Skill 的激活属于用户知情范围内的能力启用；宿主设计上 MAY 对本地可信任来源采用默认允许，但远端 Skill 的激活 **MUST** 至少经一次显式用户同意，且该同意不可跨 Skill、跨来源静默续用。
- **批准必须内容绑定（content-bound）**：持久化的批准 MUST 绑定批准时刻观察到的条目 `resources` 集合（每个 `{uri, digest}`）。此后条目若变化（文件旋转、增删）——无论来自 `skills/list` 还是 `skills/get` —— Agent **MUST** 视为原批准已撤销，重新征求同意后方可继续加载/执行。

> **与缓存刷新的关系（据 5.6.1 / A10）**：`ttlMs` 列表刷新导致 stale 属于**缓存失效**（A10），本身不打扰用户；content-bound 的批准撤销在**下次实际激活 / 执行该 Skill 时**才被评估，因此例行刷新不会逐条触发重新同意。宿主可对「重新征求同意」的交互做节流 / 聚合（例如把同一次刷新暴露的多个变化合并为一次确认），属 Agent 层 UX 策略（1.6）；唯最终生效的批准必须绑定实际使用的内容。
- digest 校验保证的是「列表与所取内容一致」（防篡改、防过期），**不是**可信凭证：digest 与正文同源，联动改写的中间人可同时伪造两者。Match 不构成安全边界。
- 批准的 Skill 之外，不得因「同一文件空间内存在其他 SKILL.md」（嵌套）而使其生效（嵌套需自身激活，见 5.6）。

## 10.4 无隐式执行与权限授予

- Agent **MUST NOT** 因 MCP 下发的 Skill 内容（声明字段或正文指令）直接触发宿主机侧代码执行，除非该执行经逐 Skill 显式批准；
- Agent Skills 的 `allowed-tools` 等扩权字段，在 **MCP origin 的 Skill 上必须忽略**，除非用户就该 Skill 显式批准该项授予。远端 server 填写 `allowed-tools` 是请求提升宿主权限，不是声明自身属性；
- 上述批准与宿主自身的工具启用策略叠加；「Skill 该字段出现了」永不是权限依据。

## 10.5 缓存隔离与持久化

- Agent 若在本地磁盘缓存 MCP 下发的 Skill 内容，**MUST** 将缓存目录排除在所有文件系统 Skill 发现路径之外；自该位置加载 = 仍按「经 MCP 到达」对待，适用本节全部规则（含重启后、源 server 断开后）；
- 用户移除某 server 时，Agent SHOULD 移除其缓存内容；
- 敏感数据红线（贯穿全文）：API 密钥、token、PII 不得进入工具描述、Skill 正文、日志或错误文本；`x-mcp-header` 等路由元数据不得携带敏感参数（MCP 规范已禁止，MCPP 重申为 Agent 审计项）。

---

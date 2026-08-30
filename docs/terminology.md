# Peri Studio 术语集合（定制版）

> 状态：v1.4 定稿（2026-08-30，ACP 权威会话目录，[ADR-0003](adr/0003-acp-authoritative-session-catalog.md)）
> 定位：本仓库**唯一权威术语表**。代码标识符、ws 协议帧、磁盘持久化格式、
> 文档一律以本表为准。旧术语仅在「历史数据/迁移说明」中出现。
> 原则：**session 一词特指 ACP 进程内的会话**，其余原 session 概念全部更名。

---

## 1. 实体定义

| 术语 | 定义 | 身份标识 | 取代旧术语 |
| --- | --- | --- | --- |
| **chat**（对话） | server 侧对话容器：一次用户对话的持久化身份（UUID），面板左侧列表条目；对应 `chats/{chat_id}/` 目录 + 双 Doc + registry 摘要 | `chat_id`（UUID，server 生成） | session（hub 侧）/ `session_id` |
| **instance**（实例） | 一个 ws 连接所注册的 machine：运行 ACP 进程的独立运行角色，outbound ws 连 server，接收 spawn/kill 指令 | `instance_id` | machine / `machine_id` |
| **session**（会话） | **ACP 进程内的会话**：agent 进程收到 `session/new` 后建立，`session/prompt` 等 JSON-RPC 方法的作用域 | `session_id`（agent 返回） | acp_session_id（所指实体，名不变） |
| **project**（项目） | Web 侧持久分组；继承 workspace 的名称、cwd 与 instance 路由语义，由 SQLite 作为事实源 | `project_id`（hub 生成） | workspace（兼容投影继续保留） |
| **project session**（项目会话） | Web 左栏中的持久会话入口；**即 ACP durable thread 在目录中的投影**，不等同于一次 runtime `chat_id`。目录事实由 ACP `session/list` + agent 磁盘承载；Hub 不再生成独立 logical id | wire `sessionId` = ACP `session_id`（与 `acp_session_id` 同值） | hub `project_session_id` |
| turn（轮） | 一轮 prompt → 回复 | `turn_id` | 不变 |
| entry / block / tool_call | 消息条目 / 内容块 / 工具调用 | `entry_id` / `block_id` | 不变 |

**归属关系**：一个 chat → 归属 1 个 instance（`instance_id` 字段，create 时指定，缺省 `local`）+ 绑定 1 个 ACP session（binding：`session_id → chat_id`）。instance 可同时承载多个 chat（心跳 `alive_sessions`），ACP 一进程一会话。

Web 项目模型额外遵守：一个 project → 多个 project session（各对应一个 ACP durable `session_id`）；打开 project session 时在 project cwd 上 `spawn + session/load`，可在不同时刻绑定不同的 runtime `chat_id`。server 重启后旧 chat 不复活，目录缓存为空直至 `session/discover` 或用户打开 project 触发 `session/list`；归档与自定义展示名仅存浏览器 IndexedDB（`{principalId, projectId, acpSessionId}`），server 不持久化。

## 1.1 产品与运行形态

| 术语 | 定义 | 不是 |
| --- | --- | --- |
| **`peri-studio` 可执行文件** | 唯一发布单元；包含 server 与 instance 全部能力以及内嵌 Web 资产 | 单一运行角色；单一 OS 进程的承诺 |
| **server 角色** | 中心控制面、HTTP/ws listener、认证、投影与持久化的运行角色 | instance；浏览器客户端 |
| **instance 角色** | 以 `connect` 模式主动连接 server，持有 ACP 子进程与断线缓冲的运行角色 | Web 面板；server 内部线程 |
| **local 模式** | 在同一台机器启动 server 角色，再以同一可执行文件启动独立 instance 进程，通过真实 `/instance` ws + HMAC 回连 | 绕过网络协议的进程内直调 |
| **connect 模式** | 只启动 instance 角色，连接用户明确指定的 server URL | 打开 Web 面板；新建 server |
| **Web 面板** | 由 server 托管内嵌静态资产、在浏览器运行的视图客户端 | `connect` 模式；instance |

### 1.2 机器管理（产品面）

协议与代码身份仍是 `instance_id`，禁止复活 `machine_id`。以下只用于 Web 文案、
设计文档与 SQLite `machines` 表的产品语义。可开工契约见
[`docs/design/ssh-machine-mount.md`](design/ssh-machine-mount.md) 与
[ADR-0002](adr/0002-ssh-machine-provisioner.md)。

| 术语 | 定义 | 不是 |
| --- | --- | --- |
| **machine**（机器） | 用户可管理的一台能运行 ACP 的计算机；SQLite `machines` 行 + 可选 live instance | 第四种与 `instance_id` 并列的协议身份；浏览器里的 SSH 会话 |
| **This computer** | `instance_id = "local"` 的本机 instance | 可 SSH 添加或移除的条目；协议副标题 `local` 不得作为产品文案 |
| **SSH / remote computer** | `kind = ssh` 的记录 | 手工 `connect <公网 URL>` 的另一种协议 |
| **供应管道** | 探测/安装 peri-studio、签发 token、建立反向隧道、等待 hello | UI 动词 Mount；SSHFS |
| **Disconnect tunnel** | 只拆本机 `ssh -R` | 停远端 ACP |
| **Stop agents** | 经 SSH exec 关闭远端 connect 并结束 ACP | 只拆隧道 |
| **machine record** | SQLite 挂载意图（目标、展示名、phase），离线仍保留 | InstanceRegistry 的 hello 条目（仅 live） |

在指代产品运行角色时，“client”一词不得单独使用：它可能指 Web 面板，也可能
指以 WebSocket 主动连接 server 的 instance。必须使用“Web 面板”或“instance
角色”明示指代；协议中已定义的 `client token` 与 client→server 方向标记仍保持不变。

## 2. 代码/协议/存储映射表（旧 → 新）

### 2.1 核心类型与变量

| 旧 | 新 |
| --- | --- |
| `SessionRegistry` / `SessionEntry` / `SessionState` | `ChatRegistry` / `ChatRecord` / `ChatState` |
| `session_id`（UUID，server 生成） | `chat_id` |
| `acp_session_id`（变量/字段名） | `session_id`（ACP 会话；wire 上 ACP `sessionId` 字段不变） |
| `SessionSummary`（registry 摘要） | `ChatSummary` |
| `MachineRegistry` / `MachineEntry` / `MachineState` | `InstanceRegistry` / `InstanceRecord` / `InstanceState` |
| `MachineView` / `machine_id` / `session_count` | `InstanceView` / `instance_id` / `chat_count` |
| `MachineConfig` / `MachineHello` / `MachineHeartbeat` / `MachineSpawn` / `MachineKill` / `MachineSpawnAck` / `MachineKillAck` / `MachineForwardAck` / `MachineProcessExit` | 对应 `Instance*` 前缀 |
| `TokenRole::Machine` / wire `"machine"` | `TokenRole::Instance` / wire `"instance"` |
| `DEFAULT_MACHINE_ID = "local"` | `DEFAULT_INSTANCE_ID = "local"` |

### 2.2 ws 协议帧（instance 侧 → server）

| 旧 | 新 |
| --- | --- |
| `machine/hello` / `machine/heartbeat` / `machine/spawn` / `machine/spawn_ack` / `machine/kill` / `machine/kill_ack` / `machine/event` / `machine/process_exit` / `machine/buffer_sync` / `machine/forward` / `machine/forward_ack` / `machine/unknown` | 全部 `instance/*` 同名方法 |
| ws 连接路径 `/machine` | `/instance` |

### 2.3 磁盘持久化格式

| 旧 | 新 |
| --- | --- |
| `sessions/{sid}/` 目录 | `chats/{chat_id}/` 目录 |
| `DocId::session` → `session:{sid}` | `DocId::session` → `session:{chat_id}`（控制状态 Doc） |
| `DocId::chat` → `chat:{sid}` | `chat:{chat_id}`（**前缀不变**，消息时间线 Doc） |
| updates.log doc id 字节：`0=chat, 1=session` | `0=chat, 1=session` |
| registry.log `sessions` map | `chats` map |
| registry.log `machines` map / `machine_id` 字段 | `instances` map / `instance_id` 字段 |
| `machine.token` 文件 | `instance.token` |
| `tokens.toml` 中 `role = "machine"` | `role = "instance"` |
| （无；v2.16） | `machines` 表：SSH 挂载意图；PK 仍为 `instance_id`，不是 `machine_id` |

### 2.4 工程/部署

| 旧 | 新 |
| --- | --- |
| `machine/` crate、`acp-machine` / `peri-instance` 发布二进制 | `instance/` 运行时库；由 `peri-studio connect` 启动 instance 角色 |
| `MACHINE_TOKEN_FILE` / `MACHINE_LOG` 环境变量（旧 dev.sh） | 删除；开发入口直接调用 `peri-studio local/serve/connect` 参数 |
| 数据目录 `~/.local/share/peri-studio/machine/` | `~/.local/share/peri-studio/instances/<profile>/`；本地自连接使用 `instances/local/` |
| 文档模块名 `f6-machine.md` | `f6-instance.md` |

### 2.5 单二进制迁移

| 旧 | 新 |
| --- | --- |
| `peri-studio-server` 发布二进制 | `peri-studio serve` 的 server 角色 |
| `peri-instance` 发布二进制 | `peri-studio connect <URL>` 的 instance 角色 |
| 同一机器安装两个可执行文件 | 安装一个 `peri-studio`；默认命令或 `local` 启动两个独立进程角色 |
| server 调用 instance 库的进程内快速路径 | 禁止；本地与远程一律走 `/instance` ws + HMAC |

## 3. 保持不变（session 一词的合法使用域）

以下**保留原词**——它们本就属于 ACP 会话语义，符合「session 特指 ACP 内会话」：

- ACP JSON-RPC 方法：`session/new`、`session/prompt`、`session/cancel`、`session/update`、`session/create`、`session/close`
- 心跳 `alive_sessions`（instance 上报其管理的 ACP 会话清单）
- binding 概念（`session_id → chat_id` 映射，§6.1 规则 5：acp 会话 id 只用于协议投递）
- `turn` / `entry` / `block` / `gap` / `permission` / `outbox` / `epoch` / `seq` 等既有术语

## 4. 命名约定

- `chat_id`：server 容器 UUID（原 session_id）；`chats/` 目录、`chat:` Doc 前缀
- `session_id`：ACP 进程内会话（原 acp_session_id 所指）；仅 ACP 侧代码允许
- `sessionId`（wire / Web API）：**即 ACP durable `session_id`**；Registry 投影字段 `acp_session_id` 保留兼容。`project_session_id` 仅作历史迁移术语，Hub 不再生成
- 用户偏好（`archived`、`customName`）：浏览器 IndexedDB，按 `{principalId, projectId, acpSessionId}` 隔离；读侧与 server 目录投影合并，不落 SQLite
- `instance_id`：ws 注册的 instance（原 machine_id）；`local` 为本机，SSH 挂载为 `ssh_<ulid>`
- UI 中文文案：会话列表 → **对话**列表；已 hello 的运行角色 → **实例**
- Web 英文管理页标题与页签：**Machines**（侧栏入口须带可见短标签，不是帮助图标）；
  动词为 Add computer / Connect / Disconnect tunnel / Stop agents / Remove from Peri。
  协议身份 `instance_id` 放溢出 Copy ID，不得当副标题，不得改成 `machine_id`

## 5. ACP 能力语言

| 术语 | 定义 | 避免混称 |
| --- | --- | --- |
| **ACP extension capability**（ACP 扩展能力） | client 在 `initialize.clientCapabilities._meta` 声明能够正确消费、agent 在 `agentCapabilities._meta` 回显确认的扩展 wire 契约；请求与协商成功不是同一事实 | available command、浏览器 feature flag |
| **available command**（可用命令） | agent 在会话内广播、可由用户触发的命令条目；它是运行时操作目录，不代表客户端理解某种协议扩展 | capability、extension |
| **Skill classification**（Skill 分类） | `available command` 的附加类别；`skill` 表示经 `peri.skillNames` 协商确认的 Peri 本地 Skill，`mcp_skill` 表示 MCP Skill；分类不会改变 prompt 投递语义 | extension、Skill 正文、自动执行 |
| **MCP App**（MCP 应用 UI） | 经 `PERI_MCP_APPS` 环境开关与 `peri/mcp/open|resource|app` ACP 方法暴露的 MCP 工具内联 UI；Hub 只投影 `mcp__{serverId}__{toolName}` 公开元数据，HTML 经瞬时 `mcp_app_resource` 帧穿过、不落 Chat Doc | OAuth flow、`mcp_skill` 正文、第二套 MCP-over-WS |
| **negotiated extension**（已协商扩展） | 同一个 ACP 连接上由 client 请求、agent 明确回显且 Hub 白名单支持的扩展能力 | requested extension、Hub 自己支持的能力 |
| **Agent activity**（Agent 活动） | 经 `peri.agentActivity` 双向协商、在 ACP 边界脱敏后的 Peri 独占运行摘要；是有界只读状态投影 | raw `peri.agentEvent`、聊天消息、工具输出、可执行 action |
| **Input prediction**（输入预测） | 经 `peri.prediction` 双向协商的下一条用户输入建议；Hub 只投影一个安全 placeholder，用户显式采纳后仍只是草稿 | 自动 prompt、Peri title/tag/summary action、模型输出 |
| **Replay provenance**（回放来源） | `session/load` 窗口内持久化的消息来源；`session_replay` 表示 Hub 确认来自恢复窗口，`replayVerified=true` 还要求已协商 `peri.replay` 且 producer marker 完整 | 原消息时间、当前 runtime 消息、任意未协商 `_meta` |
| **Form elicitation**（结构化追问） | agent 经标准 ACP `elicitation/create` 请求用户补充信息；Hub 只声明并消费有界 form 子集，回答是带一次性投递语义的控制动作 | 普通聊天消息、permission、任意 JSON Schema renderer、Peri `_meta` extension |
| **Session config catalog**（会话配置目录） | agent 通过标准 ACP `configOptions` 提供的当前 option/value 权威目录；Hub 只允许按目录执行 `session/set_config_option` | ACP extension capability、Hub 本地 model allowlist、Peri 配置文件编辑 |

命名约束：Control Doc 中 ACP 协商结果使用 `agent.extensions`；命令目录使用
`agent.available_commands`，结构化目录使用 `agent.command_catalog`。历史
`agent.capabilities` 只作为兼容投影，不再承载新增协议事实。

# MCP Apps 对接计划

> 状态：实现计划（调研见 [research/mcp-apps.md](../research/mcp-apps.md)；落地经验与 e2e 踩坑见 [mcp-apps-host.md](./mcp-apps-host.md)）
> 日期：2026-08-30
> Peri 契约：[`KonghaYao/peri` spec/issues/2026-08-27-mcp-apps-stdio-relay.md](https://github.com/KonghaYao/peri/blob/main/spec/issues/2026-08-27-mcp-apps-stdio-relay.md)、e2e [`side-projects/mcp-apps/check-peri.ts`](https://github.com/KonghaYao/peri/blob/main/side-projects/mcp-apps/check-peri.ts)
> 规范：MCP Apps `2026-01-26`（`io.modelcontextprotocol/ui`）

本文是 peri-studio 的落地计划。Peri 已经实现 stdio 中继；Studio 负责 spawn 开关、ACP 转发、瞬时 HTML、双 iframe Host。不在浏览器里重建 MCP 连接。

## 1. 目标与非目标

**目标：** 当 Peri 调用带 UI 的 MCP 工具并完成时，当前对话的工具卡内渲染 inline MCP App；用户在 App 里的按钮通过 Peri 的 `tools/call` 闸门回到同一 MCP server。未启用、lease 失败、刷新、回放时退回现有 ToolCallCard。

**非目标（首期不做）：**

- ACP `peri.mcpApps` 能力协商（Peri 已删除）
- 浏览器直连 MCP / 第二条 MCP-over-WS
- HTML / `structuredContent` 写入 Yjs 或 SQLite
- 回放、rewind、server 重启后复活 live iframe
- App 内任意 `resources/read`、fullscreen / pip、相机麦克风
- `ui/update-model-context` 写入模型（Peri 无对应 RPC）
- 把 Apps 塞进 `McpPanel`

## 2. 已钉死的 Peri 契约

| 项 | 事实 |
|----|------|
| 开关 | spawn 环境存在 `PERI_MCP_APPS`（值不解析，空串也启用）；不存在则 `peri/mcp/*` → `capability_disabled` |
| 能力协商 | **没有** `clientCapabilities._meta.peri.mcpApps` |
| 方法 | `peri/mcp/open`、`peri/mcp/resource`、`peri/mcp/app` |
| 版本 | `envelopeVersion: "1"`，`appsProtocolVersion: "2026-01-26"` |
| `invocationToken` | ACP `toolCallId`（模型 id 原样保留） |
| `ownerSessionId` | ACP `sessionId` |
| `serverId` / `toolName` | 从工具 title `mcp__{serverId}__{toolName}` 拆出；open 用本地 `toolName`，不是 `mcp__…` |
| 时机 | 等该 tool_call **completed** 再 open（lease 在成功的 initial invocation 上签发；`isError: true` 不签发） |
| `peri/mcp/app` | 只允许 `payload.method == "tools/call"` |
| 新 turn | `session/prompt` 会 `begin_session_turn`，旧 lease / app session 全部作废 |

Hub **不要**把 raw `_meta` 灌进 Chat Doc。open 所需字段已经在现有投影里：`toolCallId`、工具名/title、当前 binding 的 ACP session id。

## 3. 拓扑

```
浏览器（双 iframe Host）
    │  action: mcp/app-open | mcp/app-resource | mcp/app-call
    │  下行瞬时帧: mcp_app_session / mcp_app_resource（类 oauth，不进 Yjs）
    ▼
Hub
    │  peri/mcp/open | peri/mcp/resource | peri/mcp/app
    ▼
instance（dumb 转发；HTML 响应不得进 ring/buffer）
    ▼
Peri acp（PERI_MCP_APPS 已注入）──MCP──► MCP Server
```

## 4. 模块职责

| 模块 | 职责 | 不做什么 |
|------|------|----------|
| instance spawn | 默认把 `PERI_MCP_APPS=` 写入子进程 env，并允许该键通过白名单 | 不解析值；运维可用空 allowlist 覆盖关掉 |
| `McpAppsControl`（新建，并列 `McpControl`） | 转发三条 RPC、内存 app session、瞬时 HTML、command 去重 | 不写 Chat Doc HTML；不替代 OAuth |
| ACPChannel | 识别 `mcp__` effective 名，投影有界 `mcp_server_id` / `mcp_tool_name` | 不保留 raw `_meta`、不嵌入 HTML |
| Chat Doc | 工具卡上可选公开字段：server/tool 名、是否曾成功 open | 不存 token、HTML、CSP、structuredContent |
| Web `lib/mcp-apps.ts` | 查询表、瞬时帧、sandbox 生命周期 | 不 import 完整 MCP SDK Client 去连 server |
| `McpAppFrame` | 双 iframe + App Bridge 消息；`size-changed` 回写高度 | 不放进 `McpPanel` |

OAuth 仍由 `McpControl` 独占。Apps 是另一次工具调用的 UI，不是连接面板。

## 5. 协议面（Studio ↔ Hub）

沿用查询类 action：action/ack 带 `commandId`，数据经专用下行帧回投。

### 5.1 Action

| type | payload | 对应 ACP |
|------|---------|----------|
| `mcp/app-open` | `{ chatId, toolCallId }` | `peri/mcp/open`。Hub 从投影解析 server/tool，注入 ACP `sessionId` 与 `toolCallId` |
| `mcp/app-resource` | `{ chatId, appSessionId }` | `peri/mcp/resource` |
| `mcp/app-call` | `{ chatId, appSessionId, payload }` | `peri/mcp/app`；`payload` 必须是 `tools/call` JSON-RPC |

浏览器不准自己拼 `invocationToken` / `ownerSessionId`。只读角色拒绝 open 与 call。

### 5.2 下行帧

| tag | 内容 | 落盘 |
|-----|------|------|
| `mcp_app_session` | `{ commandId, chatId, toolCallId, appSessionId, serverId, resourceUri }` | 否。Hub 可把 `appSessionId`/`resourceUri` 有界写入对应 tool_call 公开字段 |
| `mcp_app_resource` | `{ commandId, chatId, appSessionId, html, mimeType, csp?, toolResult? }` | **否**。对标 `mcp_oauth_authorization`。`toolResult` 是首屏 CallToolResult（可嵌套 `structuredContent`）；Chat Doc 4KB 预算不够 canvas TSX |

HTML 上限建议 1 MiB（instance 单行 4 MiB，Hub 再收紧）。超限公开错误，不截断渲染。

### 5.3 错误

把 Peri `data.kind` 收敛为稳定公开码：`capability_disabled`、`policy_denied`、`stale_session`、`unsupported`、`agent_unavailable`。不把 HTML、参数、MCP 正文写入日志或 `action_error.message`。

`policy_denied` / `tool_not_app_visible` 对用户就是普通工具卡，不要当故障 toast。

## 6. 运行时行为

### 6.1 发现

工具 **completed** 且 title/name 匹配 `mcp__{serverId}__{rest}`（`serverId` 不含 `__`，其余为 MCP `toolName`）时，Web 对当前 chat 发 `mcp/app-open`。

- 成功 → `mcp/app-resource` → 渲染
- `policy_denied` / `tool_not_app_visible` / `capability_disabled` → 保持 ToolCallCard
- 未 completed、`isError`、replay 条目 → 不 open

不要对每个 MCP 工具在 running 时抢 open：lease 在成功的 initial call 之后才存在。

### 6.2 沙箱（规范强制）

Web Host 必须双 iframe、Host 与 Sandbox **不同 origin**：

- 面板：现有 `PERI_STUDIO_LISTEN_ADDR:PORT`（如 `127.0.0.1:8456`）
- Sandbox：loopback 第二端口提供静态 `sandbox.html`（建议 `LISTEN_PORT+1` 或 `PERI_STUDIO_SANDBOX_PORT`），不挂认证 Cookie、不挂业务 API
- 内层：`allow-scripts allow-same-origin`；CSP 由资源 `_meta.ui.csp` 生成，缺省用规范 restrictive default
- 权限：默认不给 camera / microphone / geolocation

实现用 `@modelcontextprotocol/ext-apps` 的 App Bridge（与 Peri `side-projects/mcp-apps`、本地 `mcp-app` demo 同源）。不要引入 React `@mcp-ui/client`。

`ui/initialize`、theme、`tool-input` / `tool-result`、`size-changed` 在浏览器完成。`tools/call` 经 `mcp/app-call` 回 Hub。`ui/open-link` 只允许 `https:`。`ui/message` 首期可映射为一次普通 `chat/prompt`（仍走 PromptDelivery）。`ui/update-model-context` 首期忽略或只做本地展示。

### 6.3 生命周期

拆 iframe 并丢 Hub 内存 session：下一条 `chat/prompt`、cancel、chat close、runtime 终态、选中 chat 切换、只读刷新。

刷新页面：工具卡还在，live App 不在（token/HTML 未落盘）。回放条目禁止 open。

### 6.4 spawn 开关

instance `env_clear()` 后只继承 PATH/HOME/LANG/SHELL。**必须由 Hub 在 `instance/spawn.env` 显式注入 `PERI_MCP_APPS`（空值即可）**，并把该键加入 spawn 白名单基集或固定增补，否则 Peri 永远 `capability_disabled`。

允许配置关闭：spawn 不带该键即 fail closed，现有 MCP list/OAuth 不受影响。

HTML 是瞬时、不可信代码。`peri/mcp/resource` 的响应不得进入 instance ring / 断线 buffer（扩展 `SensitiveEphemeral`：识别 oversized / html 正文，或 Apps RPC 的 result 不走 replayable 路径）。Hub 对标 OAuth：只在线穿过，短 TTL 内存，用户当前页消费。

## 7. 分步落地

每步可独立合并、独立回滚。未完成第 3 步前，用户看到的仍是今天的工具卡。

### P0 — 开关与探测（无 UI）

1. spawn 注入 `PERI_MCP_APPS=`；白名单双端一致。
2. 从 tool title 解析 `mcp__server__tool`；投影有界 `mcp_server_id` / `mcp_tool_name`（缺省保持现状）。
3. 契约：无 env → `peri/mcp/open` 为 `capability_disabled`；有 env 且 completed MCP 工具可 open（用 Peri `side-projects/mcp-apps` fixture 或本地 `mcp-app` server）。

### P1 — 瞬时中继

1. 新模块 `McpAppsControl`：open / resource / call。
2. proto：三个 action + 两帧；whitelist；instance 敏感瞬时分类。
3. open 失败且未证明未消费 lease → `DELIVERY_UNKNOWN`，禁止用新 commandId 自动重放。
4. Web 只打通帧路由与查询表，iframe 仍不渲染。

### P2 — 沙箱 Host

1. 第二 origin 的 `sandbox.html`。
2. `McpAppFrame`：initialize → tool-input → tool-result；`size-changed` 限制 maxHeight，避免撑破 `TranscriptWindow`。
3. 金丝雀：本地 `mcp-app` 的 `get_dashboard`。
4. 浏览器端到端：主路径 + 空/错误/只读。

### P3 — 反向 tools/call 与权限

1. `mcp/app-call` → `peri/mcp/app`。
2. App 内危险工具走现有 `pending_permissions`，不另做一套。
3. app-only 工具不进 slash catalog（Peri 本来就不给模型）。
4. 新 turn / close 拆 iframe；再点按钮必须失败而不是打到新 generation。

### P4 — 文档与收口

1. `docs/architecture.md` 增补：Apps 瞬时通道、spawn `PERI_MCP_APPS`、禁止 HTML 进 Chat Doc。
2. `docs/terminology.md` 如需区分 MCP App / MCP skill。
3. 研究稿 §4.4 以本文为准。

## 8. 测试

| 层 | 覆盖 |
|----|------|
| proto | 新 action/帧形状、whitelist |
| server | 名称解析、open 去重、跨 chat 丢弃、未 completed 拒绝、HTML 超限、capability_disabled |
| instance | Apps 响应不进 ring；spawn 带/不带 `PERI_MCP_APPS` |
| web unit | 帧路由、查询表、只读门禁、size-changed |
| browser | fixture App 渲染、按钮 `tools/call`、刷新后无 iframe、普通 MCP 工具无 iframe |

金丝雀优先用 Peri 仓库 `side-projects/mcp-apps`（stdio fixture）+ 本地 `/Users/mino/code/mcp-app`（完整 UI）。

## 9. 风险

| 风险 | 处理 |
|------|------|
| `serverId` 含 `__` 导致名称拆错 | 约定 mcp.json 键不含 `__`；拆分失败则当普通工具 |
| HTML 很大 / 含脚本 | 1 MiB 上限 + CSP + 异源沙箱；日志不记正文 |
| lease 5 分钟 TTL vs 用户慢操作 | 超时后拆 iframe，工具卡回退；不静默重 open |
| 多面板同时 open 同一 toolCallId | Peri lease 单次消费；第二者 `policy_denied`，只保留一个 live Host |
| 远程 TLS 下第二 origin | 首期 loopback 第二端口；远程 sandbox origin 单列后续 |

## 10. 建议开工顺序

先 P0（不碰 UI），用 Peri fixture 证明 Studio spawn 的 agent 能 `open`。通过后再 P1/P2。P0 失败则停在 spawn env / 名称解析，不要先做 iframe。

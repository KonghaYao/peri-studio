# Peri Studio 对接 MCP Apps 研究报告

> 状态：调研稿，供实现前过目。不是架构裁决，不修改 `docs/architecture.md`。落地后的线契约与踩坑以 [design/mcp-apps-host.md](../design/mcp-apps-host.md) 为准。
> 调研日期：2026-08-30。
> 规范基线：MCP Apps `2026-01-26`（SEP-1865，扩展标识 `io.modelcontextprotocol/ui`）。
> Peri 基线：本机已安装 `peri` 二进制 + GitHub `KonghaYao/peri` 的 `peri-acp` / `peri-middlewares` / `peri-acp-types` 源码。
> 本地可运行参考：`/Users/mino/code/mcp-app`（官方 basic-host 形态的销售仪表盘 demo）。

## 1. 结论摘要

1. MCP Apps 让 MCP **server** 用 `_meta.ui.resourceUri` 把工具绑到 `ui://` HTML 资源；**Host** 在沙箱 iframe 里渲染，并用 JSON-RPC over `postMessage` 与 View 双向通信。
2. Peri Studio **不能**按规范里的 Host 角色直连 MCP server。浏览器不是 MCP client；MCP 连接只存在于 Peri agent 进程内。
3. Peri 已经做完特殊处理：Agent 当 MCP client 与闸门，ACP 客户端只走三条受控 RPC——`peri/mcp/open`、`peri/mcp/resource`、`peri/mcp/app`。前端拿不到完整 MCP 连接，也调不到 `visibility: ["model"]` 的工具。
4. peri-studio 当前 MCP 面只有 `mcp/list` 与 `peri.oauth`。initialize 未声明 Apps 能力，tool_call 规范化会丢掉 `_meta`，Chat Doc 4KB 预算也装不下 HTML。按现有路径，MCP App 最多变成一张普通工具卡。
5. 正确接法是：**Hub 声明能力 → 从 ACP tool_call 白名单 meta 发现 App → 用 Peri 中继取 HTML / 代理 `tools/call` → Web 做双 iframe 沙箱 Host**。HTML、CSP、invocation token 走 OAuth 同款瞬时通道，禁止写入 Yjs / SQLite / ring / 日志。
6. 首期只做 **inline 渲染 + `tools/call` 代理 + 文本回退**。`ui/update-model-context`、任意 `resources/read`、fullscreen/pip、相机麦克风都应后置；历史回放不得复活 live iframe。

## 2. MCP Apps 规范在说什么

权威文本：[SEP-1865 / ext-apps specification 2026-01-26](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)。扩展标识 `io.modelcontextprotocol/ui`。可选、需能力协商。

### 2.1 三个角色

| 角色 | 职责 |
|------|------|
| **MCP Server** | 注册工具与 `ui://` 资源；工具结果可带 `structuredContent` |
| **Host** | MCP client + 对话 UI。拉 HTML、建沙箱、代理 View 的 JSON-RPC |
| **View** | 沙箱 iframe 里的 HTML/JS，用 `App` / postMessage 与 Host 通信 |

规范默认 **Host 就是 MCP client**。Claude Desktop、VS Code Copilot 都是这个拓扑。Peri Studio 不是。

### 2.2 发现与数据链接

工具与 UI 是两段式绑定，靠同一个 `ui://` URI：

```json
{
  "name": "get_dashboard",
  "_meta": {
    "ui": {
      "resourceUri": "ui://dashboard/app.html",
      "visibility": ["model", "app"]
    }
  }
}
```

- MIME 必须是 `text/html;profile=mcp-app`。
- Host 用 `resources/read` 取 HTML；可预取、可缓存模板。
- 工具结果里的 **`structuredContent` 给 UI**，`content` 给模型。二者不要混用。
- `visibility` 默认 `["model","app"]`。`["app"]` 对模型隐藏，只允许 View 调。`["model"]` 禁止 View 调。

### 2.3 View ↔ Host 协议（JSON-RPC 2.0 / postMessage）

View 像一个窄 MCP client。Web Host **必须**用双 iframe：Host 与 Sandbox 不同 origin；Sandbox 权限 `allow-scripts` + `allow-same-origin`；HTML 经 `ui/notifications/sandbox-resource-ready` 注入并强制 CSP。

| 方向 | 方法 | 含义 |
|------|------|------|
| View→Host | `ui/initialize` | 握手，声明 `appCapabilities` |
| View→Host | `tools/call` | 反向调同一 MCP server 的工具 |
| View→Host | `resources/read` | 读资源 |
| View→Host | `ui/message` | 往对话塞一条用户消息 |
| View→Host | `ui/update-model-context` | 覆盖后续 turn 的模型上下文 |
| View→Host | `ui/open-link` | 让 Host 打开外链 |
| View→Host | `ui/request-display-mode` | inline / fullscreen / pip |
| Host→View | `ui/notifications/tool-input` | 完整工具入参（最多一次，且必须在 tool-result 之前） |
| Host→View | `ui/notifications/tool-result` | `CallToolResult` |
| Host→View | `ui/notifications/host-context-changed` | 主题、尺寸、displayMode |
| View→Host | `ui/notifications/size-changed` | 自适应高度 |

CSP 默认极严：`connect-src 'none'`，未声明的外部域一律禁止。Host 可以再收紧，不能放宽。

### 2.4 安全模型（规范层）

- 预声明模板，Host 可在渲染前审查 HTML。
- 沙箱隔离 DOM / cookie / storage。
- 全部通信可审计。
- UI 发起的 `tools/call` 可由 Host 再要一次用户同意。
- `visibility` **不是**安全边界：绕过 UI 直发 `tools/call` 就能穿透。真正的闸门必须在 Host 或更内层。

## 3. 为什么 Peri 必须特殊处理

```
规范默认：
  Host（聊天客户端 = MCP client）──MCP──► MCP Server
  Host 自己 tools/list、resources/read、tools/call，自己渲染 iframe

Peri 实际：
  浏览器 ──peri-studio 协议──► Hub ──ACP──► instance ──stdio──► Peri agent ──MCP──► MCP Server
```

如果让浏览器当 MCP Host：

- 浏览器没有 stdio，stdio MCP 必须在 agent 侧 spawn。
- 浏览器一旦拿到完整 MCP 连接，就能读任意资源、调 model-only 工具，多租户隔离被绕过。
- peri-studio 的事实源是 Yjs 投影，不是 MCP 会话。HTML / token / 原始工具结果不能进 Chat Doc。

因此：**Peri agent 继续当唯一 MCP client；Studio 只当 ACP Host + iframe 渲染器。** 这与 `mcp-app/ARCHITECTURE.md` 的「双通道数据分路」一致：模型吃 `content` + 全量工具；UI 只吃 HTML + `structuredContent` + app-visible 工具结果。

## 4. Peri 已经实现的 ACP 中继

源码：

- `peri-acp/src/host/mcp_apps.rs` — ACP 方法入口
- `peri-middlewares/src/mcp/apps.rs` — lease / capability profile
- `peri-middlewares/src/mcp/apps_relay.rs` — 连 MCP pool、消费 lease、代理调用
- `peri-acp-types/src/mcp_apps.rs` — 稳定 envelope

开关：环境变量 `PERI_MCP_APPS`；连接默认 **fail closed**，`apps_enabled` 为 false 时三条 RPC 都返回 `capability_disabled`。协议版本：`envelopeVersion = "1"`，`appsProtocolVersion = "2026-01-26"`。

### 4.1 三条 ACP 方法

客户端请求 **禁止** 带 `mcpProtocolVersion`（只出现在响应里）。未知字段 `deny_unknown_fields`。

#### `peri/mcp/open`

用一次性 `invocationToken` 把「模型刚调过的 UI 工具」换成一个 `appSessionId`。

请求：`envelopeVersion`、`appsProtocolVersion`、`serverId`、`toolName`、`ownerSessionId`、`invocationToken`。

响应：再加上 `mcpProtocolVersion`、`appSessionId`、`resourceUri`。

闸门：

- 工具必须存在且 `visibility.app == true`，否则 `tool_not_app_visible`。
- 工具必须有 `ui://` `resourceUri`。
- **lease 一次性 consume**：token、session、当前 turn、server generation、resource URI 必须同时命中，否则 `policy_denied`。
- `appSessionId` 绑在 **本 ACP 连接** 上，换连接不能复用。

#### `peri/mcp/resource`

按 binding 读 UI HTML。返回 `resources[]`，每条必须：

- `uri` 等于请求的 `ui://…`
- `mimeType == text/html;profile=mcp-app`
- `text` 与 `blob` 二选一

`_meta.ui`（CSP / permissions / prefersBorder）原样保留，供 Host 建 CSP。

#### `peri/mcp/app`

目前 **只转发 `tools/call`**，其它 method 直接 `unsupported_method`。

- `params.name` 必须落在该 lease 的 `allowedTools` 白名单。
- 经 Peri `EffectiveToolDispatcher` 执行，走既有权限 / HITL，不直连 MCP peer。
- MCP `isError: true` 仍是协议成功（把 raw `CallToolResult` 还给 View）。
- 取消、用户拒绝分别映射 `cancelled` / `policy_denied`。

### 4.2 Lease 生命周期（Peri 真正的特殊处理）

| 约束 | 值 / 行为 |
|------|-----------|
| 签发时机 | 模型调用带 UI 的工具时 `issue()` |
| TTL | lease 300s；raw `CallToolResult` 缓存 120s |
| 容量 | pending lease ≤ 1024；raw result ≤ 1024 |
| 新 turn | `begin_session_turn` **撤销该 session 全部 lease 与 app session** |
| 关连接 / 关 session | 取消 in-flight，清 raw result |
| 工具白名单 | lease 上的 `allowedTools: HashMap<appName, effectiveName>`，跨 server 调用被挡住 |
| server 世代 | MCP 重连后 generation 变，旧 binding → `stale_server_generation` |

这就是「中间层分流闸门」的落地：UI 不能枚举工具、不能读任意资源、不能跨 turn 复活旧 App。

### 4.3 错误码（ACP `-32000` + `data.kind`）

`unsupported_envelope_version` / `unsupported_apps_version` / `capability_disabled` / `unknown_server` / `server_disconnected` / `stale_server_generation` / `invalid_session` / `tool_not_found` / `tool_not_app_visible` / `resource_not_found` / `invalid_resource` / `policy_denied` / `cancelled` / `unsupported_method` / `upstream_protocol_error` / `forbidden`

Hub 应对 Web 收敛为稳定、非敏感的公开错误，不要原样把 MCP 正文送进浏览器。

### 4.4 已从 Peri 源码钉死的契约

权威说明：`KonghaYao/peri` 的 [`spec/issues/2026-08-27-mcp-apps-stdio-relay.md`](https://github.com/KonghaYao/peri/blob/main/spec/issues/2026-08-27-mcp-apps-stdio-relay.md) 与 e2e [`side-projects/mcp-apps/check-peri.ts`](https://github.com/KonghaYao/peri/blob/main/side-projects/mcp-apps/check-peri.ts)。

1. **没有 ACP `peri.mcpApps` 能力。** Peri 已删除该 key 的解析、协商和回显。开关只看进程环境变量 `PERI_MCP_APPS` **是否存在**（空串也算启用）。Hub 不要在 `initialize._meta` 里声明假扩展。
2. **`invocationToken` 就是 ACP `toolCallId`。** Peri 保证模型 tool call id 原样出现在 `session/update` 的 `toolCallId` 上。e2e 在工具 `completed` 之后，用该 id 调 `peri/mcp/open`。
3. **`toolName` 是 MCP 本地名，不是 effective 名。** ACP 卡片 title 是 `mcp__{serverId}__{toolName}`（例如 `mcp__official-apps-fixture__get-time`）；open 的 `toolName` 是 `get-time`，`serverId` 是 mcp.json 键。
4. **`ownerSessionId` 是 ACP `sessionId`，不是 `chat_id`。**
5. **stdio 装配还要求 `stdio_command_filter`。** `ConnectionContext::apps_enabled` = `stdio_command_filter && mcp_apps_relay.is_some()`。Studio 走 `peri acp` stdio，只要 spawn 带上 `PERI_MCP_APPS` 就会装 relay。

## 5. peri-studio 现状

| 层 | 已有 | 对 MCP Apps 的缺口 |
|----|------|-------------------|
| ACP initialize | 8 个 `peri.*` bool 扩展 | 未声明 Apps，Peri 不会开中继 |
| 出站 RPC | `mcp/list`、`mcp/oauth_*` | 没有 `peri/mcp/open\|resource\|app` |
| 入站 tool_call | 名称 / kind / arguments / content / result，4KB 截断 | 丢掉 `_meta`；HTML 必被 `omitted` |
| Chat Doc | Resource 只存引用 | 没有 app session / resourceUri / structuredContent 投影 |
| 瞬时通道 | `peri/oauth`：不进 Yjs、SQLite、ring、日志 | HTML / token 应走同类通道，但尚未分类 |
| Web | `McpPanel` 管连接与 OAuth；工具卡纯文本 | 无沙箱、无 AppBridge、无 iframe |
| 权限 | `permission/resolve` + 输入证据白名单 | App 内 `tools/call` 仍应走同一权限面 |
| 回放 | `peri.replay` 重建 transcript | lease 已死，回放不能当 live App |

现有 MCP 面（列表、OAuth、slash 里的 `mcp_skill`）与 Apps **正交**：前者管连接生命周期，后者管某次工具调用的 UI。不要塞进 `McpPanel`。

## 6. 推荐的 peri-studio 接法

### 6.1 分层

```
MCP Server
    ▲  MCP（仅 Peri 可见）
Peri agent（闸门：visibility / lease / allowedTools / HITL）
    ▲  peri/mcp/open|resource|app
Hub（能力协商、白名单 meta、瞬时 HTML、command 去重）
    ▲  新 action + 瞬时下行帧（类 oauth）
Web（双 iframe Host：CSP、postMessage、theme、权限卡）
```

浏览器 **禁止** 新建一条「MCP JSON-RPC WebSocket」直达 agent。那会拆掉 Peri 的物理隔离。

### 6.2 数据放哪

| 数据 | 位置 | 原因 |
|------|------|------|
| `serverId` / `toolName` / `resourceUri` / `appSessionId` | Chat Doc 工具卡上的有界公开字段 | 刷新后还知道「这里曾经是一个 App」 |
| `invocationToken` | 内存，open 成功即丢 | 一次性秘密，对标 OAuth URL |
| HTML / CSP / blob | 瞬时下行，不落盘 | 不可信代码 + 体积远超 4KB |
| `structuredContent` | 瞬时推给 iframe；Chat Doc 最多存有界摘要 | 给 UI 的数据，不是对话正文 |
| live `appSessionId` | Hub 内存，随 chat/runtime 销毁 | 绑定 ACP 连接，重启必失效 |

历史消息只保留「这是 MCP App，文本回退如下」；打开新页或新 turn 都不复活 iframe。这与 Peri「新 turn 撤销 lease」一致。

### 6.3 一次成功路径

1. Hub 在 `initialize` 声明 Apps 能力，且仅在 agent 精确回显后视为 negotiated（与 `peri.oauth` 同一纪律）。
2. Peri 调带 UI 的工具，签发 lease，并在 tool_call 上给出 open 所需白名单字段。
3. Hub 投影工具卡（不含 HTML / token），token 进内存。
4. Web 对当前 chat 发 `mcp/app-open`（名称待定）。
5. Hub 转发 `peri/mcp/open` → `peri/mcp/resource`，HTML 瞬时回投。
6. Web 起 **异源** sandbox iframe，注入 HTML，完成 `ui/initialize`。
7. Host 推 `tool-input` 再推 `tool-result`（`structuredContent` 来自本次工具结果或 resource 后的 raw result 缓存）。
8. 用户在 App 里点按钮 → View `tools/call` → Hub `peri/mcp/app` → Peri dispatcher（可弹权限）→ raw result 回 iframe。
9. 下一条 prompt / rewind / runtime 终态：Hub 丢掉该 chat 的 app session；Web 拆 iframe，工具卡留文本回退。

`ui/message` 首期可映射为一次普通 `chat/prompt`（仍走 PromptDelivery 去重）。`ui/open-link` 只允许 https，本机打开。`ui/update-model-context` 在 Peri 未提供对应 RPC 前不要假装已写入模型——可先做「仅展示，下一条用户消息可附带」或明确标未实现。

### 6.4 Web 沙箱

peri-studio 是 Web Host，规范强制双 iframe：

- Host 页：现有面板 origin（如 `http://127.0.0.1:8456`）。
- Sandbox 页：**另一个 origin**（第二端口、或明确的 sandbox host），不能和面板同 origin。
- 内层 iframe：`allow-scripts` + `allow-same-origin`；CSP 由资源 `_meta.ui.csp` 生成，缺省用规范 restrictive default。
- 权限：默认不给 camera / microphone / geolocation；`clipboard-write` 若要开也必须用户可见。

实现上优先 `@modelcontextprotocol/ext-apps` 的 App Bridge（与 `mcp-app` demo 相同）。不要引入 React 的 `@mcp-ui/client`。

工具卡：有 live session 时在卡片内嵌 inline iframe；否则展示既有 `ToolCallActivity`（`@peri/ui` `ToolActivityRow`）+ 文本/结构化摘要。不要让 iframe 撑破 `TranscriptWindow` 的高度测量——必须订阅 `size-changed` 并设 `maxHeight`。

### 6.5 与现有纪律对齐

- **副作用去重**：open / app-call 是副作用。同 `commandId` 不得二次 consume lease。open 失败且未证明未消费时走 `DELIVERY_UNKNOWN`，禁止自动重放。
- **瞬时帧**：HTML 与 token 按 `peri/oauth` 同类，instance 不得写入 ring / buffer。
- **日志**：禁止 HTML、token、structuredContent 原文。
- **只读角色**：可看回退文本，不可 open、不可从 App 调工具。
- **多租户**：`appSessionId` 必须绑 `chat_id` + 当前 principal；跨 chat 帧丢弃。

## 7. 明确不做（首期）

- 浏览器直连 MCP，或再开一条 MCP-over-WS。
- 把 HTML / `structuredContent` 写入 Chat Doc 或 SQLite。
- 回放、rewind、server 重启后复活 live App。
- App 内任意 `resources/read`（Peri 的 resource RPC 只服务 binding 上的那一个 `ui://`）。
- fullscreen / pip、相机麦克风、预取全部 `ui://` 模板。
- 把 Apps 塞进 `McpPanel`。
- 未协商时静默开启；agent 未回显则整条能力保持关闭。

## 8. 建议落地顺序

在能力键与 tool_call `_meta` 形状与 Peri 对过之后：

1. **协议探测**：initialize 声明 + 回显；normalizer 白名单抽取 `serverId` / `resourceUri` / `invocationToken` 等；无字段则保持普通工具卡。
2. **瞬时中继**：Hub 转发 open / resource；Web 能拿到 HTML 但不渲染。契约测试覆盖 lease 失败、未协商、跨 chat。
3. **沙箱 Host**：双 iframe、CSP、`ui/initialize`、tool-input / tool-result；用本地 `mcp-app` demo 做金丝雀。
4. **反向 `tools/call`**：`peri/mcp/app` + 现有 permission 队列；app-only 工具不进 slash catalog。
5. **生命周期**：新 turn / cancel / chat close / runtime 终态拆 iframe；回放只显示回退。

每一步都应能独立合并、独立回滚。未完成 3 之前，用户看到的仍是今天的工具卡，行为不回归。

## 9. 验收场景（过目用，不是测试计划正文）

- 未声明能力：Peri 不签发 Apps 行为；Studio 无 iframe。
- `get_dashboard` 类工具：对话里出现 inline 仪表盘，`structuredContent` 驱动图表，模型侧仍是文本。
- App 内筛选 / 写操作：只打 app-visible 工具；model-only 被 Peri 拒（`tool_not_app_visible` / `forbidden`）。
- 权限：App 内危险工具弹出与普通 tool_call 同一套权限卡。
- 下一条用户消息：旧 iframe 拆掉，lease 失效，再点按钮应失败而不是打到新 MCP 世代。
- 刷新页面：工具卡还在，live App 不在。
- OAuth 未完成的 MCP server：Apps 不可用，现有 OAuth 面板不受影响。

## 10. 参考

- 规范：<https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx>
- 博客：<https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/>
- 官方 Host 示例：<https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host>
- 本地 demo：`/Users/mino/code/mcp-app`（`ARCHITECTURE.md` 记录了 Peri 侧分路原则）
- Peri：`peri-acp/src/host/mcp_apps.rs`、`peri-middlewares/src/mcp/apps.rs`、`peri-acp-types/src/mcp_apps.rs`
- peri-studio 对照：`docs/architecture.md` §6.2 `peri.oauth`、Chat Doc Resource「只存引用」、tool 字段 4KB 预算

# MCP Apps Host 落地经验

> 状态：首期已接通并经本机 e2e 纠偏（2026-08-30）
> 调研：[research/mcp-apps.md](../research/mcp-apps.md)
> Peri 类型源：[`peri-acp-types/src/mcp_apps.rs`](https://github.com/KonghaYao/peri/blob/main/peri-acp-types/src/mcp_apps.rs)
> Peri e2e：[`side-projects/mcp-apps/check-peri.ts`](https://github.com/KonghaYao/peri/blob/main/side-projects/mcp-apps/check-peri.ts)
> App Bridge 类型：[`ext-apps/src/spec.types.ts`](https://github.com/modelcontextprotocol/ext-apps/blob/main/src/spec.types.ts)（`McpUiInitializeResult`）

本文记录 peri-studio 作为 **ACP Host + 双 iframe 渲染器** 的真实接法、线契约，以及本机金丝雀里拦过 iframe 的坑。计划文档仍然描述「该做什么」；这里描述「做完之后以哪份 Peri / App Bridge 形状为准」。

## 1. 不要再走错的拓扑

Studio **不是** MCP client。浏览器不能 `tools/list` / `resources/read` 直连 MCP server。

```
浏览器（双 iframe Host）
    │  action: mcp/app-open | mcp/app-resource | mcp/app-call | mcp/app-invoke
    │  下行瞬时帧: mcp_app_session / mcp_app_resource / mcp_app_call_result / mcp_app_invoke
    ▼
Hub（McpAppsControl）
    │  peri/mcp/open | peri/mcp/resource | peri/mcp/app | peri/mcp/invoke（Peri 待实现）
    ▼
instance（dumb 转发；Apps HTML 不得进 ring）
    ▼
Peri acp（spawn 必须带 PERI_MCP_APPS=）──MCP──► MCP Server
```

- 开关只看环境变量 **是否存在**（空串也启用）。**没有** `peri.mcpApps` initialize 能力。
- `invocationToken` = ACP `toolCallId`；`ownerSessionId` = ACP `sessionId`。浏览器不准自己拼这两项。
- 工具卡片 title 常见为 `mcp__{serverId}__{toolName}`；**Cursor extra-tool** 会把 ACP `title` 写成 `execute extra tool \`mcp__{serverId}__{toolName}\``。Hub / Web 必须从包装 title 里取出 effective 名。open 用本地 `toolName`（如 `get-time` / `show_canvas`），不是 `mcp__…`。
- 只在 tool **completed** 且非 `isError`、非 replay 时 open。lease 是一次性的；新 `session/prompt` 会 `begin_session_turn` 作废全部 app session。

## 2. 实现地图

| 层 | 位置 |
|----|------|
| spawn 注入 `PERI_MCP_APPS=` | `server/src/channel/spawn_env.rs`；白名单双端 `PERI_MCP_APPS` |
| 名称解析 | `server/src/protocol/mcp_name.rs` → 投影 `mcp_server_id` / `mcp_tool_name` |
| Hub 中继 | `server/src/channel/mcp_apps_control.rs` + `_rpc.rs` |
| 协议 | `proto/src/mcp_apps.rs`；帧 `mcp_app_session` / `mcp_app_resource` / `mcp_app_call_result` |
| 敏感瞬时 | `instance/src/hub/forward.rs`：`peri/mcp/*` + mcp-app MIME / `ui://` |
| 沙箱 origin | `server/src/web/sandbox.rs`，默认 `LISTEN_PORT+1` 或 `PERI_STUDIO_SANDBOX_PORT` |
| 面板 CSP | `server/src/web/http.rs` `panel_csp()`：`frame-src` 精确沙箱 origin；`img-src 'self'`（CSS `url()` 走此指令，磨砂颗粒为同源 `/images/sidebar-frost-grain.svg`，禁止 `data:`） |
| Web 装配 | `web/src/features/mcp/mcp-apps.ts`（协议/live session）、`features/mcp/mcp-app-display.ts`（历史占位判定）、`widgets/chat/McpAppFrame.tsx`（T4 接线）、`@peri/ui` `mcp-app`（`McpAppFrameShell` + `McpAppHistoricalCard` + `bindMcpAppHost`）、`web/sandbox.html` |
| 工具卡入口 | `ConversationMessage` 的 `McpToolBlock`：有 live HTML 才换 iframe；已完成且无 live HTML（replay 或 live open 失败/未跑）换 `McpAppHistoricalCard`（含 **Reopen app**） |
| Host 重开 | 用户点 **Reopen app** → `mcp/app-invoke` → Peri `peri/mcp/invoke`（新 `tools/call` + 新 lease）；成功后 live 工具卡走现有 `mcp/app-open` 自动 open |

HTML / token / CSP **不进** Yjs、SQLite、ring、日志。持久化层不保存 iframe HTML。已完成且无 live HTML 时展示 `McpAppHistoricalCard`（replay 与 live 均适用；**不会**在 restore 后自动 iframe；须用户点 Reopen 或等 live 会话内新工具完成且 lease 有效）。`mcp/app-open` 仍只消费**当前 turn 已完成的 live toolCallId lease**；对 replay 历史 id 调 open 会得到 `policy_denied`（silent）。Reopen 走 `mcp/app-invoke`，不是对旧 id 再 open。open 进行中仍走 `ToolCallActivity`；拿到 live HTML 后换 iframe。运行中工具仍走 `ToolCallActivity`。同一 live chat 内较早的重复 App 仍保留 activity 摘要行。

## 3. Peri 线契约（serde 踩过的）

权威形状在 Peri `peri-acp-types`，**不要**凭 MCP `resources/read` 的 `contents[]` 去猜 ACP 响应。

### 3.1 请求（Hub → Peri）

三条方法都带 `envelopeVersion: "1"`、`appsProtocolVersion: "2026-01-26"`。

| 方法 | 必填字段 |
|------|----------|
| `peri/mcp/open` | `serverId`, `toolName`, `ownerSessionId`, `invocationToken` |
| `peri/mcp/resource` | `serverId`, `appSessionId`, `resourceUri` |
| `peri/mcp/app` | `serverId`, `appSessionId`, `resourceUri`, `payload`（JSON-RPC `tools/call`） |
| `peri/mcp/invoke`（**Peri 缺口**） | `serverId`, `toolName`, `ownerSessionId`, `arguments` — Host 显式重跑 App 工具，返回新 `toolCallId` 并 `issue()` lease |

`McpAppRequest` 是 `deny_unknown_fields`。漏 `resourceUri` 时按钮 `tools/call` 会被 Peri 整包拒绝。

`payload` 必须是：

```json
{ "jsonrpc": "2.0", "id": "…", "method": "tools/call", "params": { "name": "<本地 toolName>", "arguments": {} } }
```

### 3.2 响应（Peri → Hub）

Open / resource / app 成功体都带 envelope 字段：`envelopeVersion`、`appsProtocolVersion`、`mcpProtocolVersion`、`serverId`，再加上业务字段。

**禁止**对 Studio 侧 DTO 开 `deny_unknown_fields` 只收 `appSessionId`+`resourceUri`。本机第一次 e2e 就是这样：Peri 返回完整 envelope，Hub 解析失败 → `agent_unavailable` → 永远没有 iframe。

| 方法 | 业务字段 | 注意 |
|------|----------|------|
| open | `appSessionId`, `resourceUri` | 忽略其余 envelope 字段 |
| resource | `resources[]`（不是 `contents`） | 条目用 `_meta`（不是 `meta`） |
| app | `payload`：`{ jsonrpc, id, result \| error }` | iframe 要的是 **内层 JSON-RPC**，不是整个 ACP result |

Resource 条目 MIME 必须是 `text/html;profile=mcp-app`。`_meta.ui.csp` 在 Peri fixture 里是对象 `{ connectDomains, resourceDomains }`，不是 CSP 字符串。空数组 → 用 Host 缺省 restrictive CSP；有域名再合成 `connect-src` / `img-src` / `media-src`。

`mcp_app_call_result.result` 放内层 `payload`（含 `id`）。Web 按 JSON-RPC **id** 回给 View，不要 FIFO。

## 4. 浏览器 Host 握手（App Bridge 踩过的）

官方 View（`@modelcontextprotocol/ext-apps`）会用 Zod 校验 Host 的 `ui/initialize` **result**。缺字段会在 iframe 里抛：

```
hostInfo.version: expected string, received undefined
hostCapabilities: expected object, received undefined
```

当前 Host 用官方 `AppBridge` 构造器传入同一套 `hostInfo` / `hostCapabilities` / `hostContext`（`packages/ui/src/components/mcp-app/mcp-app-host.ts`）；不要再手写 `ui/initialize` 的 JSON-RPC result。`mcpUiInitializeResult()` 仍是该形状的单测锚点。

```json
{
  "protocolVersion": "2026-01-26",
  "hostInfo": { "name": "peri-studio", "version": "0.2.0" },
  "hostCapabilities": { "openLinks": {}, "serverTools": {} },
  "hostContext": {
    "theme": "light",
    "displayMode": "inline",
    "platform": "web",
    "containerDimensions": { "maxHeight": 720, "maxWidth": 720 }
  }
}
```

`hostInfo` 对应 MCP `Implementation`：`name` **和** `version` 都是必填字符串。`hostCapabilities` 至少是 `{}`；已实现的能力再声明 `openLinks` / `serverTools`。不要声明未做的 `serverResources` / `message` / `updateModelContext`。

`containerDimensions` 的规范类型是高度侧与宽度侧的 **交集**：只给 `maxHeight` 可能下一轮校验失败，两边都给。

顺序（规范强制，不可提前推 tool 数据）：

1. 面板 iframe `src` = `http://127.0.0.1:<sandbox>/sandbox.html?host=<encodeURIComponent(panelOrigin)>`
2. 沙箱 → Host：`ui/notifications/sandbox-proxy-ready`
3. Host → 沙箱：`ui/notifications/sandbox-resource-ready`（html + csp）
4. View → Host：`ui/initialize`
5. Host 回上面的 result（必须带 JSON-RPC `id`）
6. View → Host：`ui/notifications/initialized`
7. Host → View：先 `ui/notifications/tool-input`（`params.arguments` 为 object），再 `ui/notifications/tool-result`（`params` 必须是 **CallToolResult 对象**，`{ content: [...] }`）。首屏优先用 `mcp_app_resource.toolResult`；缺省才回落到 Chat Doc 里可能被 4KB 截断的 `tool.result`。用 **`addEventListener("initialized")`** 在每一次 handshake 上重推，不要赋值 `oninitialized`（setter 会覆盖并打 “handler replaced”）。canvas View 开了 React StrictMode，会二次 `ui/initialize`；`tool-result` 是一次性通知。**不要**把第一次 `initialized` 当成 `bind()` 的完成条件去 `await`。
8. View `tools/call` → `mcp/app-call` → `peri/mcp/app`

**不要**用 `Show keyed` 绑定整个 live session 对象，也**不要**在 `size-changed` 时改同一份 session 再重设 iframe `src`。高度必须独立信号。inline 默认 400px，上限 `min(720, 70vh)`；沙箱代理页内层 iframe 必须 `height: 100%`，超出时由 View 文档滚动，不能靠代理页 `overflow: hidden` 把卡片裁掉。官方 basic-host 有 `if (iframe.src) return`：给已有 `src` 的 iframe 再赋值同一 URL 仍会整页重载，于是 `sandbox-proxy-ready` → `loadView` 循环。`McpAppFrame` **只在 iframe 挂载时** `bindMcpAppHost` 一次（`onMount`），session 用 getter 读取；Yjs / liveApps 对象换新不得 abort 重连。只有组件真正卸载才 `close` 并清 `src`。全屏用 CSS `position: fixed` 放大同一 iframe，禁止再挂一个 sandbox。同一 chat 里相同 `resourceUri` 只渲染最新一份 live iframe，更早的调用退回 `ToolCallActivity`。URI 尚未到达时，才退回同条消息里的同名 MCP 工具去重。

沙箱只本地处理 `ui/notifications/sandbox-*`；其余 JSON-RPC 双向透传。`ui/open-link` 只允许 `https:`。

内层 HTML 的 CSP 用 `<meta http-equiv="Content-Security-Policy">` 注入（iframe `csp` 属性不是真实 CSP）。缺省不要 `unsafe-eval`。

## 5. 双 origin 与 CSP（本机金丝雀拦过的）

| 面 | 地址 | 职责 |
|----|------|------|
| 面板 | `http://127.0.0.1:8456/`（`PERI_STUDIO_LISTEN_*`） | 认证 Cookie、业务 API、Hub WS |
| 沙箱 | 同 IP、端口 +1（或 `PERI_STUDIO_SANDBOX_PORT`） | 只提供 `sandbox.html`，无 Cookie、无 API |

**必须用同一 hostname。** 面板开 `127.0.0.1`、沙箱却写成 `localhost`（或反过来）会变成第三 origin，postMessage / CSP 全断。e2e 一律 `http://127.0.0.1:8456/`。

### 5.1 面板拦 iframe

现象：控制台 `Framing 'http://127.0.0.1:8457/…' violates CSP "default-src 'self'"`。`frame-src` 未声明时回落到 `default-src`，**异端口即异源**。

修复：`frame-src` 只写 `127.0.0.1` / `localhost` 的精确沙箱端口。Chrome 的 `frame-src` **拒绝任何 `[::1]` host-source**（精确端口 `http://[::1]:8457` 和控制台打码的 `<URL>` / `http://[::1]:*` 一样非法）。`frame-ancestors` 同样；沙箱头优先用 query `host=` 的精确面板 origin。`:*` 只留给 `connect-src` 的 v4/localhost。e2e 必须 `http://127.0.0.1`，不要用 `[::1]`。

面板自己的 `X-Frame-Options: DENY` 只禁止**被嵌**，不禁止去嵌别人。

### 5.1.1 面板拦 CSS `data:` 图

现象：控制台 `Loading the image 'data:image/svg+xml,…feTurbulence…' violates CSP "default-src 'self'"`。Chrome 把 CSS `background-image: url(...)` 按 `img-src` 执行；未声明时回落 `default-src`，拦截 `data:`。

修复：侧栏磨砂颗粒用同源 `/images/sidebar-frost-grain.svg`，面板 CSP 显式 `img-src 'self'`，不要给面板放开 `data:`。

改的是 HTTP 响应头，浏览器会缓存旧 CSP：**改完必须重启 server 并强制刷新**。

### 5.2 沙箱 404

现象：`GET /sandbox.html?host=http%3A%2F%2F127.0.0.1%3A8456` → 404。

路由把整段 request-target（含 query）去和 `/sandbox.html` 比。必须先剥 `?`。主站 `parse::request_path` 已剥 query，但那是 `#[cfg(test)]`，沙箱有自己的 `sandbox_path()`。

沙箱响应加 `frame-ancestors` 限制只能被 loopback 面板嵌；**不要**给沙箱加 `default-src`，否则内联 `<script type="module">` 会被掐死。`include_bytes!` 的是源文件 `web/sandbox.html`（无打包依赖），不是 hashed dist。`allow-scripts` + `allow-same-origin` 是规范双 iframe 的硬性要求，Chrome 会打 “can escape its sandboxing” 警告，不能靠去掉 `allow-same-origin` 消掉（srcdoc 将无法与代理页同源 postMessage）。

## 6. 生命周期与安全

- **自动 open**：当前 chat、非只读、`origin=live`、`status=completed`、name 可解析为 `mcp__{serverId}__{toolName}`（含 Cursor `execute extra tool \`mcp__…\`` 包装）、对应 MCP server 已在 `mcp_servers` 列表且 `connectionStatus=connected`、尚无带 HTML / `appSessionId` 的 live 条目。**禁止**对 `session_replay` 自动 open / 自动 invoke。
- **历史占位 + Reopen**：已完成且无 live HTML 时（含 Cursor extra-tool 包装 title），走 `McpAppHistoricalCard`（英文短句 + **Reopen app**；replay 为 “This app isn't available in restored history.”，live 为 “Not available after reload.”）。按钮 disabled：只读、重开进行中、或缺少 `chatId` / `toolCallId` / 可解析的 `serverId`+`toolName`；**不因** MCP 列表未刷新或未连接而禁用（点击后由 invoke 报错）。`chatId` 取自消息上下文（`selectedCid` / `currentChatId`），不依赖 composer 是否已选 session。点击 → Web `mcp/app-invoke` → Hub `peri/mcp/invoke`（同工具名 + Yjs 里保存的 **tool input arguments**）→ Peri 新 tool call + lease → 新 live 工具完成后现有 auto-open 拉 iframe。Reopen **只依赖入参**（如 `show_canvas.source`），**不**要求 Chat Doc 里保留 `compiled` / HTML / 未截断 **result**。`show_canvas` 从 `params`（或 JSON 字符串 / `extra` / `input`）取出 `source`；仅当完全无法还原 `source` 且 MCP 目录能证明该 server 有 `show_canvas_demo`（toolsCount≥2）时才回退 demo。**禁止**对 `session_replay` 历史 id 自动 `mcp/app-open`。Web 在 `mcp/app-invoke` 前须剥掉 Peri `ExecuteExtraTool` 信封（ACP `rawInput` = `{ "tool_name": "mcp__{server}__{tool}", "params": { ...MCP 入参 } }`；`params` 偶发 JSON 字符串）以及其它 `name`/`arguments`/`rawInput`/`extra` 包装，只发内层 MCP 工具参数（`show_canvas` 含 `source`）。
- **晚到 MCP（live only）**：runtime 投影先到、MCP stdio 后连上时，仅 **live** completed 工具在 `mcp_servers` 更新后重试 open；replay 占位不变。
- **拆 iframe**：新 `chat/prompt`（Web 在 `sendMessage` 里先拆）、cancel、close、**切换 chat 时拆 previousCid**（曾经误拆新 chat，旧 iframe 留在内存）。
- Hub 在 prompt/cancel/close 也会 `tear_down_chat`。lease 已死后再点按钮应 `stale_session` / `policy_denied`，silent，不要 toast。
- `policy_denied` / `tool_not_app_visible` / `capability_disabled` / `unsupported` / `stale_session`：保持 `ToolCallActivity`，不弹故障。
- instance 分类必须 **精确**：`session/update` 的 `content.text` **不是** Apps HTML。把任意 JSON 键 `text` 标成 SensitiveEphemeral 会让对话重连无法重放。敏感条件：`peri/mcp/*` 方法，或 result 的 `html`，或 `resources[]`/`contents[]` 带 mcp-app MIME / `ui://`。
- HTML 上限 1 MiB，超限公开错误，不截断渲染。
- **首屏 CallToolResult**：ACP `rawOutput` 入站时缓存在 Relay（上限 1 MiB），随 `mcp_app_resource.toolResult` 下发。Chat Doc **result** 仍按 4KB 省略（`compiled` / HTML 不得进 Yjs）；**MCP App 工具入参**（如 `show_canvas.source`）在 Chat Doc 保留至 1 MiB 供 Reopen。chat tear-down / 刷新后缓存与 HTML 一起消失。

## 7. 本机怎么验

1. `./dev.sh` 或先 `cd web && bun run build` 再 `cargo run -p peri-studio -- local`（Web 改动必须重新嵌入 `web/dist`）。
2. 打开 **http://127.0.0.1:8456/**（不要 localhost）。
3. Agent 为 Peri，workspace `.mcp.json` 配带 UI 的 MCP（金丝雀：Peri `official-apps-fixture` / 本地 `mcp-app` dashboard）。
4. 让模型调用 UI 工具 → completed 后工具卡应换成 iframe → App 内按钮走 `tools/call`。
5. 强制刷新后 iframe 消失、卡片还在，符合「瞬时、不落盘」。
6. 发下一条用户消息应拆掉旧 App。

改 CSP / 沙箱路由 / 嵌入的 JS 后都要 **重启二进制 + 强制刷新**。只热更前端不够：面板 JS 是 `build.rs` 编译期内嵌的。

### 7.1 cursor-canvas stdio（外部 MCP App）

画布 MCP server 源码在独立仓库 [`peri-canvas`](https://github.com/KonghaYao/peri-canvas)（本地常见路径 `…/remote/canvas`），包名 `cursor-canvas-mcp`。Studio Host **不需要**为接入 canvas 改 Rust/Web；只需 workspace `.mcp.json` spawn stdio server，并依赖 Hub 已注入的 `PERI_MCP_APPS=`。

**构建**（在 canvas 仓库，非 peri-studio）：

```bash
npm run build -w cursor-canvas-mcp
```

**workspace `.mcp.json` 样例**（路径换成本机 `dist/main.js` 绝对路径）：

```json
{
  "mcpServers": {
    "cursor-canvas": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/canvas/packages/mcp-app/dist/main.js", "--stdio"],
      "env": { "MCPP_LEGACY": "1" }
    }
  }
}
```

| 项 | 值 |
|----|-----|
| UI 工具 | `show_canvas`、`show_canvas_demo`（本地名；卡片 title 为 `mcp__cursor-canvas__…`） |
| Resource URI | `ui://cursor-canvas/mcp-app.html` |
| MIME | `text/html;profile=mcp-app` |
| Resource `_meta.ui.csp` | `{ "connectDomains": [], "resourceDomains": [] }` → Host 缺省 restrictive CSP |
| `structuredContent` | `source`（TSX）+ `compiled`（server 预编译，iframe 无需 `unsafe-eval`） |

**两套协议不要混用**：MCP wire 默认 `2026-07-28`（`legacy: reject`）；Peri ACP stdio 当前仍走 2025-era handshake，server env 需 `MCPP_LEGACY=1` 直到 Peri 在每请求 `_meta` 信封上对齐现代 MCP。App Bridge **UI** 协议仍是 Host 固定的 `2026-01-26`（`ui/initialize` result），与 MCP wire 版本无关。

**Agent 流程**：先读 `skill://cursor-canvas/SKILL.md` → 只从 `"peri/canvas"` import 写 TSX → `show_canvas`。验证 iframe：`show_canvas_demo`。

## 8. 已知缺口（下次会再碰到）

- Host 用 npm `@modelcontextprotocol/ext-apps/app-bridge`（`AppBridge` + `PostMessageTransport`，`client: null`）。不要引入 React `@mcp-ui/client`。View HTML 仍走官方 `App()`。
- **`peri/mcp/invoke`（Peri 侧待落地）**：Studio Hub/Web 已发 `mcp/app-invoke` → `peri/mcp/invoke`；当前 Peri 仅实现 open/resource/app，会回 `unsupported_method`。Peri 需：Host 触发 `EffectiveToolDispatcher` 调同名 App 工具、`issue()` 新 lease、经 `session/update` 投影新 tool call，响应带 `toolCallId`。
- `ui/message`、`ui/update-model-context`、协议级 `ui/request-display-mode`（pip）、任意 `resources/read` 首期不做。Host 侧 iframe 全屏（右上角按钮，不重绑 sandbox）已做。
- 远程 TLS 下第二 sandbox origin 未做。
- Chat Doc 不写 live `appSessionId`（刷新不复活）。可选公开字段曾考虑过，已删空 stub，避免假装落盘。
- 重叠 `tools/call` 已按 id 关联；Hub `commandId` 与 View id 的映射依赖 call result 内层 `payload.id`。

## 9. 决策备忘

| 决策 | 原因 |
|------|------|
| 不声明 `peri.mcpApps` | Peri 已删除该能力；只认 env |
| 第三帧 `mcp_app_call_result` | 计划只写了 session/resource；iframe 需要把 `tools/call` 结果送回去 |
| 官方 App Bridge + Solid，不引入 `@mcp-ui/client` | `./app-bridge` 无 React 依赖；React 只是可选 peer。Studio 不是 MCP client，`new AppBridge(null, …)` + `oncalltool` 回 Peri |
| 首屏 CallToolResult 走 `mcp_app_resource.toolResult` | Chat Doc **result** 4KB 省略（`compiled`/HTML 不进 Yjs）；**MCP App 入参**保留至 1 MiB 供 Reopen。瞬时缓存上限 1 MiB。帧顶层禁止 `structuredContent`。Peri ACP `rawOutput` 常只有 `content[]` 文本，此时用缓存的 tool **arguments**（如 `source`）合成 `structuredContent`。 |
| 沙箱独立最小 HTTP，不走面板 `serve_http` | 绝不能带认证 Cookie / 业务 API |
| 分类 fail-closed 但禁止扫 `text` 键 | 漏判会把 HTML 写入 ring；误判会毁掉 transcript 重放 |

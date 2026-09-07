# Peri Studio 架构设计（权威版）

> 状态：v2.17（ACP 权威会话目录，[ADR-0003](adr/0003-acp-authoritative-session-catalog.md)）
> 日期：2026-08-30
> 定位：peri-studio 独立项目的架构基准文档。与 peri 的唯一耦合点是 ACP 进程（协议线格式），本设计不依赖 peri 的任何 crate 与部署形态。
> 来源：三轮对抗面试（产品/用户角度）收敛裁决 + 参考实现 `@fenix/chat-channel`（`/Users/konghayao/code/pazhou/remote-control-server/packages/chat-channel`，实现基线 `docs/arch/19-yjs-chat-streaming.md`，ADR `spec/global/adr/2026-08-04-chat-channel-package-design.md`）+ 三视角对抗审查（架构师/高级开发工程师/高级运维工程师，2026-08-07）+ 三轮 advisor 成熟度审查（2026-08-07，opus，第三轮评级：**可开工**）。v2.1 修订项以「【审查】」标注；v2.2 以「【顾问】」；v2.3 以「【顾问2】」；v2.4 以「【顾问3】」；v2.5 补充 Web project session 与浏览器认证契约；v2.6 与视图层和当时 workspace 实现对齐；**v2.7 以唯一 `peri-studio` 发布物取代两个发布二进制，但保留 server/instance 的独立进程与协议隔离**（见 §3.1–§3.3 与 [ADR-0001](adr/0001-single-binary-dual-process-roles.md)）；v2.8 收敛无状态恢复、远程 FS/Git 资源投影和十轮 Chat/UIUX 审计后的可靠浏览器边界；v2.9 令 Web 权限裁决回传 Control Doc 投影的精确 ACP `optionId`，并在恢复证据与交付边界校验 ID 和 scope；v2.10 增加权限期限的可见倒计时与浏览器 fail-close 门控；v2.11 统一权限与询问队列的领域身份选择和删除回退；v2.12 为一次性 elicitation 回答增加不可重放的刷新与本地隐藏恢复面；v2.13 为移动端 FS/Git 预览增加稳定来源身份与编辑器焦点往返；v2.14 完成有序 Chat blocks、回放信任标签、按 session 消息投递、协商 prompt 字节预算、principal 作用域持久草稿、权限输入证据、资源租约/代际与高对比浏览器矩阵；v2.15 将 ACP 工具 kind、content、locations、raw output 与 content chunk 统一为有界 tri-state patch，允许终态后只补证据但不重开生命周期，并令 turn 终态收敛全部消息分段和非终态工具；**v2.16 将 M2 跨机接入定为 SSH 供应器 + 反向隧道（对抗审查后可开工：SSH 不进全局 Restarting、Disconnect≠Stop、监督在 app/）**（见 §3.1、§8.3 步骤 5a 与 [ssh-machine-mount.md](design/ssh-machine-mount.md)，[ADR-0002](adr/0002-ssh-machine-provisioner.md)）；**v2.17 移除 SQLite `project_sessions` 权威，ACP `session/list` + agent 磁盘为 durable 会话目录唯一事实源，wire `sessionId` 即 ACP id，归档/重命名改浏览器 IndexedDB**（见 §3.0、[ADR-0003](adr/0003-acp-authoritative-session-catalog.md)）。advisor 关于「删除 HMAC 双向认证」的删减建议**被否决**（§9.2 保留，v2.3 补齐协议级规范，v2.4 补齐线格式精度）。
> 约定：引用 chat-channel 处标注其文档章节号（如「chat §5.2」），实现时以该仓库为对照基线。协议事实（帧 tag、action 面、schema 版本、默认值）以 `peri-studio-proto` / `server/src/config` 实现为真相来源，本文与实现不一致时以实现为准并回改本文。【v2.16】`machine/*` 在进入 proto+whitelist 之前，以 [ssh-machine-mount.md](design/ssh-machine-mount.md) 为开工契约，禁止只改文档不改白名单。

---

## 1. 背景与目标

### 1.1 现状

设计起点是旧 `peri-studio` stdio 桥接器：IDE stdin → JSON-RPC 解析 → 按 chat 分流到独立 ACP 子进程 → 子进程 stdout 转发回 IDE。单机、单连接、进程随 IDE 生命周期。【v2.6】该起点形态已由 §1.2 的 server / instance 两级形态**实现取代**（本仓库 `server/` + `instance/` + 内嵌 Web 面板），本节仅保留为演进背景。

### 1.2 演进目标

将 peri-studio 升级为**中心服务器**形态：

1. **server / instance 两级实体**：server 是中心控制面；instance 是实际运行 ACP 进程的机器，与 server 通过 WebSocket 联通，接收 server 下发指令完成 ACP 进程的启动/停止。
2. **ws 通信取代 stdio**：为未来远程模式（本机客户端连远程 server、局域网多机）打基础。
3. **yjs 统一数据对象**：ACP 事件在 server 侧经**规范化边界 + 聚合器（agg）**投影为**视图对象**，以 yjs 标准数据结构承载（每 chat 双 Doc + 全局 Registry Doc），多端（Web 面板 ×N；【v2.6】原多 TUI 规划未实现）经 yjs 同步一致。
4. **视图层纯客户端**：server 角色与浏览器的 Web 面板是 client–server 关系，经 ws + yjs 同步状态。【v2.6】原规划的 `peri-studio-tui` **未实现**，视图层由 SolidJS **Web 面板**承担；【v2.7】构建产物内嵌进唯一 `peri-studio` 可执行文件并由 server 角色托管（§3.2）。「纯视图层、不上行 update」的约束不变（§5.6）。

### 1.3 非目标（明确不做）

- chat 跨 instance 迁移 / 自动恢复
- server 自动负载均衡调度
- 多用户、配额、审计（结构化操作日志保留，见 §9.4；连接级配额除外，见 §8.6）
- 公网部署（wss / 公网认证）——后置为 M4
- ACP 协议本身升级（wire format 保持既有兼容）
- 领域事件日志体系与写租约（chat Q5 评审决策，理由同源：YJS CRDT 保证收敛、进程内单写、`commandId` 去重承担防重复副作用；去重记录由内存 outbox 承担，见 §4.4）

---

## 2. 产品语义（用户可见行为契约）

以下为第一版必须成立的用户可见行为，作为验收基线：

| # | 语义 | 验收标准 |
|---|------|---------|
| P1 | 视图客户端崩溃/重启不影响正在运行的 agent | 关闭/刷新 Web 面板后 agent 继续跑完，重开面板秒级恢复视图【v2.6：视图层 = Web 面板】 |
| P2 | 多客户端可同时 attach 同一 server | 两个浏览器面板看到一致状态；任一面板可发控制指令 |
| P3 | server 崩溃/重启不中断 agent | 重启 server 后 **其控制面仍由本进程监督的** instance 自动重连，agent 产出**在缓冲有界承诺内不丢**（缓冲上限内不丢；超限按 §8.5 丢弃策略丢弃并以 gap 呈现，不假装完整）【顾问：P0-3】【v2.16】SSH 机器的控制面是本机 `ssh -R`，随 studio 进程退出；远端 ACP 不被 SIGKILL。全局 Restarting 只等待 `local`。已 Trust 的 SSH 机器在 Healthy **之后** best-effort 重建隧道（可关）。接上之前允许 interrupted 与缓冲溢出。见 [ssh-machine-mount.md](design/ssh-machine-mount.md) §4–§5 |
| P4 | instance 断线时活动 turn 明确中断，chat 可恢复 | 断线瞬间活动 turn 呈现 `interrupted`；补推完成后 chat 恢复可用、可开新 turn（见 §7.3 分区恢复裁决） |
| P5 | 新建 chat 显式指定 instance（默认本机） | 路由可预测、可调试 |
| P6 | 客户端操作（发消息/cancel/新建/关闭）有请求-响应确认 | 两阶段 Ack（accepted→committed），失败有稳定错误码，不静默 |
| P7 | 未知设备无法接入 | token 校验失败即断开，无任何数据可见 |
| P8 | 重试安全 | 客户端以同一 `commandId` 重发不产生重复副作用（进程内 outbox 去重索引，§4.4；重启后命令不重发，以 ACP 现场为准，§8.4.1） |
| P9 | instance daemon 崩溃不产生无人知晓的孤儿执行 | 重连后 server 对「已中断但 instance 声称存活」的 chat 默认下发 kill 清理，面板可见（见 §7.5） |

---

## 3. 系统拓扑与模块

### 3.0 Web project session 扩展

Web UI 使用三层身份加一次 runtime，禁止互换：`project_id` 是左栏分组；wire `sessionId` **即 ACP durable `session_id`**（Registry 投影字段 `acp_session_id` 保留兼容）；`chat_id` 是一次 server/ACP runtime。Hub 不再生成独立 logical session id，也不维护 SQLite `last_chat_id` 快路径。重启后打开持久入口必须以精确 ACP session id 走 `spawn + session/load`，不得复活旧进程或根据标题猜测；同一 ACP id 已绑定且 `runtime_confirmed` 的 chat 仍可由 `ChatRegistry` 复用。

runtime create 横跨 Hub chat 状态、instance child 与 ACP durable thread 三个不同副作用边界。server 必须在 spawn 前在内存 outbox 越过 no-redelivery barrier（§4.4 状态机，§8.4：不落盘）；只有显式 spawn rejection 或同 chat 的 `kill_ack.ok=true` 才能证明 child 不存在并解除该 barrier。`session/new` 一旦可能进入 ACP stdin，kill child 也不能证明 durable thread 未创建，命令必须收敛为 `DELIVERY_UNKNOWN` 并禁止自动重放。重启后内存 outbox 为空（§8.4.1），create 不自动恢复、不重发；禁止把已丢失 executor 的记录继续暴露为进行中，也不得自动复活旧进程。

该恢复不变量的端到端验收必须跨过 ACP stdin wire，而不能只比较 Ack 回显或 SQLite 投影：隔离产品旅程需证明重启后的新 ACP 进程只收到一次 `session/load`，其 `params.sessionId` 与重启前持久化的 durable ACP id 完全一致，并在该 runtime 上成功继续 prompt/Yjs 投影。生产 instance 仍只统计 ACP stderr，不记录正文；wire 观察仅允许测试专用 ACP fixture 写入其临时目录。

左栏 catalog 直接投影 ACP `session/list` 在 project cwd 上的 durable 会话（agent 磁盘为权威）。`session/create` 在 project cwd 上 `session/new`，committed ack 的 `sessionId` 即新 ACP id 并刷新该 project 的 list 缓存。`session/import` 保留为兼容 no-op（list 已包含即已在目录）。server 重启后 Registry `project_sessions` 段为空，直至 `session/discover` 或用户打开 project 触发 list。

交互式 `session/list` 与后台 `(instance_id,cwd)` catalog 同步由 `SessionCatalogService`（原 `SessionCatalogSync`）单独拥有：它统一负责按 `project_id` 调用 ACP `session/list`（经 discovery runtime 或项目级 single-flight）、list 缓存、超时、响应解析、cwd/current-binding 装饰、精确 ACP id 标题刷新，以及合并 `ChatRegistry` 运行态（`active_chat_id`、status）与内存激活表后写入 Registry `project_sessions` 段。`CommandCoordinator` 只在同步校验后把结果映射为 `Accepted`/`Failed`，Hub 只启动 poller；catalog 模块不得依赖 outbox、DocManager、chat executor 或 terminal watcher。后台每个精确 `(instance_id,cwd)` 只选择一个非终态且已 binding 的 runtime 作为查询通道，不能按标题猜测归属。

旧客户端的 `workspace/create|remove` 由 `WorkspaceCompatibility` 单独拥有：它把 legacy action 适配到 SQLite project 权威写入、Registry v2 project 投影和 legacy `workspaces` mirror，并在启动与变更后重建同一进程内索引。`CommandCoordinator` 只保留 action 路由和既有 Ack fan-out；兼容模块不得依赖 outbox、DocManager、chat executor 或 transport sender。`workspace/remove` 只归档目录定义并移除 legacy navigation projection，绝不关闭或改变已经存在的 runtime chat；跨 SQLite/Registry 的部分失败保持结构化终态，不能伪装成全局原子提交。

已有 commandId 的重放、恢复身份校验、替代连接 observer 与 terminal wire publication 由 `CommandOutcomeBroker` 单独拥有。它以一个进程内 outcome-state 临界区统一保护 missing-durable terminal fallback、sticky overflow、durable terminal 二次读取与 observer attach/remove；因此 durable terminal 或 terminal append 失败的 fallback 无论先于还是后于替代连接到达，都只能被立即重放或被后续 fan-out，不得留下永远等待的 observer。每 command 最多 8 个、全局最多 256 个 live observer；missing-durable verdict 最多保留 1024 个且绝不任意淘汰，容量耗尽后全局 fail-closed。`CommandCoordinator` 只保留全局 admission gate、新 command reserve/outbox insert、per-chat 调度及 lifecycle 结果适配；各 lifecycle 模块仍是 durable terminal transition 的唯一 owner，Broker 不制造持久事实。

导入候选的冷启动入口是 project 级 `session/discover {projectId}`，不能要求用户先创建或打开一个 Hub 会话。server 优先复用同 instance/cwd 的非终态 runtime；没有可复用 runtime 时，建立一个不进入 ChatRegistry 常规 chat map、Registry chat map 的私有 ACP 进程，依次执行 `initialize`、`session/list` 并在刷新 list 缓存后 `instance/kill`。该临时进程只在 ChatRegistry 的心跳 ownership 集合中登记为 server-owned，避免被孤儿清理竞态提前终止；同一 project 的 discovery 必须 single-flight。discovery 刷新 ACP list 缓存，不创建 ACP session 或侧边栏外的新身份。

导入是显式的选择、事实复核、提交三阶段流程（【v2.17】`session/import` 提交改为兼容 no-op；复核与 discover 仍用于刷新 list）。复核只展示 ACP `session/list` 已实际提供的标题、更新时间、完整 `acp_session_id` 和精确 cwd；当前协议没有消息摘要时，UI 必须明确说明内容预览不可用，不得从标题推断或伪造预览。搜索或 Registry 刷新使候选离开当前结果后，旧选择立即失效且不可提交。提交期间锁定查询与选择；服务端明确拒绝和 delivery unknown 必须显示不同恢复建议，后者只能使用原 `commandId` 重新确认。

`<data_dir>/metadata.sqlite3` 是 **project** 元数据与全局 metadata command 去重的唯一事实源，也是**唯一落盘产物**（§无状态投影：per-chat 投影 update 与 outbox 均为内存态，崩溃恢复由 ACP 重放提供，§8.3/§8.4）。**会话目录不再落 SQLite**（V7 删除 `project_sessions`、`session_activations`、`session_runtime_history`）。Registry v2 的 `projects` 仍自 SQLite 投影；`project_sessions` 段改为 **ACP `session/list` 内存缓存** 的只读广播。`project/*` mutation 的 committed Ack 仍须跨过 SQLite 提交与 Registry 投影屏障；`session/create|open` 等含 ACP 副作用的动作按 §4.4 域规则，结果不确定时进入 `reconciliation_required`，不得自动重试 `session/new`。`project/rename` 只更新展示名并保持 project id、cwd、instance binding 不变。project 的“删除”在用户界面中始终是可逆归档：`project/archive|restore` 只设置或清除 `archived_at`，复用全局 commandId 去重与投影屏障。project session 的归档/恢复与自定义展示名 **不落 server**：Web 以 IndexedDB `{principalId, projectId, acpSessionId}` 存 `archived` / `customName`，读侧与 Registry 目录合并；ACP thread、消息历史、runtime chat 文档和工作目录文件均不因归档而改变或删除。归档 session 后，Web 必须从导航、搜索、上次打开恢复候选中排除它，恢复后才重新可见。任何 project session 仍绑定非终态 runtime 时，归档 project 或 session 都必须拒绝；无法验证 runtime 状态时同样 fail-closed，避免把仍在工作的 agent 从导航中隐藏。

project session 的展示名优先级固定为浏览器 `customName`（IndexedDB）→ 有意义的 ACP `acp_title` → Hub 从首条已安全下发 prompt 生成的内存 `hub_title`（仅当前 server 进程、不写 SQLite）→ ACP 默认标题 → `新对话`。`hub_title` 使用首个非空行、Unicode 字符边界和 60 字符上限；它不调用 ACP rename，也不覆盖用户别名。后续 `session/list` 返回真实 ACP 标题时，ACP 事实自然接管展示。

Registry 视图无独立日志/快照：`registry.log`/`registry.snapshot` 及其 compact 机制已随无状态投影重构删除（§8.4）。Registry Doc 的 `projects` 段自 metadata.sqlite3 只读广播；`project_sessions` 段自 ACP list 缓存与运行态合并投影。server 启动时 `ProjectService::reproject` 从 SQLite 重建 `projects`（毫秒级），`project_sessions` 启动为空直至 list；运行期随 SQLite project 变更或 catalog 刷新投影；启动失败（SQLite 不可读）fail-fast，不静默重建。

浏览器认证通过同源 `POST/GET/DELETE /api/auth/session` 建立内存 opaque session，并下发 `HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` Cookie，与服务端 8 小时 TTL 对齐。会话本身始终是 HttpOnly cookie，WebSocket 帧与 URL 不携带 bearer。首次本地启动在 token store 从未配置 client 角色时自动创建受管 `local-browser` full token；同源 loopback 页面可且仅可调用一次 `POST /api/auth/session/bootstrap`，由进程内一次性 secret 直接换取 Cookie，响应、URL、日志和浏览器存储均不含 token。显式吊销或配置 client token 后不得自动补发。为兼容手动登录，Web 仅把用户主动输入的 full token 存入 localStorage（`peri_studio_token`），用于下一次打开时自动重放 `POST /api/auth/session`；登出、server 判定 token 失效或浏览器存储不可用时立即清除。Cookie attach 与存量连接按心跳重新校验 token id、撤销状态和当前 role；instance HMAC 与旧 CLI wire-token 流程保持兼容。

认证成功响应额外返回由 server 对内部 token id 做单向 SHA-256 后截断编码的 `principalId`。该值只作为浏览器本地持久状态的隔离键，不是 bearer、不可用于恢复 token id，也不进入 WebSocket URL 或业务日志；role 或 principalId 缺失/畸形时 Web 必须 fail closed。

server 启动时确保名为 `local` 的 instance token 存在，并把对应凭据原子发布到 `<data_dir>/instance.token`（`0600`）；启动路径不打印或返回 token 本体。本地 supervisor 只把该受限文件路径交给 `connect` 子进程，不解析 `tokens.toml`，也不依赖日志抓取。运维显式执行 `token generate` 时仍遵守 stdout 一次性显示或 `--output-file` 私密落盘语义。

登录帮助由 server 的权威运行时 `Config` 派生，不得由 Web 猜测 XDG 默认值。`GET/POST /api/auth/session` 的成功与 401 响应可附带 credential-free `setup { tokenFile, generateCommand }`；字段只描述当前进程实际使用的 token 文件和带精确 config-dir/可执行文件的生成命令，不得包含 token 内容、token id、名称或文件数据。浏览器严格解析这两个非空字符串，畸形/缺失时只显示无路径的通用命令。AuthService `try_lock` 竞争在 GET/POST 上返回 `503 auth_busy` 与 `Retry-After`，不得坍缩成 401 并归罪正确凭证。

浏览器收到 `auth_error` 或认证终态关闭码时，必须原子完成运行态清理、principal 撤销与登录失效事件发布。失效事件是单一 `{id, reason}` 值，禁止拆成可独立漂移的 epoch/reason signals；清理 Y.Doc、草稿和连接状态不得抹掉它。登录页持续展示原因，直到重新认证成功或用户显式退出。普通 401 status bootstrap 可保持安静，但已登录会话的撤销不能退化成无解释的登录表单。

`auth-state` 是 principal、read-only policy 与失效事件的唯一前端事实源；feature 组件直接读取该窄接口，store 只在 action guard 和连接失效编排中消费，不得 re-export 第二入口。`AuthGate` 为每个 status/login 请求分配单调 request epoch；WebSocket 失效、退出或后续请求会使旧 HTTP 结果失效，晚到 200 不得恢复已撤销会话。HTTP 200 只有在 role 精确解析为 `full`/`read-only` 时才能进入应用，未知或缺失 role 必须 fail closed。

浏览器必须区分**连接世代**与**身份世代**。普通 WebSocket reconnect 保留当前逻辑会话、Registry/Chat 投影与可对账 command，以便快照重放后连续工作；logout、`auth_error`、4502 或新的 HTTP principal 成功安装之前则必须经过同一个幂等 authenticated-session reset：先撤销内存 role 并 fence 旧 socket，随后清空全部 server-derived catalog/chat/control/diagnostic signal、command/delivery 状态和 Y.Doc，最后取消并清空所有 transient notification timer。旧身份排队的 rAF、WebSocket callback、command timeout 或 toast expiry 均不得写入新身份界面；本地 remembered session 只是恢复偏好，实际 reopen 仍必须由新 principal 经 server 授权。

loopback 认证 HTTP 面是封闭协议：只接受 HTTP/1.1；POST/DELETE 必须携带与 Host 精确一致的 Origin；POST 只接受 `application/json`（可选 UTF-8 charset）和显式非零 Content-Length；GET/DELETE 禁止 body。重复 Host/Origin/Cookie/Content-Type/Content-Length、任何 Transfer-Encoding、非法 JSON、长度不符与尾随 body 字节均 fail-closed。所有认证响应包含 `Cache-Control: no-store`、`Pragma: no-cache` 与 `X-Content-Type-Options: nosniff`，且永不反射 bearer token。

静态资源缓存以构建身份而非扩展名分类。页面入口 `/`、`/index.html`、兼容入口 `/panel.html`、404 与任何固定名资源使用 `Cache-Control: no-store`，确保 server 重启或协议升级后不会继续启动旧 Web 客户端。只有已命中内嵌资源表、位于 `/assets/` 且文件末段包含至少 8 字节构建指纹的 Vite 产物，才使用 `public, max-age=31536000, immutable`；不存在的 `/assets/*` 或未来固定名 public asset 不得继承 immutable。静态 `HEAD` 与 `GET` 共享状态、Content-Type、Content-Length、安全头和缓存分类，但 HEAD 不发送响应体，供健康检查与部署探针准确判断入口/资源存在性。缓存头与 CSP、nosniff、frame/referrer 安全头分别组装，所有静态响应继续携带安全头。

Web action 的连接期生命周期由单一 `CommandTracker` module 所有：发送成功后登记 timer，`accepted` 只表示排队且不得释放命令，`committed`/`duplicate`/`action_error` 才是终态。普通 metadata action 使用固定墙钟超时，`accepted` 不得延长它；只有显式声明 `acceptedStartsInactivityLease` 的 prompt 才把 accepted 与所选 runtime 的 Chat/Control Doc 更新视为活动证据，通过 `touch(commandId)` 续租 30 秒静默窗口，只有连续静默才转为“结果尚未确认”。超时或连接中断统一转为“结果尚未确认”；只有声明支持安全对账的 action 才保留原始 frame，并且重试必须复用同一 `commandId`。晚到终态可以清除对账记录，但不得再次调用已超时的业务 continuation。Solid store 只提供 transport adapter、runtime progress 与领域 callback，不得自行维护第二套 pending/timer/uncertain map。

Structural FS mutation 是该通用连接期模型下的 durable 特例：`fs/create-dir|move|delete` 在 instance dispatch 前把 principal、命令类型、project、payload fingerprint 与 lifecycle 写入 SQLite；terminal outcome 持久化后才 Ack。server 重启后，同 `commandId`/同 payload 只重放持久 outcome，dispatching 无终态证据收敛为 `DELIVERY_UNKNOWN` 且绝不自动再次执行；同 ID/不同 payload fail closed。执行 gate 按 project 隔离并在终态后回收。Unix instance 以 fd-relative/no-follow + exclusive staging rename 将 move/delete 最终 syscall 绑定到已校验 inode identity；recursive delete 的中途失败显式为 `DELIVERY_UNKNOWN`，要求 Web generation-fenced 完整 refresh 与人工核对。

project/session 目录动作的浏览器策略由 `CatalogActions` deep module 单一所有。它统一执行连接、权限与未确认 metadata 门控，构造目录命令，声明可对账 mutation 的同一 `commandId` 重试策略，并只在 `committed`/`duplicate` 后触发本地导航副作用。Solid store 只注入 transport、toast、错误持久化和选中态清理适配器；不得重新直接构造 `project/create|archive|restore|rename` 或 `session/discover|import`，避免等价目录动作产生不同的超时文案、终态语义或权限边界。`session/archive|restore` 与 `session/rename` 为浏览器 IndexedDB 偏好，不经 server metadata mutation。`session/create`、`session/open` 与 quick start 因包含 runtime 激活/导航状态机，仍由其各自的深模块与 store 编排，不归入纯目录 mutation。

终态业务副作用只能由 dispatch 时注册的 callback 执行一次；全局 Ack/Error handler 只负责日志、错误中心与调用 tracker。`action_error` 即使在 timeout/disconnect 后晚到，也可通过原 callback 把匹配的本地状态收敛为明确失败；晚到 committed/duplicate 不运行 callback，只能消除不确定证据。消息提交可安全清除其匹配的恢复卡，但 quick start 禁止在此时自动切换 runtime 或发送首条消息，必须提示用户从 server-authoritative 侧栏重新打开。非重试 action 的 late-error callback 只保留一个 Ack timeout 窗口，随后释放。

WebSocket 在 `send` 瞬间拒绝 frame 时，transport adapter 只调用该 action 注册的 `onError` 一次且不在 tracker 登记 pending。调用方不得在检查 `sendAction(...) === false` 后再重复失败 transition；同步拒绝、server `action_error` 和晚到明确错误必须共享同一领域失败 callback。

`accepted` Ack 可被安全重放但对领域 callback 幂等：同一 pending command 的 loading/accepted transition 至多执行一次，timer 仍保持到终态。权限决策的 command→permission 关联只存在于它注册的闭包中，不得另建全局 shadow map；明确失败由该闭包释放精确 permission lock，成功则等待 server projection 移除请求。

连接丢失只能调用一次 `CommandTracker::settleConnectionLoss` 来扇出各 action 注册的领域 callback；消息草稿恢复、quick-start 保留、权限锁定与 session-open 不切换当前会话均由对应 callback 结算且至多一次。`onStatus` 的 `reconnecting`/`fatal`/`closed` 分支不得再次直接修改这些 action 状态，否则同一断线会被解释两次。

WebSocket 生命周期的动作门控与可见连接状态由 `connectionTransition` module 统一解释。`connecting`、认证后 `open` 与 `reconnecting` 都必须保持 `ready=false,busy=true`；只有收到 server `ready` 才原子切换为 `ready=true,busy=false`。`fatal`/`closed` 同时关闭动作门控与连接 busy，并生成唯一的恢复问题。Store 负责 command、导航与认证等领域副作用，不得在各状态分支另写一套 `ready`/`busy`/status 判定。

Web 下行 JSON 边界同时保持形状安全与协议前向兼容：只有**文本帧**中的非数组 object 且含非空字符串 `t` 的 envelope 才能进入 WebSocket 分发；binary、`null`、JSON primitive、array、缺失/非字符串 tag 一律视为 malformed，只记录类别与长度，不记录原文。未知字符串 tag 仍原样交由 store 安全忽略，避免旧 Web 客户端因新 server 的可选帧而崩溃；但浏览器实际消费的 `ready`、`ysync.update`、`action_ack` 与 `action_error` 必须在传输边界按 Rust wire schema 严格解码。Ack 只接受非空字符串 command/可选身份和 `accepted|committed|duplicate`，error 只接受字符串 code/message 与布尔 retryable，projection version 只接受非负安全整数，Yjs update 必须同时满足合法 DocId 与 base64。直接下行帧的 absent optional 字段在线上省略；滚动升级期间 Web 仍接受旧 server 发出的显式 `null`，但必须先规范化为缺字段再进入状态机。已知 tag 的畸形值不得进入 tracker、导航或 DocStore。传输适配器隔离单次业务/状态回调异常，使后续合法帧仍可处理；原生 `WebSocket.send` 的同步失败必须返回 `false`，上层不得把该 command 登记为已发送。协议异常进入有界、可关闭的持久错误中心，且诊断永不携带 payload、token 或浏览器抛出的潜在敏感错误正文。

Web 的 Yjs 边界按文档身份拆分。`DocStore` 只拥有 doc identity、v1 update 应用和 rAF 合帧；`registry-view`、`chat-view`、`control-view` 分别且唯一解释 `hub:registry`、`chat:{id}`、`session:{id}`，共享 helper 只做无领域语义的 Yjs 值读取。兼容 barrel 不得包含解析实现，feature 应直接依赖其所属领域类型。`DocStore.clear()` 是连接世代屏障：注销、认证失效或连接替换后，旧世代已排队的 rAF callback 不得渲染新 doc，也不得消费新世代相同 doc id 的待渲染标记。

Registry 的低频目录与高频 instance heartbeat 必须经过 `RegistryProjection` 按领域 ID 结构共享：只替换投影字段真实变化的 instance/chat/project/session 对象，无关 `projects` / `project_sessions` 数组保持引用稳定。侧栏 instance 分组按 instance id 复用对象，instance 与 project 两层渲染均按稳定 ID 键控，避免元数据变化重挂 session 子树；用户正在输入的 rename draft、焦点、Popover 和 DOM identity 不得因 `last_heartbeat`、hostname/status 或 project 字段变化而丢失。DocStore drop/clear 同时释放 projection 世代，旧身份缓存不得跨 principal 保留。

Web 权限面必须完整呈现同一 Control Doc 中全部 `pending_permissions`，不能只显示迭代顺序中的第一项。请求按有效 `expires_at` 升序、再按 `permission_id` 稳定排序；界面一次聚焦一个决策并显示当前位置/总数，用户切换查看不得隐式提交。当前项以 `pending_permissions` 的外层 Y.Map key 保持显示身份（正常投影中等于 `permission_id`），只有内部 `permission_id` 可用于裁决动作；投影插入其他请求时不跳题，当前项消失后才选择同位置的下一项。每个 `permission_id` 的 pending/uncertain 锁相互独立，缺失内部 id 的畸形投影仍可稳定显示但必须 fail closed，禁止发送空 id 决议。有效 `expires_at` 必须在当前卡显示秒级倒计时；浏览器时间到达期限后立即禁用新裁决与原命令重试，等待 server 权威投影移除请求。显式但无法解析的期限按畸形投影 fail closed；缺省期限只为旧投影兼容而保持可操作。明确未送达且 server 标记 retryable 的失败只允许在原权限卡使用保存的原 `commandId` 与原 decision 重试；超时、断线或 `dispatched` 后结果未知必须继续锁定且不得出现重试按钮。

权限请求还必须投影与同一 `tool_call_id` 绑定的公开输入证据。server 只从权威 tool arguments 的顶层白名单生成至多 512 字符摘要：路径/工作目录/操作等受限标量可见，URL 仅公开 origin，命令只公开可执行文件与参数个数，未知/嵌套/环境变量/凭据字段默认拒绝。Control Doc 同时写 `evidence_tool_call_id`；Web 仅在其与请求的 `tool_call_id` 精确相等且摘要长度/控制字符校验通过时展示，否则按“证据不可用”处理，绝不回退显示原始 arguments。

Permission 与 Elicitation Queue 必须通过同一 identity-selection 模块分别按 `pending_permissions` 外层 Y.Map key / `elicitation_id` 保存当前选择，而不是保存数组下标或投影对象引用。远端重建对象、在当前项之前插入或重排其他请求时，当前卡片、草稿、焦点和 DOM 身份保持不变；仅当当前身份消失时，才选择原位置上仍存在的下一项或末项。导航只改变本地选择，不得隐式提交任何裁决或答案。

Elicitation 回答交付由独立 `elicitation-delivery` 模块按 `elicitation_id + command_id` 拥有 pending/confirmed/failed/uncertain/delivery_unknown 与本地隐藏状态。同一 elicitation 在权威投影移除前绝不允许第二个回答命令；terminal ACK 或已写入后的 action error 都只改变锁态，不能自行释放。只有 transport 明确拒绝写入 frame 时可以撤销尚未发送的本地占位。浏览器刷新后若 Control Doc 仍投影 `responding`，必须恢复为未知交付而不是重新开放表单。未知或失败卡提供“重取当前 Control Doc”与“仅本地隐藏”两条恢复路径：刷新只 unsubscribe/drop/re-subscribe Control Doc，不创建业务 action；隐藏保留原交付证据和不可重放门禁，直到权威投影移除该 elicitation 才释放。

ResourceWorkbench 打开文件或 Git diff 时必须把来源 view 与资源稳定键作为一次导航意图交给 AppShell，不得把临时 DOM 引用当成恢复身份。桌面端只读**文件**预览使用左侧可调宽 `ResourceFloatingPanel`，主对话区保持 `ChatView`，且不必收起右侧 Explorer/Source Control/Git Graph；**Git diff** 预览仍占满主区并暂挂右侧资源 view。移动端预览出现后，资源 Dialog 关闭并由包含完整路径/比较上下文的 editor heading 接管焦点，不能让 modal 的默认 focus restore 把焦点送回状态栏入口。关闭预览必须重新打开原 Explorer/Source Control view，并把焦点恢复到同一稳定资源键。Explorer 的展开项、roving active path、内部滚动位置，以及按 project/repository 隔离的 commit draft 与在途 requestId/提交快照，都由 Workbench 持有，不能因 Dialog Portal 卸载而丢失；目录投影删除 active row 或 project 身份变化时，active path 必须归一到最近存活祖先或首项，保证文件树始终只有一个 Tab 入口。commit draft 只有精确 mutation 成功且用户未在途改写时才清空，失败、请求被另一 mutation 取代或 project 身份切换都必须保留。桌面端若来源在预览期间被权威投影删除，则退回同一资源 view 的活动按钮，不能把焦点遗留在 `body`。该契约同时覆盖 Enter 打开与 Escape 关闭。

Resource Web session 为每次 project 激活分配单调 generation；所有 open-view/blob 请求与已接受 view 均绑定精确 `{projectId,generation}`，迟到或孤立结果只可 release。`leaseExpiresAt` 必须是有效 RFC3339；首个 Yjs update 到达前浏览器持有期限 timer，过期即 unsubscribe、release、drop Doc 并显示可恢复错误。首帧到达代表订阅已登记，可取消本地 deadline；后续 update 仍须同时命中当前 generation、project 与已接受 doc/view owner。该边界与 server 的 principal-bound 短租约共同阻止旧 project 污染与无界 DocStore 分配。

文件上传是独立于只读 Resource Web session 的 committed mutation：浏览器只提交 `projectId`、workspace-relative path 与有界文件字节，server 解析可信 instance/cwd。Full principal 先经 `resource/open-upload` 获取 principal/project/path 绑定的 60 秒单次 ticket，再以同源 cookie 执行 ≤8 MiB HTTP PUT，最后用带 `commandId` 的 `fs/write-file` create-only action 提交；instance 必须在可信 root 下重新校验路径并原子发布，冲突不得覆盖原文件。Web 的 Composer、QuickStart 与 Explorer 共用 feature 队列，project generation 切换必须 fence 迟到结果；Composer 仅在 commit 成功后插入 `@relative/path` 且不自动发送，Explorer 在批次完成后显式刷新。v1 拒绝目录与覆盖，不提供大文件流式上传。

Web 消息阅读器把滚动/跟随策略与单条消息语义分离：`MessageList` 只拥有文档水合、权限队列、自动吸底与完成播报；`ConversationMessage` 统一拥有 user/system/assistant 角色层级以及 reasoning、Markdown、tool、resource、error、copy 证据层。Chat reader 必须按 server `block_order` 生成稳定 discriminated `blocks[]`，正文、reasoning、tool 与 resource 不得再按类型重排；legacy orphan tool 只能以稳定尾部 block 兼容。用户和流式正文保持纯文本，只有已终态的 assistant 正文进入安全 Markdown 渲染；流式动画对辅助技术隐藏，完成状态由列表级原子播报一次。verified replay 与 inferred replay 必须分别显示“Verified history”与“Unverified history”，不能共用模糊 Recovered 标签。远程图片在用户同意前展示规范化 hostname，且不得提前请求网络。错误证据使用可命名 alert，reasoning 默认折叠，资源只展示 server 投影事实，不推断链接或可执行行为。

长会话的读取与呈现由两个深模块分界：`ChatProjection` 长期观察当前 Chat Doc，以 entry/tool 身份维护索引和结构共享；单条流式更新只重读直接关联的 entry，并保持其他 `ChatEntry` 对象身份稳定。`TranscriptWindow` 只接收稳定 entry id 序列，统一拥有变量高度测量、overscan、异步增高和历史前插后的可见 ID 锚点恢复；`MessageList` 只挂载窗口内行，同时以 `aria-posinset`/`aria-setsize` 暴露全局顺序。上滚阅读时不得因远端前插或 ResizeObserver 测量跳位，吸底状态下则必须随尾部高度变化保持最新内容可见；不得重新引入每帧全文拼接、全量 Markdown 解析或全量消息 DOM。

Web 消息投递恢复由 `message-delivery` module 单一所有：它按 durable session id 维护至多一个未裁决 submission，因此同一 session 保持 single-flight，互不相关的 session 可以并行；用户已确认继续但仍未取得精确投影的只读 unknown 证据仍按 command 关联。接口暴露 session/chat/command 精确查询以及 command-correlated 的 start/accepted/uncertain/failed/retrying/terminal/acknowledge/reset 领域动作。`start` 必须在模块内部拒绝覆盖同 session 未裁决提交；uncertain/failed 只在目标草稿为空时恢复原文，不覆盖用户更新；committed/duplicate 只清除仍等于原文的恢复草稿。`acknowledge` 仅可把 `delivery_unknown` 移入只读证据并释放该 session 单飞槽，不得恢复、编辑或重发原 command；精确 `source_command_id` 投影到达后才移除证据。浏览器内只读证据上限为 20 条；容量耗尽时必须 fail-closed，拒绝继续 acknowledge 并保留目标 session 门禁，直到精确投影清除旧证据或身份重置，禁止静默淘汰可能已执行的正文。Composer 不读取整张投递表，store 不维护第二套 signal/setter 或重实现 correlation。

Web 的逻辑会话导航由 `SessionNavigator` 状态机唯一裁决。Registry catalog、连接 ready、只读策略、用户打开请求、终态 Ack、失败/超时和本地 runtime 复用都必须作为事件进入该模块；它只输出 `request-open`、`activate`、`forget-preference` 三类效果。只有与当前 `session/open` command 精确匹配的 `committed`/`duplicate` Ack 可以切换 logical session 与 runtime chat；超时后的晚到 Ack仍交给 `CommandTracker` 完成对账，但不得移动 UI。组件不自行分支“只读复用 vs. 可写打开”，localStorage 也只作为恢复偏好而非会话事实源。

`SessionActivation` 是 session create/open/restore/quick-start 的单一应用层 façade。它组合 `SessionNavigator` 与 quick-start delivery 状态机，统一连接/角色/metadata uncertainty/single-flight 门控、命令构造、终态身份校验和导航 effect；Solid store 只注入 transport、当前投影、订阅激活与可见错误效果，不得直接构造 `session/create` 或 `session/open`。空会话创建只有同时收到非空 logical `sessionId` 与 runtime `chatId` 才能切换选择；committed/duplicate 缺失任一身份视为协议完整性故障，保持原选中态并等待 Registry 权威投影，禁止形成只有逻辑会话而没有可订阅 runtime 的半状态。quick start 必须先完成同一原子 activation，再提交完整保留的首条消息。

Registry 中的 `active_chat_id` 只证明某个 runtime 仍可复用，不证明当前浏览器已经选择、水合或能够向它输入。侧栏未选中的 live runtime 必须显示为“运行中，可切换”；只有当前选中、非终态且完成 Chat/Control 两份文档水合的 runtime 才能宣称“可输入”。默认标题必须在 sidebar、search 与 header 使用同一稳定身份消歧规则，避免多个“新对话”在切换后失去可识别性。

Web 组件库以 `shared/ui/index.ts`（`@/shared/ui`）为唯一公共代码入口，以 `src/styles/tokens.css` 和 `src/styles/base.css` 为视觉入口；完整 UI 规范见 `docs/design/ui-specification.md`。基础组件必须独立拥有默认、交互、禁用、错误、焦点与响应式触控状态；Feature 组件不得深层导入 UI 实现、创建裸 SVG canvas，或依赖偶然的页面样式才能让 Dialog、Drawer、Button、Field、Menu、Tooltip、Status、Toast 等基础能力正确渲染。该边界由源码架构契约与真实 Solid DOM 测试共同执行。

源样式必须在测试中通过 Lightning CSS 的无错误恢复严格解析，并由 PostCSS AST 检查媒体查询结构与设计令牌引用。Composer 与 quick-start 的容器焦点外观只能由一条共享规则拥有：指针焦点保持中性，只有内部输入命中 `:focus-visible` 时才显示高对比键盘焦点环；Feature 样式不得重新引入已淘汰的焦点令牌或失效选择器。

选中 runtime 后，Web 必须分别确认 `chat:{chat_id}` 与 `session:{chat_id}` 两份 server-authoritative Y.Doc 已至少应用一帧，才可以宣称“可输入”并开放 Composer。切换 runtime 会清空该 hydration 证据；断线不会抹掉已渲染历史，但任何新 runtime 都不得把初始空数组误当成空会话。控制文档已经投影出的待决权限高于普通载入文案；两份文档都到齐且消息确认为空后，UI 才显示首次消息引导。

Composer 草稿由独立 IndexedDB store 以 `{principalId, projectId, acpSessionId}` 复合键持久化（`acpSessionId` 与 wire `sessionId` 同值），而不是跟随临时 `chat_id` 或组件实例。同步内存 signal 提供输入体验，异步 hydration 受 revision fence 保护，晚到旧草稿不得覆盖用户已经输入的新文本。切换会话、项目或 principal 不得串稿，刷新后返回同一复合身份必须恢复；登出或认证失效清空当前浏览器全部草稿与本地 unknown 证据。消息提交状态同时携带 `command_id`、草稿 owner、`acpSessionId` 与 `chat_id`：发送失败或连接结果未知时只把原文恢复到所属会话，其他会话不被阻塞；`uncertain` 状态不可被直接关闭或以新 command 重发。`delivery_unknown` 只能经明确的 acknowledge-and-continue 转为只读证据后释放目标 session 单飞槽，晚到精确投影仍按原 command 清除该证据。

`ready` 在协商 `prompt-delivery-v2` 时必须携带正安全整数 `maxPromptBytes`；server 与 Web 都按 UTF-8 字节数而不是 UTF-16 code unit 执行同一上限。缺少 capability 或上限时 prompt 门控保持关闭；Composer 显示当前字节数/预算并禁用发送，非 Composer 的 quick-start/领域入口仍须在 action 边界重复验证。server 必须在 coordinator admission 前以 `PAYLOAD_TOO_LARGE` 拒绝超限正文。

### 3.1 拓扑

```
┌──────────────────┐  HTTP/ws 同源     ┌──────────────────────┐
│ Web 面板(SolidJS) │◄──────────────────►│ peri-studio         │
│ (浏览器内, ×N)    │ Action/Ack + y-sync │ server 角色         │
└──────────────────┘ + HttpOnly cookie  │ (控制面 + 内嵌 Web)   │
                                          └───────────┬──────────┘
                                                     ▲
                                                     │ outbound
                                           /instance ws + HMAC
                                                     │
┌──────────────────┐                    │
│ peri-studio      │────────────────────┘
│ instance 角色     │  local: 同一可执行文件的独立子进程
│ (每台机器 1 个)    │  remote: `connect <URL>` 前台进程
└────────┬─────────┘
         │ stdio (JSON-RPC 行协议)
         ├───────────► [ACP 进程 session_1]
         ├───────────► [ACP 进程 session_2]
         └───────────► [...]
```

要点：

- **连接方向**：instance **主动 outbound** 连接 server（NAT 友好、server 零入站依赖，ws 路径 `/instance`）；Web 面板主动连 server。
- **单 ws 多路复用**：一条连接上按帧类型区分控制帧（Action/Ack）与状态帧（y-sync），见 §4。
- **instance 与 ACP 进程之间保持 stdio**：`instance/src/child` 的 spawn/进程组监控/双格式转发能力（【v2.6】已落地，含 fingerprint 与 sys 进程组原语）；instance 对上层统一输出为**原始 ACP 帧流**。
- **规范化只发生在 server 侧**：`ACPChannel` 边界在 server（§6.1），instance 保持透明转发。
- **浏览器认证走同源 HTTP**：`/api/auth/session` 建立 HttpOnly cookie 会话后升 ws（§3.0 浏览器认证契约），与 instance 的 HMAC 双向认证（§9.2）是两条独立认证路径。
- **一个发布物，两个进程角色**：默认命令/`local` 与 `serve --local` 在 server 就绪后，以 `current_exe` 拉起独立 `connect` 子进程。不得改为进程内 instance task，否则 server crash 会同时中断 ACP，违反 P3。
- **本地/远程同路**：本地 instance 也必须走 `/instance` ws、版本校验、HMAC 和补推协议；禁止增加仅本地可用的直调 adapter。
- **SSH 挂载（v2.16 已落地）**：SSH 只做探测、安装/对齐二进制、落盘 instance token、以及本机 `ssh -R` 隧道。远端仍 `connect ws://127.0.0.1:<allocated>/instance`（无 `--allow-insecure`）。OpenSSH 由 **`app/` `SshBackend`** 监督并随 studio 退出；`server/` 禁止 spawn ssh。`kind=ssh` 的 instance **不得**进入全局 `recovery_instances`。已 Trust 且 `auto_reconnect` 的行在 Healthy 之后自动重建隧道。浏览器不持有私钥、不收集口令。Web 动词为 Add computer / Connect / Disconnect tunnel / Stop agents / Remove from Peri。`status --json` 经 `/api/health` 暴露 credential-free `machines[]`（`instanceId`/`displayName`/`phase`/`kind`）。权威契约见 [ssh-machine-mount.md](design/ssh-machine-mount.md)；[ADR-0002](adr/0002-ssh-machine-provisioner.md)。

### 3.2 模块与单二进制

【v2.7】唯一发布二进制 + 两个独立运行角色 + 一个内嵌 Web 前端：

| 模块 / 角色 | crate / 位置 | 职责 | 备注 |
|--------|------|------|------|
| `peri-studio` 应用 | `app/` | 唯一 CLI 与发布入口；选择 `local`/`serve`/`connect`；持有信号、就绪、本地 `connect` 监督与【v2.16】`SshBackend`（OpenSSH 隧道，随 studio 退出） | 每个平台发布一个原生 `peri-studio` 文件（Windows 为 `.exe`）；默认命令 = `local`；server 库禁止 spawn ssh |
| server 角色 | `server/`（库） | 认证、HTTP 面与静态托管、控制面、ACPChannel 规范化、聚合器、DocManager、instance 注册表、SQLite 元数据、【v2.16】`MachineService` | `peri-studio serve`；`--local` 要求同时拉起本地 instance |
| instance 角色 | `instance/`（库） | outbound 连 server（`/instance`）、收 spawn/kill/forward 指令、管理 ACP 进程树、透明转发 + 断线缓冲 | `peri-studio connect <URL>`；child 进程组 + fingerprint 孤儿清理（§3.3） |
| Web 面板 | `web/`（`src/panel` + `src/components/ui`） | SolidJS 视图层：yjs 只读投影渲染 + Action/Ack 操作；`src/components/ui` 为可复用组件库 | 构建产物经 Vite 生成 `web/dist`，**不单独部署**；原规划 `peri-studio-tui` 未实现 |

共享 crate：`peri-studio-proto`（帧定义、Action/Ack 信封、instance 协议类型、HMAC 原语、Y.Doc schema 的 Rust 类型镜像、schema registry）。`app` 可依赖 server 与 instance；server 与 instance 仍互不依赖，只共享 proto。

> 裁决依据：发布与安装只需一个文件，但 P3 要求 server crash 不中断 agent。因此合并的是**发布物**，不是**故障域**；详见 [ADR-0001](adr/0001-single-binary-dual-process-roles.md)。

**命令与生命周期契约**：

- `peri-studio` 与 `peri-studio local` 等价；启动 server，等 listener 实际就绪后拉起同一可执行文件的 `connect` 子进程；
- `peri-studio serve` 只启动 server；`peri-studio serve --local` 与本地复合模式共享同一监督实现，不另造启动路径；
- `peri-studio connect <URL>` 只启动 instance 角色，可作为远程机器的前台 daemon；
- 本地正常关闭由监督者停止接收新命令后通知 instance 优雅退出；server 异常退出或被 `SIGKILL` 时，不得以 parent-death 或 service cgroup 级联动终止 instance/ACP；
- server 重启后已存活 instance 先重连。新 local 仅在 owner lock 中的 managed-local token id、server endpoint、凭据摘要、PID 与出生指纹全部匹配时接管；不匹配则明确失败且绝不发信号；
- 接管把监督责任转移给新 local：持续监听 owner lock，owner 退出后恢复同一 `connect` 的 spawn/backoff；新 local 优雅退出时通过数据目录内的 0600 Unix socket 发送绑定完整 owner 身份的 HMAC 关闭请求，由 instance 自行收尾，supervisor 不向 adopted PID 发信号。server 异常退出则解除监督但保留 instance/ACP；PID 复用、记录损坏、认证失败或探测 I/O 失败都 fail closed。

### 3.3 instance 职责边界【审查：架构 P1-2 + 运维 P0-2】

instance 是 **dumb pipe**，但「不做协议理解」需精确化——缓冲分桶与转发要求最小协议面：

**允许的最小协议面（instance 侧唯一允许的 ACP 帧解析）**：
1. 双格式 sessionId 提取（原始 `{type,payload}` 与 JSON-RPC 包裹格式，与 §6.1 ACPChannel 双格式兼容规则一致）；
2. 按 chat 分桶 + 分配单调 `seq`；
3. 进程管理（spawn/kill/退出监控）与本地缓冲。

**禁止项**：不解析事件语义（不区分 delta/终态/工具）、不聚合、不写任何状态、不生成业务事件。

**无法提取 sessionId 的帧**：丢弃并记本地缺口计数（随 `instance/hello` 上报）。

**instance 进程本身崩溃**【审查：运维 P0-2】：
- 正常退出由 `shutdown_all` + `kill_on_drop` 终止 ACP 进程树；daemon 被 `SIGKILL` 时 Drop 无法运行，ACP 进程组可能残留。instance data-dir 持有非阻塞独占 owner lock；owner 记录保存 PID、出生指纹、endpoint、凭据摘要及可选 managed-local token id，供 local 接管核验。watermark 同时记录 data-dir `(dev,ino)` 与 ACP 进程组 leader 出生指纹；下次启动只在两者精确匹配时发 `SIGKILL`。旧记录、目录副本、PID/PGID 复用或指纹不可读都 fail closed 为不发信号，仍上报 `buffer_lost` 交给 server 对账；
- 内存缓冲与磁盘溢出缓冲**不跨重启保留**（重启后 `hello` 上报 `buffer_lost: true`）；
- 每 chat `seq` 计数器与 `stream_epoch` 绑定（daemon 重启后 epoch +1、seq 可重置，§4.5.1【顾问：P0-2】）。

---

## 4. 通信协议

### 4.1 传输与序列化

- WebSocket，文本帧，每条消息一个 JSON 对象。
- 序列化：控制帧（action/ack/error/instance.*/event/keep_alive/ready/pong/auth）用 serde_json；`ysync.*` 帧体为 y-sync 协议消息（`Y.encodeStateAsUpdate` / update diff），**base64 嵌入文本帧**（与 chat `broadcaster.ts` 的 `Buffer.toString("base64")` 一致）；固定 update 编码版本 v1。【审查：开发 P2→写为协议事实】
- 局域网默认 ws 明文；支持配置 TLS（wss）后置（M4）。**运维指引**：M1–M3 默认监听绑定 + 不可信网络禁用（见 §16 配置默认值）。

### 4.2 帧模型（单连接多路复用）

每条消息 `{ "t": <frame_type>, ... }`，按 `t` 分派。全量 tag 注册表（`proto` crate `FRAME_TAGS`，`Frame::parse` 据此区分「未知 tag」与「已知 tag 反序列化失败」）【v2.6 按实现补全】：

| `t` | 方向 | 载荷 | 说明 |
|-----|------|------|------|
| `action` | C→S | Action envelope（§4.3） | 控制命令，必须 Ack |
| `action_ack` | S→C | 两阶段 Ack（§4.4） | 每个 action 至多一个最终 Ack |
| `action_error` | S→C | 稳定错误码（§4.4） | 失败即返回，不静默 |
| `auth` | C→S | `{ token }` | 连接建立后的第一个帧；**角色由 token 解析，客户端不声明 role**【审查：开发 P2】 |
| `ready` | S→C | `{ projection_versions: {...} }` | 快照推送完成握手（§4.6）【审查：开发 P1】 |
| `keep_alive` | S→C | ping | 心跳 |
| `pong` | C→S | — | keep_alive 回执（§4.7）【审查：开发 P1】 |
| `ysync.subscribe` | C→S | `{ docs: ["chat:{cid}", ...] }` | 订阅指定 Doc 的更新（多 chat 视图必需）【审查：开发 P1】 |
| `ysync.unsubscribe` | C→S | `{ docs: [...] }` | 退订 |
| `ysync.update` | S→C（**单向**） | y-sync update（增量/快照，base64） | 状态变更传播；**客户端（面板）上行 update 一律拒绝**——server 是唯一写入者（§5.6），客户端无写权限、不持有写租约【顾问：P0-4】 |
| `ysync.sync` | 双向 | y-sync Step 1/2 消息 | 保留帧（不采用双向增量握手，§5.6；白名单外） |
| `ysync.awareness` | 双向 | y-protocol awareness | 保留帧（在线状态，未启用） |
| `event` | S→C | `{ chat_id, seq, frame }` | `events/subscribe` 推送（§4.3）【审查：开发 P1】；保留（action 面已定义，订阅流未启用） |
| `session_list` | S→C | `session/list` 查询回投 | agent 磁盘历史会话列表（§6.3；与 `session_catalog_sync` 的周期投影互补） |
| `prompt_status` | S→C | `session/prompt-status` 查询回投 | 持久会话的 prompt delivery 摘要（§5.3.1） |
| `mcp_servers` | S→C | `mcp/list` 查询回投 | 当前 runtime 安全 MCP 连接快照（无 URL/headers/raw error） |
| `mcp_oauth` | S→C | OAuth flow 状态 | `mcp/oauth-start`/`mcp/oauth-cancel` 结果通知（§6.2 `peri.oauth`） |
| `mcp_oauth_authorization` | S→C | 瞬时授权 URL | `mcp/oauth-authorization` 的短 TTL 回投（URL 只在线穿过，不落盘，§6.2） |
| `mcp_app_session` | S→C | MCP App open 元数据 | `mcp/app-open` 回投（appSessionId/resourceUri；HTML 不落盘） |
| `mcp_app_resource` | S→C | 瞬时 App HTML + 可选首屏 CallToolResult | `mcp/app-resource` 回投（对标 oauth authorization；不进 Yjs/SQLite/ring；`toolResult` 嵌套 `structuredContent`，禁止顶层键） |
| `mcp_app_call_result` | S→C | App `tools/call` 结果 | `mcp/app-call` 回投（瞬时 CallToolResult） |
| `rewind_candidates` | S→C | rewind 候选列表 | `chat/rewind-candidates` 回投（§6.2 rewind） |
| `rewind_preview` | S→C | 影响预览 + 确认指纹 | `chat/rewind-preview` 回投（§6.2 rewind） |
| `instance.*` | S↔M | instance 协议帧（§4.5） | server ↔ instance 专用（hello/heartbeat/event/buffer_sync/spawn/kill/forward/spawn_ack/kill_ack/forward_ack/process_exit） |
| `auth_response` | S→M | HMAC 证明（§9.2） | server 对 `instance/hello` 的身份应答（challenge nonce 的 MAC）【顾问2：P0-2】 |

【v2.6】查询类 action（`session/list`、`mcp/*`、rewind 三段、`session/prompt-status`）走 action/ack 通道携带 commandId，其**数据结果**经上表专用下行帧回投——帧是查询响应载体，不引入第二套 RPC 机制。

### 4.3 Action envelope 与方法面

参照 chat §7.1（Q9 修订）：客户端只发送 `commandId` 与 action 内容，信封其余字段由服务端按 chat 绑定补充与校验。

```jsonc
{
  "t": "action",
  "commandId": "uuid",          // 幂等键，同 chat 唯一；重试复用同一 ID（绝不可换 ID 猜测结果）
  "type": "chat/prompt",     // 见方法面
  "payload": { ... }            // 转发所需绑定字段（ACP session_id 等）由服务端注入，客户端字段不可覆盖 binding
}
```

Action 方法面（Server 对客户端；【v2.6】按 `proto` crate `ActionEnvelope` 实现补全，与 `whitelist` 白名单一致）：

**chat 运行时域**（一次 server/ACP runtime 的生命周期与交互）：

| type | payload | 说明 |
|------|---------|------|
| `chat/create` | `{ instance_id?, cwd?, title? }` | instance_id 缺省 = 本机（P5）；cwd 语义见下 |
| `chat/load` | `{ chat_id }` | 载入既有对话（转发 ACP `session/load`；转发前开启回放窗口，见 §8.6） |
| `chat/close` | `{ chat_id }` | 关闭并 kill 对应 ACP 进程（offline 时语义见 §7.6） |
| `chat/prompt` | `{ chat_id, message }` | 转发到目标 instance |
| `chat/session-new` | `{ chat_id, ... }` | 当前对话内新建 ACP 会话（进程内实体，不新建进程；等价 create 序列的 `session/new` 一步，committed ack 可携带新 `acpSessionId`） |
| `chat/cancel` | `{ chat_id }` | 转发 cancel（携带目标 sessionId，路由据此精确投递） |
| `chat/config-set` | `{ chat_id, config_id, value }` | 只允许当前 Agent `configOptions` 目录中的精确值；转发标准 ACP `session/set_config_option`（§6.2） |
| `chat/rewind-candidates` | `{ chat_id }` | 读取当前 Peri runtime 的有界 user-message 回退候选（§6.2 rewind） |
| `chat/rewind-preview` | `{ chat_id, ... }` | 读取候选的安全、project-relative 文件影响预览与确认指纹 |
| `chat/rewind` | `{ chat_id, preview_fingerprint, ... }` | 执行已预览确认的 rewind；fingerprint 必须原样来自同一 runtime 最新 preview |

**project / 持久会话域**（Web 侧目录：project 仍 SQLite 权威；会话目录 ACP `session/list` 权威，§3.0）：

| type | payload | 说明 |
|------|---------|------|
| `project/create` | `{ name?, cwd, instance_id? }` | 创建持久化 project。`cwd` 是 **该 instance 上的路径**。绑定 `kind=ssh` 时 `instance_id` 必填且该 instance 必须 Online；缺省仍表示 `local`（兼容）。SSH 目标禁止使用本机目录选择器 |
| `project/archive` / `project/restore` | `{ project_id }` | project 的可逆归档/恢复（`archived_at`） |
| `project/rename` | `{ project_id, name }` | 只更新展示名，不改变 id/cwd/instance binding |
| `session/create` | `{ project_id, ... }` | 在 project cwd 上 `session/new`；committed ack 的 `sessionId` = 新 ACP id，并刷新 list 缓存 |
| `session/open` | `{ sessionId }` | `sessionId` = ACP durable id；始终 `spawn + session/load`（无 SQLite `last_chat_id` 快路径）；已 `runtime_confirmed` 的同 id chat 可复用 |
| `session/rename` | `{ sessionId, name }` | **【v2.17 客户端】** IndexedDB `customName`；server 不持久化 |
| `session/archive` / `session/restore` | `{ sessionId }` | **【v2.17 客户端】** IndexedDB `archived`；不删除 ACP thread 或消息历史 |
| `session/import` | `{ sessionId?, project_id, acp_session_id, ... }` | **【v2.17 兼容 no-op】** list 已包含即已在目录；保留 duplicate ack |
| `session/discover` | `{ project_id }` | 刷新某 project 的 ACP `session/list` 缓存（冷启动入口，§3.0 discovery） |
| `session/prompt-status` | `{ sessionId }` | 读取 ACP durable session 的安全 prompt delivery 摘要（§5.3.1）；`sessionId` = ACP id |

**machine 域**（【v2.16 已落地】SQLite `machines` 权威；live 连接仍只来自 hello。`committed` 与 `project/*` 同为 SQLite+Registry 屏障，**不是** ACP stdin。域错误在投影 `machines.errorCode`；wire `action_error.code` **只**用 §4.4 既有 `ErrorCode`。完整契约见 [ssh-machine-mount.md](design/ssh-machine-mount.md)。**本表与 `ActionEnvelope`+whitelist 必须同 PR 落地。**）：

| type | payload | 说明 |
|------|---------|------|
| `machine/add` | `{ destination, displayName?, port?, identityFile? }` | 未归档 destination+port 唯一；`committed` 带 `instanceId`，不表示 Online |
| `machine/connect` | `{ instanceId }` | 重建 `-R :0` 隧道；远端已有 owner lock 则不得再 start |
| `machine/disconnect` | `{ instanceId }` | 只拆本机隧道；远端 connect/ACP 保留 |
| `machine/stop` | `{ instanceId }` | SSH exec owner shutdown + kill ACP；结果不清 → `DELIVERY_UNKNOWN` |
| `machine/cancel` | `{ instanceId }` | 未 start 则停管道；已 start → `DELIVERY_UNKNOWN` |
| `machine/retry` | `{ instanceId }` | 仅 `failed`；新 commandId；同 `instance_id` |
| `machine/trust-host` | `{ instanceId, fingerprint }` | 与 pending 指纹逐字节相等后写入 Peri known_hosts |
| `machine/rename` | `{ instanceId, name }` | 展示名 |
| `machine/set-auto-reconnect` | `{ instanceId, enabled }` | 默认 true；false 则 studio 启动不自动建隧道 |
| `machine/remove` | `{ instanceId }` | 必须已 Stop 且无非终态 runtime；然后归档并吊销 token |
| `machine/restore` | `{ instanceId }` | 墓碑恢复同一 `instance_id` 并新签发 token |

**权限 / 追问 / 查询 / MCP / 兼容域**：

| type | payload | 说明 |
|------|---------|------|
| `permission/resolve` | `{ chat_id, permission_id, decision }` | 权限应答（CAS 校验通过后才下发，见 §7.4） |
| `elicitation/respond` | `{ chat_id, elicitation_id, ... }` | 回答 ACP form elicitation（只接受 Hub 已投影的有界字段，§6.2） |
| `session/list` | `{ chat_id }` | 查询指定对话的 ACP 会话列表（server 解析 `(instance_id, cwd)` 后发 ACP `session/list` RPC，结果经 `session_list` 帧回投） |
| `mcp/list` | `{ chat_id }` | 查询当前 runtime 的安全 MCP 连接快照 |
| `mcp/oauth-start` / `mcp/oauth-authorization` / `mcp/oauth-cancel` | `{ chat_id, flow_id? }` | MCP OAuth flow 的启动 / 读瞬时授权 URL / 精确取消（§6.2 `peri.oauth`） |
| `workspace/create` / `workspace/remove` | `{ workspace_id?, cwd, name? }` | **legacy 兼容面**：由 `WorkspaceCompatibility` 适配到 project 权威写入与 Registry mirror（§3.0），新客户端不得使用 |
| `events/subscribe` | `{ chat_id?, from_seq? }` | 原始 ACP 事件订阅（保留帧面，§4.3.1） |

**cwd 语义裁决**【审查：开发 P2】：客户端可指定 `cwd`，server 校验其合法性并注入默认值（未指定时用已认证上下文默认目录）；`Translator` 出站时始终由 server 按已认证上下文注入最终 `cwd`（§6.1 同源），客户端字段不可越权。

#### 4.3.1 events/subscribe 订阅契约【审查：开发 P1】

- `events/subscribe { chat_id?, from_seq? }`：`from_seq` 缺省 = 实时起（不重放历史）；带 `from_seq` 则从该序号起推。
- `events/unsubscribe { chat_id? }` 退订。
- 推送帧：`{ "t": "event", chat_id, seq, frame }`（frame 为规范化事件，chat_id 为 hub 侧 id，经 binding 翻译——不透传原始 ACP session_id）【审查：架构 P2-3】。
- 无权限 chat 的订阅 → `FORBIDDEN`。
- **双流顺序契约**：视图收敛以 yjs 为准，事件流尽力而为（背压时允许丢弃），双流之间无顺序契约。

### 4.4 Ack 与错误码

参照 chat §7.1：`accepted` 只表示进入有界处理队列。`committed` 的业务事实因域而异：

- **chat / ACP 域**（prompt、spawn 路径上的 session/new 等）：命令已写入 ACP stdin 且 ACP 已确认接收（无投影落盘屏障，见 §8.4）。
- **元数据域**（`project/*`、【v2.16】`machine/*` 的 admit/rename/remove 等）：SQLite 提交与 Registry 投影屏障已越过。`machine/add` 的 committed **不**表示远端 instance Online；管道进度只走 `machines.phase`。
- **会话目录域**（`session/create|open|discover` 等含 ACP 副作用）：按 chat/ACP 域规则（§4.4 第一段）；list 缓存刷新不经 SQLite 屏障。

越过非幂等外部副作用（远端 `connect` start、ACP stdin）且无法证明未发生时，仍必须 `DELIVERY_UNKNOWN`，禁止自动重放。

```jsonc
// action_ack
{ "t": "action_ack", "commandId": "uuid", "status": "accepted" | "committed" | "duplicate",
  "turnId?", "chatId?", "committedProjectionVersion?" }
//  - chatId：chat/create 的 committed 必须携带（server 生成 id 的唯一告知路径）【审查：开发 P1】
//  - committedProjectionVersion：字段预留（对齐 chat types.ts，乐观并发校验二期启用）【审查：开发 P1】

// action_error
{ "t": "action_error", "commandId": "uuid",
  "code": "UNAUTHENTICATED" | "FORBIDDEN" | "CHAT_NOT_FOUND" | "INSTANCE_OFFLINE"
        | "VERSION_CONFLICT" | "INVALID_STATE" | "RATE_LIMITED" | "AGENT_UNAVAILABLE"
        | "DELIVERY_UNKNOWN" | "PAYLOAD_TOO_LARGE" | "UNSUPPORTED_FRAME",
  "message": "脱敏信息", "retryable": boolean, "retryAfterMs?" }
//  - DELIVERY_UNKNOWN【v2.6 补列入表】：非幂等命令可能已产生外部效果但结果无法确认；
//    客户端不得自动重放、不得降级为「确定未发送」，必须等待投影恢复或用户显式裁决（§4.4 delivery_unknown 裁决）
```

**commandId 去重（server 内存 command outbox）**【审查：架构 P0-1 + 开发 P0-4 + 顾问 P0-1】：

- **去重记录必须移出 Y.Doc，由 server 的内存 command outbox 持有**【顾问：P0-1】。理由：去重要防的是 **ACP 进程的外部副作用**，而 Y.Doc 是可丢弃的实时镜像（§8.1 原则 5）——视图重建 ≠ 去重事实重建。outbox 是**纯内存状态机**（按 chat 分片，`commandId → {type, turnId, status, dispatched_at}`，§8.4：无 outbox.log、无 fsync）。
- 去重表 = outbox 的内存索引：每 chat 进程内 Map<commandId, 记录>，启动即空（**不从任何日志重放重建**）；**committed 记录删除的唯一时机 = 显式清理策略**（如 chat 关闭后清理）。P8 × P3 交集不再由 outbox 跨 server 重启成立——命令从不重新发送，以 ACP 现场为准（§8.4.1）。
- 已提交命令重发返回原 Ack（`duplicate`）与 `turnId`，不重复调用 Agent；执行失败（`AGENT_UNAVAILABLE` 等 retryable 错误）清除 outbox 记录，允许重发重新执行。
- **turnId 生成规则**：由 server 生成（uuid）；同 `commandId` 重试复用同一 `turnId`（从 outbox 读取），新 `commandId` 产生新 `turnId`。

**delivery_confirmed 三级定义**【顾问：P0-1】（`committed` 的强度依据，内部实现语义，不暴露给客户端）：

| 层级 | 含义 | 达成条件 |
|------|------|---------|
| L1 ws 传输确认 | 指令帧已送达 instance | instance 收到下行指令并返回对应 `instance/*_ack`（spawn_ack/kill_ack）或对 prompt/cancel/resolve 的转发确认 |
| L2 stdin 写入确认 | instance 已将指令完整写入 ACP 进程 stdin | instance 侧写成功（字节级确认；ACP 子进程退出写失败 → 上报失败） |
| L3 ACP 接收确认 | ACP 进程已受理（JSON-RPC 请求已发出且未被连接错误拒绝） | instance 转发 ACP 的响应/错误帧（含 JSON-RPC error 也算受理，业务失败走 `action_error`） |

M1 实现 L1+L2 合并（instance 在转发确认中隐含写成功）。`chat/prompt`
还必须等待 L3；`chat/cancel` 是无 JSON-RPC `id` 的 ACP notification，没有
L3，因此以 instance writer 的 `forward_ack(ok=true)` 作为投递确认。Hub 外层
`InstanceForward.commandId` 仍携带稳定 action commandId 以路由这次 ACK，但
不得把该 id 注入 ACP notification body。

**outbox 记录状态机**【顾问2：P0-1】（每条 outbox 记录唯一的状态机迁移路径；内存态，§8.4；任意崩溃点不得产生默认重复投递）：

```
received → accepted → intent_durable → dispatching* → dispatched → delivery_confirmed
   │           │              │              │             │             │
   │           │              │              └─────────────┴─────────────┴─► delivery_unknown
   │           │              └─► failed_not_delivered（明确未越过外部副作用屏障）
   └───────────┴──► failed（终态）
delivery_confirmed → projection_committed → completed（终态）
                   └─► delivery_unknown（投影提交证据不完整）
```

`dispatching*` 是兼容旧 reader 的有效状态：记录仍编码为 `intent_durable`，但
`dispatch_barrier_at` 已经置位。它必须在帧进入 instance writer **之前**完成状态迁移；
从这一屏障起，任何无法证明“未送达”的失败都禁止自动重发（§8.4：屏障为内存状态，无 fsync）。

**delivery_unknown 裁决**【顾问2：P0-1】（L3 依赖 peri ACP 关联 ID 能力，M1 前必须裁决，二选一）：

- **路径 A（peri ACP 支持关联 ID）**：ACP 请求携带/回传稳定关联 ID（commandId 或映射 ID），可查询处理状态 → 恢复时依据关联 ID 判定「未接收 / 已接收未完成 / 已完成」后决定重试；L3 定义查询路径并固定映射。
- **路径 B（不支持）**：L2 后未取得 L3 一律进入内存 `delivery_unknown`——**非幂等命令（prompt/cancel/permission/resolve，以及可能已经执行 `session/new` 的 create）禁止自动重试**，直至可观测状态对账或人工裁决完成。close 可按 chat_id 幂等恢复；create 只有在 spawn 明确拒绝，或尚未进入 `session/new` 且同 chat 的 kill Ack 精确证明 runtime 已不存在时，才允许安全重试。
- **M1 决策门禁（非开工门禁）**【顾问2 + 顾问3】：与 peri ACP 核实 prompt/cancel/permission 的关联 ID 能力；**开工不等待此确认，M1 默认按路径 B 实现**（路径 A 是强化项）；**M1 功能完成/发布前**必须给出结论——支持则启用路径 A，不支持则正式接受并验证路径 B（人工裁决运营成本达标）。【顾问3】
- **幂等性分类默认**【顾问3】：所有命令进入 outbox 前必须显式标记重试类别（可安全重发 / 不可自动重发）；**未分类命令默认禁止自动重发**；新增命令类型必须走同一分类流程，不得绕过。
- **路径 B runbook 要点**【顾问3】：`delivery_unknown` 必须可查询、可展示（内存态；重启即空，命令状态以 ACP 现场为准，不静默丢弃——§8.4.1）；人工裁决入口与权限定义：谁能裁决（server 操作员）、依据哪些可观测状态（agent 状态查询/进程存活/用户确认）、裁决结果迁移——「确认已送达」→ completed、「确认未送达」→ 清除记录允许重发、「仍未知」→ 保持 delivery_unknown；每次裁决留审计记录（§9.4 结构化日志）。

**崩溃窗口 × 重试行为**【顾问：P0-1】（§无状态投影修订：outbox 纯内存、重启即空，命令**从不重新发送**，以 ACP 现场为准）：

| 场景 | 行为 |
|---|---|
| 崩溃窗口内已发送未确认命令 | **不自动重试**。Web 显示不确定态，命令状态以 ACP 实际执行为准（用户观察现场） |
| `delivery_unknown` | 从「持久化裁决 + 人工 runbook」简化为「展示 ACP 现场状态」，无持久化记录（裁决迁移仍见上） |
| 同 commandId 重发 | 进程内仍按去重索引返回 `duplicate`；**跨重启不再有去重保证**（官方 ACP 协议无 commandId 字段）——依赖「不重发」策略，客户端手动重试 prompt 可能重复执行为已接受边缘风险 |

**重试分类**（【v2.6】对齐 `ErrorCode::default_retryable` 事实源）：`AGENT_UNAVAILABLE` / `INSTANCE_OFFLINE` → `retryable=true`（可自动重试，须复用同一 commandId）；`INVALID_STATE` / `FORBIDDEN` / `CHAT_NOT_FOUND` / `DELIVERY_UNKNOWN` 及其余确定性拒绝 → `retryable=false`（重试不会改变结果）。

- **提交点纪律（prompt-delivery-v2，§无状态投影修订）**：Hub 在任何外部副作用前先建立 `delivery_state=pending` 的 user entry（内存 outbox 状态机，§8.4：不落盘），并在 entry 与 outbox 中保存同一 canonical fingerprint。顺序不可倒置：**outbox accepted → Pending user entry 建立 → intent/fingerprint 入 outbox → dispatch barrier（intent_durable 置位）→ 下发 ACP → instance 写入确认（dispatched）→ L3 返回（delivery_confirmed）→ turn 与 user entry 终态投影 → projection_committed → completed Ack**。Pending 只证明正文已进入内存态，不证明 ACP 已收到；越过 dispatch barrier 后缺少精确终态证据必须进入 `delivery_unknown`，不得把展示投影当成可安全重发的依据。
- 错误码 `VERSION_CONFLICT` 与开放问题 4 对齐：**保留字段语义，M1 不强制校验**（见 §14 开放问题 4）【审查：架构 P2-9】。

### 4.5 Server ↔ instance 协议

**Server 下发**（下行指令均携带 `commandId`；以 `chat_id` 为天然幂等键——server 可安全重发）【审查：架构 P1-4 + 开发 P0-3/P0-4】：

| 方法 | 参数 | 说明 |
|------|------|------|
| `instance/spawn` | `{ command_id, chat_id, cmd, cwd, env? }` | 启动 ACP 进程；**按 chat_id 幂等**（已存在返回现有句柄，不二次起进程）；`env` 受 server 白名单约束（§9.5）【顾问：P1-7】 |
| `instance/kill` | `{ command_id, chat_id, grace? }` | 停止 ACP 进程；**幂等**（已死成功返回） |
| `instance/forward` | `{ command_id, chat_id, frame }` | 透明转发 JSON-RPC（initialize / session/new / session/prompt / session/cancel / session/load / session/list / permission resolve 等）；instance 不解析语义，只写入目标进程 stdin【v2.6 显式入表】 |

**Instance 上报**：

| 方法 | 参数 | 说明 |
|------|------|------|
| `instance/hello` | `{ token, hostname, caps, buffered?, buffer_lost?, stream_epochs?, nonce }` | 注册 + 重连握手；**幂等替换语义**——新 hello 到达即 fencing 旧连接（旧连接事件丢弃、关闭）【审查：架构 P1-4】；`buffer_lost` 上报 daemon 崩溃缓冲丢失（§7.5）【审查：运维 P0-2】；`stream_epochs` 为 per-chat 流纪元映射（§4.5.1）【顾问：P0-2】；`nonce` 用于 server 身份证明（§9.2） |
| `instance/heartbeat` | `{ load, alive_sessions }` | 周期心跳（默认 5s） |
| `instance/event` | `{ chat_id, epoch, seq, frame }` | 原始 ACP 帧转发（**带 instance 侧单调 seq 与流纪元**）【审查：开发 P0-3】【顾问：P0-2】 |
| `instance/buffer_sync` | `{ chat_id, epoch, from_seq, frames[] }` | 断线缓冲补推（frames 每帧带 seq；epoch 由 server 回传校验，见 §4.5.1） |

`seq` 覆盖 instance 从子进程收到的每一帧，而不只覆盖会写入 Yjs 的业务事件。
因此 JSON-RPC response、已识别但不投影的通知，以及语义校验后被丢弃的帧，
仍须在该 chat 的单写者中推进 transport 水位；它们继续进入独立的 dropped
诊断，但不得伪装成传输缺口。只有未到达 server 的序号（例如 instance
单帧超限跳过或真实缓冲丢失）才产生 `gap`。无 Doc writer 的私有发现进程只
完成 RPC 匹配，不创建伪 chat 水位。
| `instance/spawn_ack` | `{ command_id, chat_id, ok, error? }` | spawn 结果（成功/失败+脱敏原因）【审查：开发 P0-3】 |
| `instance/forward_ack` | `{ command_id, chat_id, ok }` | forward 写入 ACP stdin 的结果（L1+L2 合并确认，§4.4；prompt/cancel 等的 writer 回执）【v2.6 显式入表】 |
| `instance/kill_ack` | `{ command_id, chat_id, ok }` | kill 结果 |
| `instance/process_exit` | `{ chat_id, code }` | ACP 进程退出事件（含退出码；`crashed`/`ended` 状态由此驱动）【审查：开发 P0-3】 |

**buffer_sync 起点（from_seq）**【审查：开发 P1】：server 在内存维护 per-chat `last_seq`（§8.4：不落盘、重启即空）；重连后 `from_seq` 由 instance 按本批首帧给出（§8.5），server 校验 `(epoch, from_seq)` 连续性。**instance 保留环形滑窗**（最后 500 条，覆盖 server 崩溃前已收未投递段）作为兜底：instance 重连后自动重发 pending 缓冲。

#### 4.5.1 stream_epoch（流纪元）【顾问：P0-2】

`stream_epoch` 是 instance 侧 per-chat 的**流代际标识**：instance 为每个 chat 的 ACP 输出流维护一个纪元号，**daemon 重启或 ACP 子进程重建时 +1**（chat 新开为 1）。它解决「补推边界无法区分旧流残余与新流开始」的歧义：

- **epoch 相同**（同一代际）：server 在内存维护 `(epoch, last_seq)`（§8.4：不落盘），补推按 from_seq 连续追平；
- **epoch 变化**（daemon 崩溃重启 / 进程重建）：旧流 seq 空间作废，**server 判定该 chat 产生不可校准缺口**——chat 保持 `interrupted` + `gap`（uncalibratable），不尝试按 seq 补推旧流；若 chat 已终止（ended/closed）则无需处理；
- server 在内存维护 `(epoch, last_seq)` 对（§8.4：随内存 outbox 重启即空）；`instance/buffer_sync` 回传 epoch，与 server 记录不一致即拒绝该批（防旧纪元缓冲混入新纪元流）；
- `instance/event` 携带 epoch：epoch 与 server 记录不一致的帧直接丢弃并计数（防御性，正常路径下 hello 已对账）。

### 4.6 连接建立时序（快照先于操作）

参照 chat §4.1（Q13 实现差异：不采用 y-sync 增量握手，先推全量快照）：

1. 连接配额检查 → `auth`（token）→ 授权解析（角色/可访问 chat 集合）。【v2.6】浏览器面板不走 `auth` 帧：先经同源 HTTP `/api/auth/session` 建立 HttpOnly cookie 会话（§3.0），ws 升级与存量连接按心跳复验 token id/撤销状态；instance 走 `instance/hello` + `auth_response` HMAC 双向认证（§9.2）。
2. 按订阅清单（`ysync.subscribe`）打开/恢复 Chat Doc、Control Doc 与 Registry Doc（首个客户端注册广播监听）。
3. 推送各 Doc 的**全量快照**（`ysync.update` snapshot，携带各 Doc 的 `projection_version`）【审查：开发 P1】。
4. 发送 `ready` 握手（含 `projection_versions`，远端据此判断是否需要校准显示）→ 置 `relayReady = true` → flush 缓冲的 Action。

约束：`relayReady` 前到达的 Action 进入有界缓冲，不处理；`relayReady` 前 UI 可读本地缓存，但不得视为在线可写。建立失败用**终态关闭码**区分是否重连（§4.7），不得静默降级。

### 4.7 keep_alive 心跳与关闭码

参照 chat §11：服务端周期性下发 `keep_alive`，客户端以 `pong` 回执；超时未回以 4501 关闭（页面隐藏等场景不在后台自动重连）。

| 关闭码 | 触发条件 | 客户端行为 |
|--------|---------|-----------|
| 4500 | 实例离线（`INSTANCE_OFFLINE`） | 停止自动重连，展示手动重试 |
| 4502 | 配置性永久失败（spawn 配置错误等） | 停止自动重连 |
| 4501 | keep_alive 超时 | 不在后台自动重连 |
| 1011 / 1013 | 通用失败 / 连接配额超限 | 退避重连 |

> 4004 已删除【审查：架构 P2-5】：chat 的 4004 对应「environment 不存在」，peri-studio 无此概念；不可恢复场景统一归 4502。

**判定性时间戳权威**【审查：架构 P2-4】：expiresAt（权限 5min）、心跳 30s 判定、取消 10s 超时等判定性时间戳**统一由 server 单一权威时钟生成与判定**；instance 只上报相对时序（seq），不参与判定。

### 4.8 MVP-M1 帧集收窄（minimal IDL）【顾问：P1-6】

§4.2 的帧模型是完整面；M1 只实现最小帧集，其余帧在对应里程碑才进入 IDL。`peri-studio-proto` 以「帧集白名单」形式定义：未列入白名单的 `t` 一律返回稳定错误（`UNSUPPORTED_FRAME`）并计数，不静默。

**【v2.6】白名单已随实现演进**：`whitelist::M1_ACTION_TYPES` 从原 M1 五种（chat/create、chat/prompt、chat/cancel、chat/close、permission/resolve）扩展为 §4.3 方法面的**全部已实现 action**（project/*、session/*、chat/* 全域、elicitation/respond、workspace 兼容面、session/list、mcp/*）；`chat/load` 已按 §8.5 会话内切换语义启用。客户端↔server 帧面白名单现为：`action` / `action_ack` / `action_error` / `auth` / `ready` / `keep_alive` / `pong` / `ysync.subscribe` / `ysync.unsubscribe` / `ysync.update`（S→C 单向）。`event` / `ysync.sync` / `ysync.awareness` 仍为白名单外保留帧。原 M1 收窄裁决保留如下，作为白名单机制的出处：

| M1 帧集（client ↔ server） | 说明 |
|---------------------------|------|
| `action`（chat/create、chat/prompt、chat/cancel、chat/close、permission/resolve） | events/subscribe、chat/load 帧**不进 M1**（chat/load 由 M2 载入；events/subscribe 由 M3） |
| `action_ack` / `action_error` | 完整错误码面保留，帧本身即 M1 面 |
| `ysync.subscribe` / `ysync.unsubscribe` / `ysync.update`（S→C 单向） | 状态同步面 |
| `ready` / `keep_alive` / `pong` / `auth` | 连接生命周期面 |

| M1 帧集（server ↔ instance） | 说明 |
|---------------------------|------|
| `instance/hello` / `instance/heartbeat` / `instance/event` / `instance/buffer_sync` / `instance/spawn` / `instance/kill` / `instance/spawn_ack` / `instance/kill_ack` / `instance/process_exit` | 全量（M1 即完整 instance 面） |

**M1 测试向量清单**【顾问：P1-6】（固化进 proto crate 的契约测试，见 §12）：

1. 连接握手：`auth` 错误 token → 断开；`ready` 前 Action 缓冲、`ready` 后 flush；
2. 幂等：同 `commandId` 重发 prompt → `duplicate` + 原 turnId；重发 cancel → `duplicate`；permission 重复应答 → `duplicate`；
3. 重放：同一 `instance/event` 流补推两次 → 视图无重复 entry/toolCall（§6.3 幂等键）；
4. 终态守卫：cancelled 后晚到 delta 丢弃；interrupted 后带序依据终态事件恰一次校准；
5. 崩溃恢复：kill -9 server → instance 缓冲 → 重启 → buffer_sync 追平（含 epoch 相同/变化两分支）；
6. 帧集白名单：未知 `t` → `UNSUPPORTED_FRAME`；客户端上行 `ysync.update` → 拒绝；
7. delivery_unknown【顾问2】：L2 后崩溃且无 L3 → 非幂等命令禁止盲重试（路径 B）；路径 A 的关联 ID 查询分支；
8. 双向认证【顾问2】：重放旧握手报文 / 错误角色 / 过期 challenge / 未知 instance 身份 → 拒绝并关闭连接 + 审计计数；
9. 错误脱敏【顾问2】：错误回显与日志在截断前剔除命令参数/env 值/认证材料；
10. outbox 内存态【顾问2】：无归档机制（§8.4）；未裁决 outbox 记录仅存于进程内存，跨重启不保留、不重发（§8.4.1）；
11. delivery_unknown 重启语义【顾问3】：跨进程重启注入——L2 已确认、L3 未确认 → 重启后内存态清空，命令**不自动再次投递**（§8.4.1）；客户端手动重试 prompt 可能重复执行（已接受边缘风险）；
12. HMAC 字节级向量【顾问3】：给定 nonce/context/version/role 的期望 MAC 输出；旧 challenge 重放、跨连接重放、错误角色、错误版本、过期 challenge、未知身份 → 拒绝并关闭。

---

## 5. 数据模型（Y.Doc schema）

### 5.1 核心裁决：规范化聚合视图而非原始事件

**ACP 事件经 ACPChannel 规范化为统一事件后，由聚合器有损投影到 Y.Doc；原始事件不进 Y.Doc。**（用户裁决 + chat §2.1 原则 6：「流式增量可丢、最终状态不可丢」）

依据：

1. ACP 事件是海量高频追加流（token 流、工具调用、中间消息），进 CRDT 文档必然膨胀到不可用；聚合是有损、有界的。
2. 聚合视图 = 多端视图客户端真正消费的形态；面板不关心原始事件序列，只关心「当前 chat 长什么样」。
3. 需要完整事件流的客户端（IDE 类）走 `events/subscribe`，不经 yjs，协议语义不被污染。
4. CRDT 的并发合并能力只对「小、低频、多端一致」的数据有意义——视图对象恰好是这个形状。

### 5.2 文档拆分（chat §5.1）

| Doc | 名称 | 内容 | 更新频率 |
|-----|------|------|---------|
| Chat Doc | `chat:{chat_id}` | 消息时间线、内容块、工具调用、turn 投影 | 高频（内容流） |
| Control Doc | `session:{chat_id}`（控制状态 Doc；`DocId::session`，术语表 §2.3）【v2.6 修正命名】 | 对话元信息、Agent 状态、能力、活动 turn、权限请求、agent 磁盘历史会话列表 | 低频（控制状态） |
| Registry Doc | `hub:registry` | instance 列表 + project/project_session 目录投影 + **活跃 chat 摘要列表**（全局视图，peri-studio 特有；schema v2） | 低频 |

拆分理由（chat §5.1 同源）：**隔离高频内容流与低频控制状态**，降低订阅与同步成本。三份 Doc 都是 ACP 进程运行态的实时镜像，不是持久化恢复源；跨文档更新按 ACP 会话内事件顺序应用，不依赖跨 Doc transaction。

**chats 投影位职责裁决**【审查：架构 P1-5】：

- **Registry Doc `chats`** = 侧栏对话列表的**唯一权威源**：活跃 chat 摘要（id/instance_id/title/status/gap/updated_at），由 **server 状态源单写**（chat 生命周期事件驱动：create/binding/终态/close 时更新），不从 Control Doc 聚合。
- **Control Doc `sessions`** = 该 ACP 进程的**磁盘历史会话列表**（`session_list` 10s 轮询投影，chat §5.3 语义在本架构下的正确对应——每 chat 一进程，返回的是 agent 侧历史），供 `chat/load`/resume 历史浏览，与 Registry 的活跃 chat 摘要**语义不同、互不替代**。
- §15 映射表该行标注差异（非「同构」）。

### 5.3 Chat Doc schema（chat §5.2）

结构版本 `CHAT_DOC_SCHEMA_VERSION = 1`（真相来源以 `peri-studio-proto` 实现为准）：

```rust
struct ChatDocRoot {
    schema_version: u32,
    projection_version: u32,        // 每次成功投影 +1；与 schema_version 分离（chat §5.4）
    entry_order: Vec<String>,       // Y.Array<String>，与 entries 分离便于局部更新/未来分页
    entries: Map<String, ChatEntry>,
    tool_calls: Map<String, ToolCallProjection>,
    // 无 committed_commands：去重记录在 server command outbox（§4.4），不随 Doc 生命周期存亡【顾问：P0-1】
}

struct ChatEntry {
    entry_id: String,               // 派生规则：`{turnId}:user` / `{turnId}:assistant` / tool: 按 toolCallId
    turn_id: Option<String>,
    kind: Message | Tool | System,
    role: User | Assistant | System,
    status: Pending | Streaming | Completed | Cancelled | Error,
    author_user_id: Option<String>,
    source_command_id: Option<String>, // Hub browser prompt correlation; ACP replay/legacy entries are None
    created_at: String,
    completed_at: Option<String>,
    block_order: Vec<String>,       // Y.Array<String>
    blocks: Map<String, ContentBlock>,
    error: Option<PublicError>,     // 脱敏公开错误，不含内部细节
}

enum ContentBlock {
    Text { block_id, text },                          // 流式文本用 Y.Text
    Reasoning { block_id, text, visibility: Summary },  // hidden 不写入浏览器共享 Chat Doc
    ToolCall { block_id, tool_call_id },
    Resource { block_id, resource_id, media_type, name },        // 只存引用，不嵌入内容
}

struct ToolCallProjection {
    tool_call_id: String,
    turn_id: String,
    name: String,
    kind: Read | Edit | Delete | Move | Search | Execute | Think | Fetch | SwitchMode | Other,
    status: Pending | AwaitingPermission | Running | Completed | Error | Cancelled,
    arguments: Option<Value>,       // 过滤内部/敏感字段后投影
    arguments_omitted: Option<bool>,
    arguments_bytes: Option<u64>,
    content: Option<Value>,         // ACP 可展示 content；增量 chunk 有界追加
    content_omitted: Option<bool>,
    content_bytes: Option<u64>,
    locations: Option<Value>,       // ACP 权威位置证据
    locations_omitted: Option<bool>,
    locations_bytes: Option<u64>,
    result: Option<Value>,          // 仅在公开投影预算内保留
    result_omitted: Option<bool>,   // true=省略，false=明确未省略，None=旧记录未知
    result_bytes: Option<u64>,      // Hub 观测到的紧凑 JSON 字节数；不含内容
    public_error: Option<PublicError>,
    permission_id: Option<String>,
    started_at: Option<String>,     // Hub 观测时间；旧快照可空
    completed_at: Option<String>,
}
```

物理映射：根对象/`entries`/`blocks`/`tool_calls` 用 `Y.Map`；顺序索引用 `Y.Array<String>`；流式文本用 `Y.Text`（避免每个 token 替换完整字符串）；删除采用领域 tombstone，不由客户端物理删除权威记录。

`source_command_id` 是 schema v1 的 additive optional extension，不提高根
`schema_version`：旧快照/ACP 回放条目按缺失读取，旧客户端忽略未知键。只有 Hub
在 `chat/prompt` 的服务端单写注册路径写入；同 turn 重放可补齐缺失值，但不同已存值
属于关联冲突，必须拒绝覆盖并进入 delivery-unknown 处置。

`user_entry_by_turn` 是服务端内部加速结构（turn→entry 二级索引，根级
`Y.Map<String>`，§P1-6）：客户端投影**不得读取**该键（web 投影只读白名单键
`entry_order`/`entries`/`tool_calls`/`schema_version`/`projection_version`）。
其存在性由 Factory `ensure_structure` 补齐 + 写路径
（`create_user_entry`/`create_pending_prompt_entry`）维护，与 `schema_version`
解耦——索引缺失时查询回落全量扫描、语义等价，故不参与 schema_version bump；
只读查询（聚合器 judge）不回填索引，自愈依赖写路径命中分支。

### 5.3.1 Logical session prompt recovery provenance

【v2.17】删除 SQLite `session_runtime_history` 与 `session_activations`；prompt 恢复 provenance 仅以 **per-chat 内存 outbox** 与 Chat/Session Doc 为权威。`session/prompt-status` 是认证后的只读查询，client 提交 wire `sessionId`（= ACP durable id），相关 chat id 由 server 从 `ChatRegistry` binding 与 catalog 运行态解析，不能被任意探测。

查询以 per-chat outbox 为 delivery authority，以 Chat/Session Doc 为 projection
authority，只公开 command/turn id、安全时间、稳定错误码和
`projected|completed|failed|delivery_unknown`。响应永远带
`runtimeRestored=false`；历史 store/投影缺失或损坏时必须带
`evidenceIncomplete=true`，空列表不得解释为没有未决消息。结果最多 200 条，
截断时未决状态优先保留。完整契约见
[`docs/design/prompt-recovery-provenance.md`](design/prompt-recovery-provenance.md)。

### 5.4 Control Doc schema（chat §5.3）

【v2.6】实现类型名 `SessionDocRoot`（`SESSION_DOC_SCHEMA_VERSION = 1`），DocId 为 `session:{chat_id}`（§5.2）；「Control Doc」为本节语义称呼：

```rust
struct SessionDocRoot {
    schema_version: u32,            // 旧快照恢复时以版本判空幂等补结构
    projection_version: u32,
    chat: ChatInfoProjection, // chat_id/title/status/active_turn_id/loading/created_at/updated_at；loading 由 server 按 active turn 非终态统一投影，前端不得从 entry/tool 状态自行推断
    agent: AgentStatusProjection,   // instance/session/status/extensions/commands/usage + bounded safe activities + optional input prediction
    active_turn: Option<ActiveTurnProjection>,  // turnId + turnStatus + updatedAt —— 权威；同时驱动 chat.loading
    pending_permissions: Map<String, PermissionProjection>,
    sessions: Map<String, SessionSummaryProjection>,  // agent 磁盘历史会话列表（10s 轮询全量同步，旧条目删除自愈）——与 Registry Doc chats 语义不同（§5.2）
}

struct PermissionProjection {
    permission_id: String,
    turn_id: String,
    tool_call_id: Option<String>,
    title: String,
    description: Option<String>,
    options: Vec<AllowOnce | AllowSession | Deny>,
    status: Pending | Resolved | Expired,
    expires_at: String,             // server 权威时钟生成（§4.7）
    decision: Option<Allow | Deny>, // CAS 迁移成功后写入；expired 保持 null
}
```

### 5.5 Registry Doc schema（peri-studio 特有）

【v2.6】schema v2：`projects` / `project_sessions` / `workspaces`。【v2.16】schema v3 增加 `machines`（SQLite 挂载意图的只读广播；`instances` 仍只反映 live hello/心跳）。【v2.17】Registry `project_sessions` 段键为 ACP `session_id`，内容自 ACP list 内存缓存投影，不再对应 SQLite 行。旧客户端忽略未知键。

```rust
struct RegistryDocRoot {
    schema_version: u32,           // = 3（v2.16；实现前代码仍为 2）
    instances: Map<String, InstanceView>,   // id/hostname/status(online|offline|unknown)/token_id
                                          // /registered_at/last_heartbeat/chat_count
    chats: Map<String, ChatSummary>,
    projects: Map<String, ProjectSummary>,
    project_sessions: Map<String, ProjectSessionSummary>,
    workspaces: Map<String, WorkspaceSummary>,
    machines: Map<String, MachineSummary>, // instance_id 键；kind/displayName/sshDestination/sshPort/
                                          // phase/errorCode/hasIdentityFile/autoReconnect/
                                          // hostKeySha256（仅 awaiting_host_key）/updatedAt/archivedAt
                                          // 禁止：identity 路径、token、known_hosts 行
    global: { status: Healthy | Degraded | Restarting },
}
```

### 5.6 写入边界与隔离

- **唯一提交边界 = DocManager**【审查：架构 P1-3 + 开发 P0-2】：所有 Y.Doc 写入（聚合器投影、控制面状态迁移如 cancelling/interrupted/decision/标题、定时器 CAS）都必须经 DocManager 的进程内单写通道（§7.4 每 chat 单写者）；任何路径不得绕过 DocManager 直写 yrs。去重记录**不进** Doc（§4.4 outbox）。
- **server-authoritative 写入权限**【顾问：P0-4】：Y.Doc 的写权限**只存在于 server 进程内**，客户端（Web 面板）是纯 reader。据此：`ysync.update` 是 S→C 单向广播（§4.2）；**客户端上行 update / state vector 一律拒绝**（连接级计数 + 日志，不参与合并、不视为同步提示）；不采用 y-sync 双向增量握手——多 reader 场景下客户端无需贡献任何 CRDT 写入，同步 = server 快照 + 增量广播，天然规避客户端写冲突面（与 chat 的 YJS 双向模式不同，此为架构差异的正当理由）。
- **敏感信息不进 Y.Doc**（chat §5.3 同源）：密钥、内部错误、原始凭证、token、SSH Identity **路径**、known_hosts 公钥行、组织上下文不得进入文档。【v2.16】`machines` 只投影 §5.5 白名单字段；`sshDestination` 按不可信字符串校验后再写。租户/角色由连接绑定提供。
- **schemaVersion 与 projectionVersion 分离**（chat §5.4）：前者描述结构，后者描述镜像进度；服务端升级 schema 时对存活 chat 以幂等结构初始化补齐（旧客户端忽略未知字段仍安全）。
- **ViewStore 隔离范围**【审查：架构 P2-1】：`ViewStore` trait 只隔离聚合器；UpdateSink（内存镜像应用，§8.4）、gateway（快照推送）、broadcaster（`Y.mergeUpdates`）直接接触 yrs 类型。§14「yrs 生态风险可控」承诺**限于聚合器与 doc 生命周期管理**；其余接触点以封装函数（如 `encode_state_as_update`/`merge_updates_v1` 薄包装）收敛，不承诺 API 级隔离。

---

## 6. 聚合层（ACP → Y.Doc）

### 6.1 规范化边界：ACPChannel（chat §6.2）

**`ACPChannel` 是唯一协议边界，位于 server 侧。** instance 透明转发原始 ACP 帧；server 的 ACPChannel 将其规范化为统一事件（NormalizedEvent），聚合层只消费规范化事件，不接受私有帧类型。双格式兼容：原始 `{ type, payload }` 与 JSON-RPC `session/update`（含包裹格式）统一提取。

私有帧 → 规范化事件映射（chat §6.3 同源，按 peri-studio 需要的子集）：

| 原始帧 | 规范化事件 |
|--------|-----------|
| `agent_message_chunk` | `message_delta` |
| `agent_thought_chunk` | `reasoning_delta` |
| `user_message_chunk` / 服务端单写注册 | `user_message` |
| `prompt_complete` / `agent_message_complete` | `turn_completed` |
| `session_error` | `turn_failed` |
| `tool_call` / `tool_call_update`（按 status 细分） | `tool_call_started` / `tool_call_updated` / `tool_call_completed`；pending/in_progress 映射为权威非终态 |
| `permission_request` / `permission_response` | `permission_requested` / `permission_resolved` |
| `session_update` / `available_commands_update` | `session_updated` |
| `session_list` 响应 | `session_list`（agent 磁盘历史，全量同步投影） |
| `peri/prediction_ready` | `input_prediction`（安全 placeholder；actions 在协议边界丢弃） |

**出站翻译边界**（chat §6.2 同源）：`Translator` 把客户端 Action 翻译为 ACP JSON-RPC（`session/prompt` / `session/cancel` / `session/load` / `session/list` 等），`cwd` 由 server 按已认证上下文注入（§4.3 裁决），`rpcId` 由 server 分配（避免消息被当作 notification）。

**可信 binding**：server 维护 `acp_session_id → chat_id` 映射；ACP 帧携带的 sessionId 与 binding 不一致直接丢弃；`acp_session_id` 只用于协议投递，不能成为 Doc 名称、广播频道或缓存键（chat §6.2 规则 5）。

### 6.2 chat 创建时序与不确定副作用边界

`RuntimeCreation` 是该流程的唯一 lifecycle owner；Coordinator 只负责通用 command gate/outbox 接纳，并通过窄 terminal port 发布 Ack/Error。模块拥有 prepare/rollback、全局串行 create queue、spawn/initialize、session load/new、binding、关键投影和 cleanup 裁决，禁止保留第二套 create phase script。

Peri 扩展能力在同一次 ACP `initialize` 上协商：Hub 只在
`clientCapabilities._meta` 声明已经完整实现的 extension，且仅把 agent 在
`agentCapabilities._meta` 中明确回显为 `true` 的白名单项视为 negotiated。
请求不等于支持，未知或类型错误的回显一律忽略。协商结果写入 Control Doc
`agent.extensions`；`available_commands_update` 的名称顺序写入
`agent.available_commands`（`agent.capabilities` 仅保留旧客户端兼容镜像），
结构化 name/description/kind 写入 `agent.command_catalog`，三者不得互相覆盖。
`peri.skillNames` 只把命中的本地条目提升为 `skill`，且必须已经双向协商；
`mcpSkillNames` 使用独立的 `mcp_skill` 分类并优先于同名本地分类。命令更新是
全量快照：最多 256 项、名称/描述有界、名称不区分大小写去重，缺失或畸形
meta 必须清除旧分类而不是跨 session 残留。Peri 精确 token 统计写入
`agent.latest_usage`；标准 ACP agent 缺少扩展 meta 时仍只更新
`context_window/context_used`，Web 必须保持无损降级。

Peri `AskUserQuestion` 使用标准 ACP `elicitation/create` form，而不是 `_meta`
extension。Hub 只有在实现完整 intake、持久投影、一次性 response delivery 与 Web
表单后，才在 `initialize.clientCapabilities.elicitation.form` 声明支持。入站请求必须是
与当前 chat 精确 binding 的 session-scoped form，并在协议边界收敛为有界的
text/single-select/multi-select DTO；任意 raw schema、`_meta`、URL mode 或未知约束都不
进入文档或浏览器。回答按 `commandId + canonical fingerprint` 去重，先在内存 outbox 推进意图
（§8.4：不落盘）与 Control Doc CAS，再跨 no-redelivery barrier 写 ACP response；barrier 后无法证明结果时
只能进入 `DELIVERY_UNKNOWN`，禁止以新命令盲目重答。Web 必须保持原命令门禁并允许强制重取 Control Doc；用户仅可在保留不可重放证据的前提下本地隐藏未知表单，刷新页面后仍从 `responding` 权威事实恢复未知锁。待回答表单最多 4 个，超过上限或
schema 不支持时必须向 agent 返回 JSON-RPC error，不能静默丢弃令 Peri 永久等待。

标准 ACP `configOptions` 是会话运行配置的唯一目录事实源。Hub 首期只接受有界的
select option，把完整有序目录投影到 Control Doc `agent.config_options` /
`agent.config_option_order`，同时从 category 派生兼容的 model/effort 展示字段；Web
不得写死 Peri model alias、权限 mode 或 thinking effort。`chat/config-set` 要求 full
role、live binding、非终态且无 active turn，并与 prompt admission 共享每 chat runtime
transition gate。动作以 typed fingerprint 写入 metadata command ledger，持久
`dispatching` 后才允许发送 `session/set_config_option`；响应必须返回包含请求值作为
`currentValue` 的完整合法目录，且目录投影写入内存镜像后才能 committed（§8.4：投影不落盘）。barrier 后的连接、响应
或投影不确定统一为非重试 `DELIVERY_UNKNOWN`，同 commandId 只能对账/重放，不能二次
下发。Boolean option 必须等 Hub 明确实现并声明对应 ACP client capability 后才能启用。

`peri.agentActivity` 提供 Peri 独占运行能力的安全摘要（SubAgent、后台任务、
compact、重试、workflow 等）。它与包含原始内部事件的 legacy
`peri.agentEvent` 完全分离：Peri 在 ACP 边界先构造 schema-versioned allowlist
DTO，Hub 再次校验 schema/kind/status/属性/指标，并仅在扩展被双向协商后写入
`agent.activities` 与 `agent.activity_order`。同一哈希 correlation 原位更新，
无 correlation 的记录使用 `(epoch,seq)` 身份，Control Doc 只保留最近 64 条。

`peri.prediction` 提供 Peri 的下一条输入建议。Hub 只接受白名单形状、清洗且不超过
200 个 Unicode 字符的 `text`；结构化 actions 仅校验后丢弃，禁止进入文档或浏览器。
最新建议写入 Control Doc `agent.input_prediction`，身份为 `(epoch,seq)`；空预测或
下一条 `UserMessage` 清除旧值。Web 只能把建议显式填入草稿（Tab/按钮），不得自动
发送；未协商、旧文档、只读或运行中会话不显示该表面。

标准 ACP Plan 始终作为全量替换的执行计划投影；Peri 独有的
`TodoEntry.active_form` 只在 `peri.planEntryActiveForm` 双向协商后附在条目
`_meta.activeForm` 中。生产端最多 256 个 Unicode 字符，Hub 再次限制
计划为 64 项、content 1024 bytes、active form 256 bytes，且只接受
`pending|in_progress|completed`。Control Doc 以 `agent.plan_entries` /
`agent.plan_order` 全量替换；未协商仍显示标准 content/status，但必须丢弃
active form。Web 只读显示计划，不得把条目点击解释为新 prompt 或工具指令。

`session/rewind-candidates` / `session/rewind-preview` / `session/rewind` 是 Peri 独有的
高风险控制面。Hub 只在 Agent 精确回显 `peri.rewind: true` 后投影入口；候选与预览
再次收敛为有界文本、project-relative write/edit 文件影响。执行必须携带同一次预览的
SHA-256 fingerprint，并按 `intention_durable → dispatching → effect_confirmed → committed`
写入 runtime command ledger：跨 dispatch barrier 后任何不确定性只能
`DELIVERY_UNKNOWN`，同 commandId 绝不二次 rewind。Agent 确认执行后，Hub 还必须对同一
ACP session 走标准 `session/load` + `peri.replay` 重建，投影完成前不得 committed。
Web 始终要求“选择节点 → 查看影响 → 破坏性确认”三步，未知态不提供重试；标准 ACP
agent、旧 Peri、只读身份、active turn 与终态 runtime 均不显示或禁用该能力，也不得用
隐藏 `/rewind` prompt 绕过门禁。

`peri.oauth` 是 MCP 授权的窄能力，不得以启用 legacy `peri.agentEvent` 代替。授权 URL
只允许在线穿过 instance 的 sensitive-ephemeral 通道，进入 Hub 的短 TTL 内存表，并在
用户显式请求后通过专用响应返回；Yjs、SQLite、outbox、ring、buffer 与日志均不得保存
它。OAuth start/cancel 的副作用去重由 metadata SQLite v6 的独立 `oauth_commands`
账本负责，账本只保存 commandId、动作类型、chatId、canonical payload fingerprint、
安全 phase/error code 与时间。`intent_durable → dispatching` 是 no-redelivery barrier：
Hub 重启时 barrier 前收敛为 `failed_not_delivered`，barrier 上收敛为
`delivery_unknown`，committed/rejected 终态按同 commandId 重放且不要求旧 runtime
仍存活。两个同 ID claimant 必须共享单执行权 gate；任何 ACP 写入都必须晚于 durable
`dispatching`，终态 Ack 又必须晚于 durable terminal transition。

`peri.replay` 为 `session/load` 回放提供 producer provenance。Hub 仅从 ACP 既定
位置读取精确布尔 `periReplay: true`，在 normalizer 后丢弃 raw `_meta`。Chat Entry
的 `origin=session_replay` 由 Hub 的 Begin/EndLoadReplay 窗口裁决；只有 agent 已
回显 capability 且该 entry 的相关 producer 事件全部带标记时，
`replay_verified=true`。缺失或畸形标记只降级为 inferred replay，不中止已经开始的
历史重建。窗口外 marker 永远不能声明 replay。由于现有 ACP 回放不携带原始消息时间，
Web 不得把 Hub observation time 当作历史消息时间展示。
活动投影禁止包含 prompt、消息、reasoning、工具输入输出、摘要、路径、错误正文、
OAuth URL 或完整内部 ID；Web 只做默认折叠的只读展示。

Web 的 slash picker 只消费上述 server-authoritative catalog。选择命令只修改
Composer 草稿为 `/name `，不得自动发送、不得增加 ACP prompt 私有字段，也不得
绕过 `PromptDelivery` 的 exactly-once command identity。旧 Control Doc 只有名称
数组时，Web 生成 description 为空、kind=`command` 的兼容条目。

```
客户端 chat/create
  → server prepare store/doc/registry，写入内存 outbox（Accepted 与 create intent，§8.4）
  → server 越过 no-redelivery barrier（intent_durable，内存态）
  → server 选 instance（显式/默认本机）
  → server 下发 instance/spawn { command_id, chat_id, cmd, cwd }
  → instance 拉起 ACP 进程
  → instance 上报 instance/spawn_ack { ok | error }
  → （spawn 明确拒绝，或 kill Ack 精确证明未存活 → 可判定失败）
  → server 经 instance 转发 initialize（透传 JSON-RPC，instance 保持 dumb）
  → server 经 instance 转发 session/new
  → instance 上报 session 创建结果（session_id）
  → server 建立 binding（acp_session_id → chat_id，内存 ChatRegistry）并写入 agent 投影（内存镜像，§8.4）
  → 此后该 chat 的 ACP 帧才允许投影（binding 建立前到达的帧一律丢弃，§6.4 丢弃语义在此挂钩）
  → action_ack committed（携带 chatId）
```

超时沿用 spawn 10s、initialize 10s、binding 30s，但超时不是“确定失败”的同义词。spawn/kill writer Ack 丢失表示 runtime 是否存在未知；`session/new` forward/L3、binding、agent projection 或 terminal ledger 在 ACP 可能已创建 durable session 后失败，均返回非 retryable `DELIVERY_UNKNOWN`。kill 成功只能证明子进程已清理，不能撤销 ACP durable session。重启后内存 outbox 为空（§8.4.1），create 不自动恢复、不重发；不得暴露无 executor 的 InProgress，也不得自动复活旧进程。

`PromptDelivery` 是 `chat/prompt` 的唯一 lifecycle owner。Coordinator 只完成通用 command gate、内存 outbox 接纳和 per-chat 串行调度；existing-command replay 与 terminal observer/wire publication 统一委托 `CommandOutcomeBroker`。模块内部按 `pending user entry → intent durable → dispatch barrier → instance writer Ack → dispatched → L3 inactivity window → turn/entry projection → projection committed → completed` 推进。dispatch barrier 之后的 transport、L3 或跨存储失败一律收敛为不可重试的 `DELIVERY_UNKNOWN`；即使 terminal append 本身失败，也必须把相同裁决返回 Broker，使进程内 terminal fallback 接管，禁止 accepted observer 永久悬挂。canonical payload fingerprint 由中立的 command identity helper 同时供 submit gate、Broker 与 lifecycle 使用，不能存在第二套序列化或 prompt phase script。

`failed_not_delivered` 是跨 Chat Doc 与 Session Doc 的一个原子业务事实，而不只是消息徽标：v2 user entry 必须记录明确未投递，同时仅将 `turn_id` 完全相同且仍非终态的 active turn 置为 `failed`，不得伪造 assistant entry，也不得终止更新的 turn。运行期 `DocManager` 和 Gateway ready 前的 `StoreSink` 修复共用这一精确身份规则；任一文档已写、另一文档缺失时，重放必须幂等补齐另一半。`delivery_unknown` 不具备明确未投递证据，因此绝不能借此终结 Session active turn。

### 6.3 幂等聚合规则（chat §6.3）

映射必须是幂等的：**重放同一 ACP 帧不重复创建 Entry、工具调用或权限请求**。聚合器以 `turnId` / `entryId` / `toolCallId` / `permissionId` 与终态状态机确定写入目标；缺少必要关联信息的帧拒绝投影并记录脱敏诊断（返回 `ApplyResult { applied, reason }`，纯投影无 I/O 无日志副作用）。

| 规范化事件 | Y.Doc 写入位置 | 聚合规则 |
|-----------|---------------|---------|
| 文本增量 | Chat Doc entry block | 追加（微批次合并，§6.4） |
| 思考/推理增量 | Chat Doc reasoning block | 仅写 `summary`；`hidden` 只推进流序号，不进入浏览器共享投影 |
| 工具调用开始/更新/完成/content chunk | Chat Doc `tool_calls` | 按 `toolCallId` upsert；ACP `kind` 是 UI 语义的唯一事实源，未知值降级 `other`，浏览器不得按标题猜类型。arguments/content/locations/result 使用 `unchanged/clear/set/omitted(bytes)` tri-state patch：缺省不清空旧证据，content chunk 有界追加。生命周期单调且不可越过权限等待；首个终态固定状态/error/completedAt，晚到帧只允许补齐缺失证据，不得重开终态。恢复首帧为 update/terminal 时在活动或回放 turn 下合成可达工具记录。turn 任一终态必须终态化该 turn 的全部 assistant 分段并收敛所有非终态工具，防止永久 streaming/running。超预算字段明确记录 omitted 与字节数，不得伪装为空。 |
| 权限请求/决议/过期 | Control Doc `pending_permissions` + Chat Doc `tool_calls` | 官方 permission request 保留完整 `toolCall` 快照；即使先于普通 tool 通知到达，也在同一 seq 原子创建可达工具卡并进入 awaitingPermission。稍后正式通知只补全字段，不越过等待或重开终态；allow 恢复 running，deny/expire 进入 cancelled；旧事件缺快照或未知可选关联时仍不抑制权限请求 |
| 权限请求/解决/过期 | Control Doc `pending_permissions` | 按 `permissionId` upsert；决议写 `decision`（CAS，§7.4） |
| Agent status/extensions/commands/session info | Control Doc `agent`/`session` | extension 仅接受 initialize 白名单回显；commands 是独立运行时目录；未确认能力保持不可用 |
| `session_list` 响应 | Control Doc `sessions` | agent 磁盘历史，全量同步（幂等，10s 轮询），响应中不存在的旧条目删除（自愈） |
| turn 终态（完成/失败/取消/中断） | Chat Doc entry + Control Doc active_turn | 终态立即写入；之后的同 turn 增量丢弃（**interrupted 例外见下**） |

**终态守卫（含 interrupted 校准例外）**【审查：架构 P0-2 + 开发 P0-1】：

- turn 处于 `cancelling` 或不可校准终态（completed/failed/cancelled）时，晚到增量一律丢弃——避免「已取消但还在输出」的中间态。
- **`interrupted` 是可校准终态**：仅允许同 `turnId` 且**带补推序依据**（`(chat_id, seq)` 单调，见 §8.5）的终态事件（`turn_completed`/`turn_failed`/`turn_cancelled`）将其**恰一次**迁移为实际终态；其余事件仍丢弃。守卫实现从「状态位判断」改为「状态位 + 重放序判断」。

### 6.4 顺序、微批次与事务边界（chat §6.4 + 审查修订）

- 同一 chat 的 ACP 帧按收到顺序进入独立有界缓冲区，**绝不与其他 chat 混批**；聚合器为**每 chat 串行消费者**【审查：架构 P1-1】。
- 文本与 reasoning 增量可在固定时间窗（默认 16ms）或字节阈值内合并；单个批次通过一次 Y.Doc transaction 写入。
- **控制类更新先 flush 再立即写入**：工具状态、权限、Agent status、错误、turn 终态及断链——保证用户看到的状态不倒退。
- 批次达到大小上限、等待超时或广播队列满时立即 flush。**广播背压改述**【审查：开发 P2】：yrs 的 `observe_update` 回调是同步的、不能 await，无法「提前感知背压」；Rust 侧在监听回调中把 update 经 channel 送出，背压只能作用于 broadcaster 队列——**广播队列满时合并 update（`merge_updates`）或跳过发送（客户端重连后经快照重同步兜底）**；广播失败只影响连接传递，不能阻塞 ACP 读取循环。
- 不对 token 逐条创建日志或 trace；仅在聚合窗口、工具/权限状态和 turn 终态形成可观测的状态变化。

**提交点纪律（§无状态投影修订）**：Hub-originated user entry 在下发 ACP 前以
`delivery_state=pending` 写入内存 outbox/Control Doc（§8.4：不落盘），正文投影的精确身份为
`sourceCommandId + turnId + payloadFingerprint + delivery schema`（§4.4）。它与
assistant/工具事件的 ACP 聚合是两条不同事实链：Pending 只提供进程内正文恢复证据，
只有 L3、turn 终态、user entry 终态与 outbox 屏障全部建立（内存状态机）后才能发送
`committed`。

prompt 的终态提交还必须满足第二个屏障：ACP L3 返回后，control
`active_turn` 与 assistant 终态 update 经 DocManager 提交成功（写入内存镜像；或被证明为
同一 turn、同一终态的幂等重放），outbox 才可进入
`projection_committed → completed`。turn 不匹配、已有不同终态、writer 拒绝或
UpdateSink 投递失败都必须返回非 retryable error 并保留 failed outbox 记录；禁止忽略
DocManager 结果后发送 committed Ack。

**旧 turn 未完成时新 prompt 的裁决**【审查：开发 P2】：对齐 chat `applyUserMessage`——旧 assistant entry 置 `cancelled`（不向 ACP 发 cancel），新 prompt 正常转发；ACP 侧旧请求的终态事件到达时因 turnId 不匹配被终态守卫拒绝，收敛于旧 entry 的 cancelled 状态。

### 6.5 单写与绑定（chat §6.5）

- DocManager 是唯一允许把 ACP 运行态写入 Y.Doc 的边界（§5.6）；客户端、旧实例、已解绑 ACP session 与未通过校验的帧都不能直接修改 YJS。
- **用户消息由服务端单写**：`chat/prompt` 处理时 server 注册 `turnId` 并创建 user entry（幂等：同 `turnId` 重放跳过），ACP 的 `user_message_chunk` 增量以此映射。
- binding 不存在、已解绑、ACP session 已断链时立即丢弃事件；**不得重新创建旧 Doc，也不得缓存给未来实例使用**。

---

## 7. 状态机与并发规则

### 7.1 instance 生命周期

```
         auth.hello 成功（含双向认证，§9.2）
  ┌───────────────────────────┐
  ▼                           │
REGISTERED ──► ONLINE ◄──┐    │
   ▲           │   ▲     │    │
   │           │   └─────┘    │
   │           │   心跳恢复    │
   │           ▼              │
   │        OFFLINE ◄─────────┘   (心跳超时 30s / 连接断开)
   └── 重连 (指数退避 1s→2s→4s…上限 60s)
```

- 心跳：instance 每 5s 发 `instance/heartbeat`；server 30s 未收到（可配置）→ 标记 `offline`。
- 重连：instance 侧自动指数退避重连，重连后 `instance/hello` 携带缓冲水位/`buffer_lost`/seq 状态，server 据此协调补推（§8.3）；**hello 是幂等替换**——新 hello 到达即 fencing 旧连接【审查：架构 P1-4】。
- **instance 离线即刻生效**【审查：开发 P1】：判定离线那一刻，该机**所有非终态 turn（accepting/running/awaiting_permission/cancelling）统一 → interrupted**，该 chat 所有 pending 权限**批量 expired**（复用 chat `expireTurnPermissions`），聚合器更新 yjs，所有连接的面板同步可见。

### 7.2 Turn 状态机（chat §8.1 + 审查修订）

```
accepting ──► running ──► completed
   │             │  ▲        │
   │             │  └── awaiting_permission ──► running (allow)
   │             ▼              │
   └─► failed   cancelling ◄────┘ (用户取消 / deny / expiry)
   ▲               │
   │   (任意非终态均可取消)【审查：开发 P2】
   └───────────────┼───────────┐
                   ▼           ▼           ▼
                cancelled   interrupted   failed
                (Agent确认)  (取消超时/    (Agent或系统错误)
                             连接丢失)
```

- **终态不可逆**（`interrupted` 除外——可被带补推序依据的终态事件恰一次校准，§6.3 守卫例外）。恢复执行必须创建显式的新 turn。
- `chat.active_turn`（turnId + turnStatus + updatedAt）是权威投影，前端由 `turnStatus` 派生展示状态；chat 级扁平 status 枚举不承担展示语义。
- `cancelling` 非终态但输出已停止——用户已取消，晚到增量一律丢弃（§6.3 终态守卫）。

### 7.3 chat 生命周期与分区恢复裁决【审查：架构 P0-2】

```
chat/create 或 load ──► accepting ──► ... （turn 状态机驱动）
                              │
        ACP 进程退出 ──► ended（终态，视图保留供历史查看）
        用户关闭 ──► closed
        进程崩溃 ──► crashed
        instance 断线 ──► 活动 turn → interrupted（turn 级终态）
```

**分区恢复裁决（P4 的实现语义）**：

- **`interrupted` 是 turn 级终态，不是 chat 级终态**。
- chat 级状态独立演进：instance 分区期间 chat 置 `gap`（补推缺口，§8.5）；**补推完成、seq 追平后清除 gap，chat 恢复可用，可开新 turn**——用户可在原 chat 继续对话。
- 补推完成后 `active_turn` 恢复规则：旧 turn 保持 `interrupted`（或按 §6.3 例外校准为实际终态），新 turn 正常投影。
- 若补推无法完成（缓冲丢失/缺口不可补）：chat 保持 `gap`，面板提示「载入以校准」（`chat/load` 显式重建），不假装完整。
- 每次用户输入 = 新 turn；`chat/prompt` 创建 turn（`accepting`），ACP 确认后 `running`。

### 7.4 并发规则（chat §8.2 + 审查修订）

1. 同一 chat 的命令按**有界队列严格串行**执行（上限默认 64，超出返回 `RATE_LIMITED`）；串行性由进程内队列保证。
2. 默认每 chat**仅一个活动 turn**；若未来支持并行 turn，必须先引入独立 branch/thread 聚合，不能直接放宽约束。
3. `commandId` 去重记录在内存 outbox（§4.4），覆盖客户端进程内重试窗口；**不覆盖 server 重启**（重启即空，命令不重发，§8.4.1）。
4. **Permission resolution 使用 compare-and-set**：仅 `pending → resolved` 原子迁移一次，重复或过期回答返回幂等结果（`duplicate` ack）；迁移成功后才向 ACP 进程发 `permission.resolve`。官方 request 在首次裁决时同时申领 `(commandId, decision)` 唯一投递权；明确未送达只能以同一 commandId 和同一 decision 在同一存活 runtime 恢复，新 commandId 即使决策相同也不得重放安全副作用。`dispatched` 之后没有确认的结果属于 delivery unknown；server 重启后旧 runtime 按§8.3 终止，因此恢复证据不授权自动重放，只供运维对账。
   Control Doc 将官方 ACP option 的 opaque ID 按 `allowOnce` / `allowSession` / `deny` scope 投影；现代 Web 必须显示实际范围，并在 `permission/resolve` 回传用户所选的精确 `optionId`。server 在 CAS 和投递前验证 permission 与 optionId 属于 action 指定的同一 chat、同一原 pending request，且 scope 与 Allow/Deny 一致；恢复证据绑定同一 ID。未知、跨 chat、跨 scope 或脱离 pending/recovery 的 ID fail closed。若官方请求未提供 reject option，Deny 仍必须可用，并按 ACP 契约发送 `cancelled`（无 optionId）。只有旧客户端缺省 `optionId` 时，translator 才保留 Allow 的兼容选档：优先 `allow_once`、不存在时最多选择明确的 `allow_always`，不得按数组顺序选择或回退到无关 option。
5. 标题更新等非 Agent 操作可独立排队，但仍经服务端命令写入；不能借 YJS client update 绕过授权。

**每 chat 单写者（Y.Doc 写入串行化）**【审查：开发 P0-2】：

- 存在三个写入路径：instance 事件聚合器（§6.4 独立任务）、command-coordinator 执行路径（user entry/权限 CAS）、权限超时定时器（CAS 迁移）。**yrs 的 `transact_mut()` 对同一 doc 的并发事务会 panic**（tokio 多线程下无互斥即崩溃）。
- 强制约束：**每 chat 一个 writer task**——聚合器、命令写入请求、定时器 CAS 请求全部经该 chat 的 mpsc 通道串行执行（`&mut DocPair` 独占）；等价实现为 per-chat `tokio::sync::Mutex<DocPair>`。
- 跨 Chat/Control 双事务顺序**固定 chat → control**；禁止跨 await 持有 Y.Doc 事务。
- 命令入队检查（outbox 去重索引 + 队列上限）与 `in_flight` 标记必须在**同一临界区**内完成（chat 靠 JS 单线程天然原子，Rust 无此保证），否则并发重发可绕过去重表。

### 7.5 instance daemon 崩溃故障卡片【审查：运维 P0-2】

| 步骤 | 行为 |
|------|------|
| daemon 崩溃 | ACP 子进程随 daemon 死亡（kill_on_drop）；缓冲（内存+磁盘）全部丢失；per-chat `stream_epoch` 递增（§4.5.1）【顾问：P0-2】 |
| instance 重启重连 | `hello` 上报 `buffer_lost: true` + 存活 session 清单 + 新 `stream_epochs` |
| server 裁决 | 对「已标记 interrupted 但 instance 声称存活」的 chat：**默认下发 `instance/kill` 清理孤儿进程**，Registry 标记「已清理」，面板可见；不得静默保留 |
| 验收 | M1 验收矩阵补「kill -9 instance daemon」演练（P9） |

### 7.6 instance offline 时 chat/close（pending_close）【审查：开发 P1】

- instance offline 时 `chat/close` 无法下发 `instance/kill` → 返回 `INSTANCE_OFFLINE`（retryable），视图标记 **`pending_close`**（Registry chat 状态）；
- instance 重连后 server 对 `pending_close` 集合自动补发 `instance/kill`，完成后清标记；
- 重连对账时 `alive_sessions` 与 server 已 closed 集合协调：server 对已 close 的 session 统一下发 kill（§8.3）。
- `instance/kill` 对“进程已退出/不存在”也返回成功，因此 close 的任何未完成屏障都通过幂等重放修复；
  `ProjectionCommitted` 只能建立在真实投影提交成功之后（内存镜像，§8.4），`Completed` 还要求
  Registry Closed 成功（`closed_at` 文件已删除，终态由 ACP/Registry 状态派生）。任何中间错误必须返回 terminal error，禁止只记 warning 后留下 observer。

---

## 8. 韧性设计

### 8.1 原则（chat §2.1 同源）

1. **server 无状态化**：server 只持有元状态（Y.Doc + instance 注册表），不持有任何 agent 运行态。server 崩溃 ⇏ agent 中断；客户端（面板）崩溃 ⇏ 任何影响。
2. **传输至少一次，领域效果恰好一次**：客户端与 ACP 链路允许重发；server 通过 `commandId`（内存 outbox 去重记录，§4.4）、`turnId` 和状态机实现幂等（P8）。
3. **流式增量可丢、最终状态不可丢**：token delta 可合并；turn 终态、错误、取消、工具调用和权限决策必须可靠投影。
4. **慢消费者不能阻塞 Agent**：广播与 ACP 读取解耦；连接达到背压阈值后合并/跳过发送（§8.6），而不是无限缓存。
5. **数据权威顺序**：ACP 进程运行态（权威）→ Y.Doc（实时镜像）→ 消息（传递载体）。Y.Doc 不保存可跨 ACP session 恢复的旧投影，也不作为持久化真相。
6. **判定性时间戳由 server 时钟**（§4.7），instance 只上报相对时序。

### 8.2 断链语义矩阵

| 断链对象 | Y.Doc 处理 | 后续行为 |
|---------|-----------|---------|
| **Web 面板断开** | 不对 session 执行任何清理 | ACP session 存活时，重连后同步当前实时 Doc（快照 + 增量追平） |
| **instance 网络分区**（agent 还活着） | 不删除 Doc；活动 turn → interrupted（可校准）；chat 置 gap | instance 重连后缓冲补推（§8.3）；seq 追平后清除 gap、chat 恢复可用（§7.3） |
| **instance daemon 崩溃** | 同上（agent 随 daemon 死）；hello 上报 buffer_lost | server 对「已中断但声称存活」的 chat 默认 kill 清理（§7.5） |
| **ACP 进程退出/被杀**（ended/closed/crashed） | 终态写入视图（内存镜像）；无归档（§8.4），历史查看由用户打开时重启进程 + `session/load` 重建（§8.3） | 不再接受该 chat 的新事件；缓冲清理 |

### 8.3 server 崩溃 / 重启（P3）

1. server 崩溃瞬间：instance 检测到 ws 断开。
2. instance 上的 ACP 进程**继续运行**；daemon 将原始 ACP 帧写入本地缓冲（内存，超限溢出到磁盘；上限默认 10MB/万条，可配置）。**「产出不丢」是有界承诺**【顾问：P0-3】：缓冲上限内不丢；超限按 §8.5 丢弃策略丢弃（delta 优先、控制帧最后），并以 `gap` 结构化呈现缺口——**不承诺无限缓冲**，避免「10MB 与产出不丢」矛盾表述。
3. instance 以指数退避重连 server。
4. server 重启后：**无快照重建**——不加载任何投影/命令状态（§8.4：StoreSink 启动即空，outbox 重启即空；命令从不重新发送，以 ACP 现场为准）。`ChatRegistry` 启动为空，**不再**从 SQLite 预注册 runtime（V7 删除 `session_runtime_history`）；Registry `project_sessions` 为空直至 `session/discover` 或打开 project 触发 list。各 instance 的 `instance/hello` 只完成认证、连接 fencing、capability 与 `stream_epochs` 登记；hello **没有** authoritative `alive_sessions`，不得触发对账、resume 或清除 Restarting。
5. **首份权威心跳恢复屏障**：每个 **进入全局 pending 的** instance 的首份 `instance/heartbeat`（空集合也有效）由 `RecoveryCoordinator` 的 per-instance 串行 lane 依次执行 `alive_sessions` 对账 → 仅对 confirmed runtime 批量 `session/resume` 并等待 RPC 终态 → 完成该 instance barrier。相邻快照按连接 epoch fencing，未开始的快照 latest-wins；旧连接不能确认 runtime、发送 resume 或完成 barrier。任一 **全局 pending** 恢复失败报告 `RestoreInvariant` 并进入 Degraded；**全局 pending 集合**全部完成后才能清除 Restarting。
5a. **【v2.16】SSH 机器不进入全局 pending。** heartbeat 对账仍处理 SSH 上意外存活的 chat，但 `recovery_instances` **只含本进程保证能拉起控制面的 id**（当前：`kind=local`）。`kind=ssh` 不得加入，否则 studio 会在 Restarting 中等待一台尚未建隧道的机器，连 `machine/connect` 也被拒（自锁）。SSH hello 之后只跑该 id 的 per-instance lane，不挡 Healthy。已 Trust 且 `auto_reconnect` 的隧道由 `app` 在 Healthy **之后** best-effort 重建。
6. **runtime 存活确认与补推**：心跳命中的 chat 才置 `runtime_confirmed=true`，missing chat 清除确认并置 gap；未确认 chat 打开时一律 spawn 新 ACP 进程 + `session/load`。恢复确认后，**epoch 相同**的 chat 按 `instance/buffer_sync` 补推；**epoch 变化**判不可校准缺口（§4.5.1）。已结束会话不重建视图；面板断线期间自行退避重连，重连后经 §4.6 时序恢复。

### 8.4 Y.Doc 持久化规范【无状态投影重构修订：无落盘契约】

yrs CRDT docs 与 command outbox **均不落盘**（§无状态投影重构；【v2.6】原引用的 `docs/design/peri-studio-stateless-projections.md` 未随仓库迁移保留，规范以本节为准）；**业务权威**落盘是 `<data_dir>/metadata.sqlite3`（§3.0）。【v2.16】另允许 `<data_dir>/ssh/known_hosts` 仅作 OpenSSH Trust，不是第二份领域事实。

- **UpdateSink = 内存镜像 + 广播流**：`UpdateSink` trait 保留（§5.6），`persist_update` 把 update 投递到 StoreSink 的内存镜像（应用 + 广播），**不写磁盘**；gateway 快照与 broadcaster 增量同源（同 clientID），客户端应用无 CRDT 分叉。
- **【v2.6】SQLite schema（migrations V1–V7，唯一业务权威落盘面）**：V1–V6 见历史修订；【v2.16】V7 建 `machines`（SSH 挂载意图；PK `instance_id`；未归档 `(ssh_destination, ssh_port)` 唯一）；**【v2.17】V7 同时删除 `project_sessions`、`session_activations`、`session_runtime_history`（及关联 `metadata_imports` 会话外键），归档旧表或 DROP，hub `project_session_id` 行一次性丢弃**。保留：`projects`、`metadata_commands`（缩减：不再含 session 目录 mutation 的 session 外键）、`machines`、`oauth_commands`、`projection_state`。另允许 `<data_dir>/ssh/known_hosts`（`0600`）作为 OpenSSH Trust 文件，**不是**第二份业务权威；禁止写入 token/私钥。
- 持久化路径：`~/.local/share/peri-studio/`（或平台对应目录）用于 metadata.sqlite3、instance token 发布文件与【v2.16】`ssh/known_hosts`，凭据类文件 `0600`。
- **已删除**：`chats/<id>/updates.log`、`updates.snapshot`、`outbox.log`、`watermark.json`、registry log/snapshot、compact 机制（8MB/64MB 阈值）、`closed_at` 归档标记；启动不重放任何日志。`committed` Ack 与落盘/fsync **解绑**（§4.4：无持久化屏障）。
- **视图重建完全由 ACP 重放提供**：live chat 走 `session/resume`（§8.3），已结束会话走重启进程 + `session/load`；`projects` 段由 metadata.sqlite3 经 `ProjectService::reproject` 重建，`project_sessions` 段由 ACP list 缓存填充（启动为空）。
- **degraded 触发点**：无投影落盘路径；原「落盘失败」语义由 **UpdateSink 投递失败 / 终态无法建立**取代（§17.2）。
- 注意：Y.Doc 是实时镜像（内存态），不是持久化真相；ACP 进程（权威）断链后不依赖旧 Doc 继续写入（§8.1 原则 5）。

#### 8.4.1 原子性边界与恢复不变量【无状态投影重构修订】【顾问：P0-5】

**原子性边界**：

- 唯一业务权威落盘是 metadata.sqlite3（§3.0），其原子性由 SQLite 事务保证；【v2.16】`ssh/known_hosts` 与 token 文件不参与领域事务。chat/control/registry 投影均为**进程内内存态**（StoreSink 镜像），不存在跨文件持久化原子性问题（chat→control 双 Doc 投影同理：内存态，不承诺跨 Doc 原子事务）。

**恢复不变量（M1 启动逻辑的契约，按序执行）**：

1. **outbox 纯内存、重启即空**：启动不重放任何 outbox 日志（无日志）；命令**从不重新发送**，命令状态以 ACP 现场为准（客户端手动重试 prompt 可能重复执行为已接受边缘风险）。`reconcile_*_after_restart` 在空索引上执行为 **no-op**；
2. **无 last_seq 持久化**：`(epoch, last_seq)` 为内存态（§4.5.1）；缓冲补推起点由 instance 给出（§8.5），无日志核对；
3. **视图从零重建**：StoreSink 启动即空；`ChatRegistry` 启动为空（无 SQLite runtime 预注册）；live chat 仅由 §8.3 步骤 5 heartbeat `alive_sessions` 对账后 `session/resume` 恢复；`projects` Registry 段由 `ProjectService::reproject` 从 metadata.sqlite3 重建，`project_sessions` 启动为空直至 list；schema_version 判空幂等补结构（§5.6）仍适用；
4. **instance 对账后开门**：装配后 Registry 置 `Restarting`；hello 只登记连接，首份 authoritative heartbeat 由 `RecoveryCoordinator` 对账并等待 `resume_instance_chats` 终态。**全局 pending**（§8.3 步骤 5a：当前仅 local）全部完成后才 `clear_restarting`——Restarting 期间拒绝 Action 与 Git mutation 等新 committed 承诺；SSH 机器的自动重连发生在 Healthy 之后，其 `machine/*` 不得被 Restarting 自锁；
5. **任一不变量失败**：进入 `degraded`（§17.2），可继续服务只读视图，拒绝新 committed 承诺。

**降级行为**：chat 与 control 双 Doc 中仅一个成功写入内存镜像时，允许视图短暂不一致（chat 有内容、control 无 agent 状态），**下一个控制事件 flush 时收敛**（§6.4 控制类先 flush），不允许恢复逻辑把两个 Doc 当原子对处理。

### 8.5 缓冲与补推契约（审查修订）

- instance 缓冲按 chat 分桶，帧带单调 `seq`（instance 侧分配）与 `stream_epoch`（daemon 重启/进程重建后 +1，§4.5.1）；**daemon 重启后 seq 可重置**——此时 epoch 变化，补推契约失效，chat 判不可校准缺口，不再按 seq 补推旧流【顾问：P0-2】。
- 补推按 `(chat_id, epoch, seq)` 按序发送；**from_seq 起点 = instance 本批首帧 seq**（server 内存 per-chat `last_seq` 校验连续性，§8.4：不落盘）；instance 环形滑窗（最后 500 条）兜底 server 崩溃前已收未投递段。
- **补推纪律**【审查：架构 P1-1】：重连后 **instance 先排空 `buffer_sync` 再恢复实时转发**（instance 侧保证）；补推完成前聚合器对该 chat 暂停实时应用。seq 只承担补推路径排序，**实时路径排序 = server 到达序**；两路径经聚合器每 chat 串行消费者合并（§6.4）。
- **gap 升级为结构化标记**【审查：开发 P1】：`gap: { count: u32, last_seq: u64, uncalibratable?: bool }`（缺口帧数、断点、是否可校准）；补推完成、seq 追平后**清除**（由聚合器写回）；`uncalibratable` 由 epoch 变化触发（§4.5.1），只能经 `chat/load` 显式重建消除【顾问：P0-2】。
- 缓冲超限丢弃：**delta 类帧优先丢弃、控制帧/终态帧最后丢弃**【审查：运维 P1-6】；单帧大小上限（默认 1MB，超限直接跳过并记 gap）；「内存 + 磁盘合计 10MB」为计数口径。
- 缓冲文件权限 `0600`（内容是 chat 正文）；chat 结束/清理时同步删除缓冲文件。
- 分区期间的 HITL 类交互（如权限请求）悬挂在 instance 侧缓冲，恢复后补推；产品语义明示。

### 8.6 背压、超时与资源治理（chat §11）

- 每连接维护有界发送队列：超过软阈值（64 KB）合并 update（`merge_updates`）或跳过发送（客户端重连后经快照重同步）；超过硬阈值以可恢复错误关闭连接。
- 连接配额：`YJS_MAX_CLIENTS` 默认 200。
- 取消超时 10s → `interrupted`；权限请求超时默认 5min → `expired`；spawn 10s / initialize 10s / binding 30s（§6.2）。
- instance 单帧写超时 10s：writer 被 TCP 背压阻塞超过此时长视为连接死亡 → 主动断线，走既有断线缓冲/补推契约（§8.5），不再无限挂起主循环（心跳停发、帧在无界通道内累积绕过缓冲预算）。
- Action payload 上限 1 MB；每 chat 命令队列上限 64。
- **回放窗口**（10s）：`chat/load`/`resume` 转发时开启，承接先于 JSON-RPC result 到达的历史回放流；窗口外或 Chat Doc 已有内容时保持聚合层拒绝语义。
- 服务关闭时：停止接收新 Action → 完成或中断在途提交 → 释放引用 → 关闭连接。
- 所有阈值集中到配置（§16 默认值表）。

---

## 9. 安全模型

### 9.1 威胁与边界

- server 下发 spawn/kill 到 instance 等价于**远程代码执行**能力 → instance 侧必须认证 server，server 侧必须认证 instance。
- chat 内容（密钥/代码）会出现在 Y.Doc 与事件流中 → 客户端必须认证，陌生设备不可见。
- 局域网默认明文 ws：可接受（M1–M3 场景），M4 升级 wss。**M1–M3 期间以「默认监听绑定 + 不可信网络禁用」缓解**（§16）。

### 9.2 token 模型与双向认证

server 首次启动生成 token（存储于 server 配置目录，`0600`）：

| token | 用途 | 权限 |
|-------|------|------|
| **instance token**（每机器一个） | instance 注册与认证 | 收 spawn/kill 指令、上报事件/心跳 |
| **client token**（**按设备签发**）【审查：运维 P1-5】 | Web 面板 / API 客户端连接 | 读 yjs 状态、发 Action、订阅事件流；**预留 read-only 档位**（只读面板/旁观客户端用，§9.2.2） |

**连接级双向认证**【审查：架构 P1-6 + 运维 P0-1 + 顾问2：P0-2】：

1. instance 发起连接 → 发送 `instance/hello`（含 token + **一次性 challenge_nonce**，32B CSPRNG，每次连接新生成）。
2. server 校验 token（含协议版本、角色匹配）→ 响应 `HMAC(instance_token 派生密钥, challenge_nonce ‖ connection_context ‖ protocol_version ‖ role)` 作为 server 身份证明。
3. **instance 校验通过前不执行任何 spawn/kill**；校验失败即断开（关闭码 4502 + 审计计数）。
4. 该机制在明文 ws 阶段生效（防 ARP/DNS 劫持冒充 server）；M4 的 wss 是补充而非替代。

**协议级属性（防「只有 HMAC 名称、无协议约束」）**【顾问2：P0-2】：

- **挑战新鲜性**：challenge_nonce 单次使用，server 侧记录已用 nonce（短期有效窗口 30s 过期）；连接断开即失效；
- **连接绑定**：HMAC 输入绑定该连接唯一的 `connection_context`（如连接级随机 id），响应无法跨连接重放；旧连接被 hello 幂等替换 fencing（§4.5），重放旧握手报文无效；
- **角色与版本绑定**：HMAC 输入含 role 与 protocol_version，防止跨角色/跨版本重放；
- **身份隔离**：每 instance 独立 token/派生密钥（§9.2.1 按机器签发），instance 之间密钥不可互换；
- **密钥生命周期**：轮换走宽限期共存（§9.2.1），吊销即刻生效；
- **失败语义**：认证失败关闭连接 + 失败认证计数（§17.1）+ 结构化日志，不静默；
- **边界声明**：HMAC 只提供认证与完整性，**不提供机密性**——M4 公网部署以 wss/TLS 为强制边界，不得以 HMAC 替代传输加密。

**线格式精度（消除跨实现签名歧义）**【顾问3】：

- 算法：`HMAC-SHA256`，输出 base64（标准 RFC 4648，无填充歧义）；
- MAC 输入字段规范化：`challenge_nonce ‖ connection_context ‖ protocol_version ‖ role` 按**固定字节序**拼接（各自长度前缀 + UTF-8 编码；challenge/connection_context 为 32B 原始字节），字段顺序即文档顺序，不得重排；
- 比较：常量时间比较（`subtle` 或等价实现），杜绝时序侧信道；
- 密钥：`instance_token` 经 HKDF 派生单连接密钥（派生上下文含 role），token 本体不出现在 MAC 输入；
- 测试向量必须以**字节级**定义（给定 nonce/context/version/role → 期望 MAC 输出），跨实现可验证。

#### 9.2.1 token 运维流程【审查：运维 P1-5】

- 生成：32B CSPRNG；instance 侧存储同样 `0600`。
- 备份清单：token 文件 + Registry Doc（数据目录丢失 = 全机重新上牌）。
- **宽限期轮换**：新 token 与旧 token 共存（server 同时接受）→ 逐机切换 → 吊销旧 token。静态轮换 + 重启 = 全机锁定，禁止。
- 失败认证计数：结构化日志 + 指标（§17），泄露可检测。
- 视图对象只暴露 `token_id`，绝不暴露 token 本体。

#### 9.2.2 client token 分级【审查：架构 P2-8】

- `full`：读状态 + 发 Action（Web 面板用）。
- `read-only`：仅读 yjs 状态与订阅事件流（只读客户端用）。M1 即预留档位，避免复用 full token 造成可写暴露。

### 9.3 数据脱敏（chat §10 同源）

- 错误分为内部诊断错误与 `PublicError`：Y.Doc 与 `action_error` 只允许稳定、脱敏的公开信息。
- 日志只记录关联 ID、状态、耗时和大小，不记录消息正文、工具参数、token、密钥或原始凭证。
- 浏览器输入、ACP 事件、工具参数与资源 URL 全部视为不可信；进入领域事件前执行 schema、大小、编码校验。
- **错误截断按信任边界与脱敏裁决，而非仅字节数**【顾问2：P1-2】：`action_error` 与 PublicError 只携带稳定错误码 + allowlist 摘要字段（状态/耗时/大小），**截断前先执行敏感字段剔除**——命令参数、env 值、认证材料、ACP 原始输出中的未授权内容不得进入错误回显；端到端长度上限（1MB/4KB）是容量约束，不替代脱敏规则。
- 对消息发送、连接、同步流量、工具调用和权限应答分别限流。

### 9.4 审计最小集【审查：运维 P2-3】

§1.3 排除完整审计，但**保留结构化操作日志**（动作类型/commandId/token_id/结果/耗时，天然由 §9.3 日志规范承载）作为未来审计基础，零成本。

### 9.5 M1 身份与授权边界【顾问：P1-7】

M1 的授权模型**显式收窄**，避免在设计期承诺多用户能力：

- **token 即身份**：M1 无用户概念；一个 token = 一个身份（instance 或 client），无账号、无会话登录、无用户级 ACL；
- **授权面 = token 角色**：`instance` 角色可收 spawn/kill 指令；`full` client 角色可读全部 Doc + 发 Action；`read-only` client 角色仅读（§9.2.2）。**没有 chat 级细粒度授权**——持有 client token 即可访问 server 上全部 chat（单用户本地/家庭局域网前提下的显式取舍）；
- **非 loopback 拒绝策略**：M1 默认监听 `127.0.0.1`；显式配置局域网监听（M2）时，配置文件中声明 `allow_non_loopback: true` 才接受语法有效的远程 WebSocket authority——默认拒绝，防误暴露（§16）。原生 instance 可省略 Origin；远程浏览器必须满足 `Origin=https://Host`，健康端点仍只允许 loopback peer + Host；
- **边界声明**：多用户、配额、chat 级共享、审计合规均不在 M1–M3 范围（§1.3），演进到 M4 公网前必须重新评估授权模型，**不得在现有模型上打补丁**。

### 9.6 spawn.env 白名单【顾问：P1-7】

`instance/spawn` 的 `env` 参数（客户端 `chat/create` 可间接传递）**不开放任意键**：

- server 维护 **env 白名单**（默认空 = 仅继承白名单基集，如 `PATH`/`HOME`/`LANG`/`SHELL`；Hub 对 ACP spawn **固定注入** `PERI_MCP_APPS=`（空串启用 MCP Apps relay）；配置可增补键名，§16）；
- 白名单外的键一律拒绝（`INVALID_STATE` 错误，非静默丢弃）——防止经 env 注入 `PERI_*`/`LD_PRELOAD` 等敏感覆盖；
- 白名单仅约束键名，值仍按 §9.3 不可信输入校验（长度上限、编码）；
- instance 侧对 spawn 指令携带的 env 再校验一次白名单（双端校验，防 server 配置漂移）。

---

## 10. 视图层（Web 面板）

> 【v2.6】原规划的 `peri-studio-tui`（ratatui）**未实现**；视图层由 SolidJS Web 面板承担。【v2.7】构建产物内嵌最终 `peri-studio` 并由 server 角色托管（§3.2）。【v2.18】前端目录已五层化（`app` / `pages` / `widgets` / `features` / `entities` / `shared` + `store`），权威说明见 [frontend-architecture.md](design/frontend-architecture.md) 与根目录 `AGENTS.md`。本节按实现改写；「纯客户端、不上行 update」的裁决（P1/P2 语义）不变。浏览器侧的完整行为契约（认证、目录动作、命令追踪、消息投递恢复、导航、渲染边界）见 §3.0。

### 10.1 定位

- 纯 client：连接 server（单 ws 多路复用），本地维护 **Y.Doc 只读镜像**（server-authoritative，不上行 update，§5.6）【顾问：P0-4】，渲染源 = Chat Doc / Control Doc / Registry Doc；操作 = Action/Ack。
- SolidJS + Tailwind v4 + Vite + Yjs，Bun 管理依赖；`web/dist` 在编译期内嵌进最终 `peri-studio` 可执行文件，由 server 角色托管，不单独部署。
- 面板崩溃/刷新零影响（P1），多面板并存（P2）。

### 10.2 结构与数据源

**分层与目录的权威说明见 [frontend-architecture.md](design/frontend-architecture.md)**；Agent 协作清单见根目录 **`AGENTS.md`**。`web/src/` 按层组织：

| 层 | 路径 | 职责 |
|----|------|------|
| 外壳 | `app/` | `main.tsx`、全局样式 |
| 页面 | `pages/` | 页面级 widget 装配 |
| 业务组件 | `widgets/` | Solid 组合块（`shell` / `chat` / `composer` / `sidebar` / `auth` / `resource`） |
| 特性 | `features/` | 可测试领域用例（`session` / `catalog` / `composer` 等）；禁止 import `store` |
| 实体 | `entities/` | Yjs 只读投影（`chat` / `registry` / `resource` / `topology`） |
| 共享 | `shared/` | `ui` 设计系统、`lib`、`protocol`、`yjs`（`doc-store` 等） |
| 组合根 | `store/index.ts` | 全局信号与 `install*` 接线 |

`web/src/panel/` 仅保留 **deprecated shim** 与尚未迁入 `features/` 的 `lib/`（connection、message、runtime、mcp、auth 等）；**新代码不得写入 `panel/`**。设计系统唯一入口：`shared/ui/index.ts`（`components/ui` 仅 re-export）。**视觉与组件规范**：[`ui-specification.md`](design/ui-specification.md)。

| 区域 / 模块 | 代码位置（现行） | 数据源 | 说明 |
|------|--------|------|------|
| `AuthGate` + auth-state | `widgets/auth` + `panel/lib/auth-*`（待迁 `features/auth`） | `/api/auth/session` | 浏览器认证门（§3.0） |
| `ProjectSidebar` + catalog | `widgets/sidebar` + `features/catalog` | Registry Doc + IndexedDB 偏好 | 左栏目录（§3.0） |
| `MessageList` / `ConversationMessage` | `widgets/chat` + `entities/chat` | Chat Doc + Control Doc | 投影见 `chat-projection`、`transcript-window`（§3.0） |
| `Composer` + 投递/草稿 | `widgets/composer` + `features/composer` + `panel/lib/message-delivery` | Chat Doc + command tracker + IndexedDB | 草稿隔离；session single-flight（§3.0） |
| `PermissionQueue` / `ElicitationQueue` | `widgets/chat` + `panel/lib/*-delivery` | Control Doc | 权限与追问（§3.0） |
| `RewindDialog` / `McpPanel` / `TopologyView` 等 | `widgets/chat` | Control Doc / 查询帧 | rewind（§6.2）、MCP、拓扑 |
| `ErrorCenter` + 连接状态 | `widgets/shell` + `panel/lib/connection-*` | ws 生命周期 | 连接世代、错误中心（§3.0） |
| 状态栏 | `widgets/shell/StatusArea` | `keep_alive` / 连接状态 | 重连与校准指示（§4.6） |

关键模块与层的对应（§3.0）：`shared/yjs/doc-store`（Yjs 边界）、`entities/registry/registry-projection`（目录读投影）、`entities/chat/chat-projection`（消息增量读）、`entities/chat/transcript-window`（窗口化）、`panel/lib/command-tracker`（命令生命周期）、`panel/lib/message-delivery`（投递恢复）、`features/session/*`（导航与激活）、`features/catalog/catalog-actions`（目录动作）、`panel/lib/ws-client` + `protocol`（传输边界，待迁 `shared/protocol` + `features/connection`）。

### 10.3 断线恢复

- 重连 → `auth` → 快照推送（含 projection_version）+ `ready` 握手（§4.6）→ 增量追平。元状态小（KB 级），秒级恢复；追平期间显示「校准中」。
- 普通重连保留逻辑会话与可对账 command（§3.0 连接世代与身份世代区分）；认证失效走幂等 authenticated-session reset。
- 原始事件订阅（`events/subscribe`）是独立流（保留帧面，未启用），不阻塞视图恢复。

---

## 11. 与 peri 的关系与边界

| 事项 | 决策 |
|------|------|
| 耦合点 | 仅 ACP 协议线格式（JSON-RPC over stdio）与 InitializeResponse 能力协商 |
| instance 上的 ACP 进程 | 默认 `peri acp`，可配置为任意符合 ACP 的 server |
| 依赖方向 | 唯一 `peri-studio` 二进制不依赖 peri crate；server/instance 库互不依赖，`peri-studio-proto` 独立 |
| stdio 路径 | peri 侧 stdio host（3.0）不受影响、不合并；hub 独立演进 |
| e2e | 独立测试矩阵：假 ACP 进程（现有 test-child 模式）+ 真 `peri acp`；不进入 peri 的 e2e 基建 |

---

## 12. 工程结构

【v2.7】单二进制 workspace（channel 继续按单一职责拆分，server/instance 互不依赖）：

```
peri-studio/
├── Cargo.toml            # workspace；依赖版本单一事实源 [workspace.dependencies]
├── app/                  # peri-studio 唯一二进制；CLI / local supervisor / serve / connect /
│                         #   status / token；统一信号、就绪与子进程退出语义
├── proto/                # peri-studio-proto：frame（FRAME_TAGS 注册表）/ hmac / whitelist（帧集白名单）/
│                         #   conn（DocId）/ action / ack / instance / ysync / oauth / rewind / event /
│                         #   schema（chat/control/agent/elicitation/registry 类型镜像 + schema registry）/ version / protocol（Defaults）
├── server/               # server 运行时库（无独立发布二进制）
│   ├── build.rs          # 编译期准备 web/dist 内嵌资产（最终链入 peri-studio）
│   ├── src/protocol/     # acp-channel*（入站规范化+permission/elicit/config/活动目录）、translator（出站 action → ACP JSON-RPC）
│   ├── src/state/        # aggregator*（幂等投影+judge+write 分域）、chat-writer*（doc 写入原语）、
│   │                     #   doc-manager*（doc 生命周期+微批次+唯一提交边界）、doc-pair、factory、
│   │                     #   permission（CAS）、session-list（轮询全量同步）、elicitation、
│   │                     #   registry/registry-write（Registry 投影）、view-store（内部实现细节，仅隔离聚合器，§5.6）
│   ├── src/channel/      # gateway（ws 生命周期，client/instance 双 loop）、chat-channel（action 归一化）、
│   │                     #   command-coordinator*（串行队列+commandId 去重，内存 outbox §4.4）、
│   │                     #   prompt-delivery*（prompt 跨 outbox/Yjs/ACP 的唯一 lifecycle owner）、
│   │                     #   command-outcome-broker*（重放/恢复身份校验/observer 临界区，§3.0）、
│   │                     #   runtime-creation*（create 全局队列/索引、准备回滚、kill 证明与 no-redelivery 裁决）、
│   │                     #   metadata-command-processor / metadata-{project,validation}
│   │                     #     （project SQLite command + Registry projection barrier；【v2.17】session 目录改 SessionCatalogService）、
│   │                     #   session-{actions,catalog-sync,discovery,resume,rewind*,runtime-*,configuration}、
│   │                     #   workspace-compatibility（legacy workspace → project authority + Registry mirror）、
│   │                     #   mcp-control* / oauth-control / oauth-command-ledger（§6.2 peri.oauth）、
│   │                     #   elicitation-response*（一次性投递）、turn-cancellation、
│   │                     #   relay-event-handler / relay-{events,rpc,permission,disconnect,buffer-sync}（instance 入站）、
│   │                     #   broadcaster（fan-out+背压）、connection-registry（配额）、terminal-io
│   ├── src/control/      # hub（装配）/ chat-registry / chat-{binding,reconcile,turns} / instance-registry /
│   │                     #   instance-commands / heartbeat / close-codes / project-service（reproject）/ workspace-registry / hub-sink
│   ├── src/persist/      # metadata*.rs（metadata.sqlite3 唯一落盘，migrations V1–V6）、
│   │                     #   outbox*（内存 command outbox，无日志/水位/compact）、store（内存镜像）
│   ├── src/auth/         # service / token（tokens.toml）/ nonce / audit / stats
│   ├── src/web/          # http（loopback HTTP 面）/ auth-http（/api/auth/session）/ static（内嵌资源+缓存策略）/ parse
│   ├── src/config/       # config.toml + CLI/env 覆盖（§16 默认值）
│   └── tests/            # contract（auth）/ integration / product-flow / resilience
├── instance/              # instance 运行时库（无独立发布二进制）：child（进程组+fingerprint）/ buffer（断线缓冲+watermark）/
│                         #   transport（重连循环）/ hub（daemon 主循环）/ auth / router / global；tests/child_test.rs
├── web/                   # SolidJS SPA（§10.2）：app / pages / widgets / features / entities / shared / store；
│                         #   panel/ 遗留 shim + 待迁 lib；vitest + tests/*.test.mjs + Playwright；见 AGENTS.md
├── scripts/               # dev-contract-test / verify-create-chain / verify-load / package-release / verify-release（+ e2e-flow/ws-verify JS 验证脚本）
├── dev.sh                 # 一键开发：构建 Web → 启动 peri-studio local → 就绪校验
└── docs/                  # architecture.md（本文）/ terminology.md（唯一权威术语表）/ topology.md /
                          #   adr/（架构裁决）/ audit-2026-08.md / design/（prompt-recovery-provenance.md 等）
```

测试沿用仓库规范：单元测试 `*_test.rs` 同目录、集成测试 `tests/`；proto 契约测试 `proto/tests/contract.rs`；Web 侧 `bun run test`（typecheck + node --test + vitest + 生产边界校验）与 `bun run test:browser`（Playwright）。

**测试前提**【审查：开发 P2】：

- 聚合器 P0 契约测试（幂等/终态守卫含 interrupted 校准/gap）为**纯函数测试**：内存 Y.Doc + `fn apply(&mut DocPair, &NormalizedEvent) -> ApplyResult`，与 chat 测试形态一致，无需假连接；
- 控制面协议层测试需先抽象 ws 为 trait（如 `WsSink`，定义于 proto crate 或 server 内部），用假连接对象（chat ADR 决策 7 同源）；
- 16ms 微批次与心跳/超时测试需 `tokio::time::pause`（test-util feature）。

---

## 13. 演进路线

【v2.6】实现状态标注：M1–M3 的功能面已在本仓库落地并超过原范围——Web 面板为**可写**主客户端（full token；read-only 档位保留），elicitation / MCP+OAuth / rewind / prediction / plan / agent activity / project-session catalog / import / prompt recovery 等原属后续里程碑或未规划的能力均已实现（§3.0/§6.2）。M2 的多机部署与 M4 公网能力**未开始**。原里程碑表保留为规划基线：

| 里程碑 | 范围 | 验收 | 状态【v2.6】 |
|--------|------|------|------|
| **M1 本机闭环** | server + instance 同机 + 视图客户端 + 三 Doc + token（含双向认证）+ 断线韧性 + **部署包** | P1–P9 全绿；客户端崩溃重启不影响 agent；双面板 attach 一致；**kill -9 server / kill -9 instance daemon 演练**【审查：运维 P1-1】；**§4.8 测试向量 1–12 全绿**【顾问2】 | **已实现**（视图层为 Web 面板而非 TUI；`dev.sh` 本机闭环 + `scripts/` 验证链可用） |
| **M2 局域网** | instance 部署到第二台机器、心跳/离线/重连、实例列表 UI、显式调度、**可观测性指标落地** | 断网 → turn interrupted 呈现 → 重连缓冲补推校准 → chat 恢复可用；gap 计数可见 | 部分（心跳/离线/重连/缓冲补推已实现；跨机部署契约见 [ssh-machine-mount.md](design/ssh-machine-mount.md)，server/app 管道部分落地；`status --json` 已暴露 machines 摘要；指标聚合未落地） |
| **M3 多端** | 多端视图一致（原规划 Web 只读面板） | 多面板视图一致 | **已实现并超出**：Web 面板为可写客户端；`events/subscribe`/awareness 仍为保留帧面 |
| **M4 公网** | wss、token 管理/轮换 UI、限流 | 公网远程连接安全基线 | 未开始（当前仅支持 loopback 单机部署，远程部署为后置里程碑） |

每里程碑独立验收，不互相阻塞。

### 13.1 部署包（M1 验收项）【审查：运维 P1-1 + P2-6】

【v2.7】`deploy/` 模板与本地产物链（`scripts/package-release.sh` /
`verify-release.sh`）均以唯一 `peri-studio` 可执行文件为准。

- 交互式本地启动使用 `peri-studio` / `peri-studio local`。`deploy/` 的后台模板
  使用**两个 OS service，同一可执行文件**：一个执行 `serve`，一个执行
  `connect`。这是为了让 service manager 的 cgroup/job 级清理不把 server crash 扩大成
  instance/ACP crash；不是恢复两个发布二进制。
- instance service 只 Wants/After server，不与 server 共享失败命运，可跨 server
  重启自行重连。模板不包含 token，也不扩大 loopback listener；凭据文件
  必须由运维者以 `0600` 权限提供。
- `GET /api/health` 是受 loopback peer + 严格 Host 双门禁保护的无凭据 liveness：所有
  已运行状态返回 HTTP 200，正文含 `status/ready/protocolVersion/serverVersion` 与
  credential-free `machines[]`（`instanceId`/`displayName`/`phase`/`kind`，来自 Registry
  投影）；`ready=true` 只对应 `GlobalStatus::Healthy`。`peri-studio status` 探测 liveness，
  `status --ready` 为 degraded/restarting 返回非零，`--json` 经同源 health 提供稳定机器输出。
- 日志继续只写 stderr。systemd 交由 journald 限额；launchd 文件输出可使用
  `deploy/logrotate/peri-studio` 的外部轮转模板，不在应用内删除或重命名活跃日志。
- **升级流程**：原子替换单个 `peri-studio` 文件，先重启 server service，再滚动
  重启 instance service。server 停机期间旧 instance/ACP 继续运行并重连。
  `instance/hello.protocolVersion` 由 proto crate 定义并参与 HMAC 上下文；不匹配在
  token 校验与 nonce 消耗前以 `protocol_version_mismatch` 拒绝。回滚时两个
  运行角色必须使用同一旧版 `peri-studio`，SQLite 未知更高 schema 继续 fail-fast。
- 独立 `Peri Studio CI` 是 peri-studio workspace 的 required evidence：固定 cargo-deny 版本并
  刷新 RustSec，执行 advisory/license/source/bans 策略与 Bun audit；任何数据库/网络
  失败均 fail closed。策略通过后安装 committed Bun lock 对应的 Chromium，执行五个
  确定性场景 × 三 viewport 以及移动 overlay/recovery 交互契约；失败 trace/screenshot
  作为短期 artifact。浏览器门禁通过后才测试/构建 Web，再执行 locked Rust
  build/test/Clippy；Linux/macOS 重复生成相同 native binary asset 并比较字节。根 workspace CI 不被
  误当作 peri-studio 的覆盖证据。
- `peri-studio-v*` tag 只在 tag 版本精确等于 workspace 版本时产出 Linux x86_64 与
  macOS Apple Silicon 的单一原生二进制。native build 必须同时依赖
  独立 policy 与 browser jobs；每个平台发布同版本 `peri-studio`、SHA-256、源码 revision
  metadata、SPDX SBOM 与 provenance attestation，另发布 shell 安装器。安装器沿用
  Peri 的 `~/.peri` PATH 约定，以独立 `peri-studio-v*` 版本目录避免
  覆盖 Peri；产物排除测试二进制、凭据和运行数据。Windows 尚不具备安全原子 FS mutation
  的平台实现时须返回 `ResourceUnsupported`，不得降级绕过 workspace 边界。Windows 的
  managed-local owner control 当前不支持异常 server 退出后的跨进程接管；正常启动与由
  原 supervisor 发起的关闭受支持，异常恢复在补齐具名管道与进程出生身份校验前保持
  fail closed。

---

## 14. 风险与开放问题

| 风险 | 说明 | 对策 |
|------|------|------|
| yrs 生态成熟度 | Rust yjs 实现 API 变动 | 聚合器与 doc 生命周期经 `ViewStore` 隔离（内部实现细节）；其余接触点薄封装收敛（§5.6 隔离范围）；schema_version 版本化 |
| 事件序与聚合一致性 | 重连补推乱序/重复 | 补推纪律（排空后恢复实时）+ `(chat_id, seq)` 按序 + turnId/entryId/toolCallId 幂等 + interrupted 校准例外 + gap 计数（P0 契约测试固化） |
| 缓冲无限增长 | instance 断线期间事件堆积 | 内存 + 磁盘溢出 + 上限丢弃（delta 优先）+ gap 呈现 |
| 局域网 token 泄露 | 明文 ws + 文件权限 | token 0600 + 双向认证 + 失败认证指标；M4 wss 升级 |
| 多端写冲突 | 多客户端同时操作 | Action 有 Ack 与 commandId 幂等（内存 outbox 去重，§4.4）；Y.Doc 仅 server 经 DocManager 单写 |
| Y.Doc 膨胀 | 长 chat 消息堆积 | 有损聚合（截断/摘要）+ 资源引用；视图为内存镜像，重启由 ACP 重放重建（§8.3/§8.4） |
| Ack 与持久化解绑 | committed 不再绑定落盘（无落盘路径） | committed = 命令已写入 ACP stdin 且 ACP 已确认接收（§4.4/§8.4）；崩溃窗口内命令不自动重试，以 ACP 现场为准（§8.4.1） |
| 去重记录跨重启失效 | 重启后内存 outbox 即空，同 commandId 重发可能穿透去重 | 命令从不重新发送 + 以 ACP 现场为准；客户端手动重试 prompt 可能重复执行为已接受边缘风险（§8.4.1） |
| 补推边界歧义 | daemon 重启后旧流残余与新流无法区分 | stream_epoch 代际标识 + 不可校准 gap（§4.5.1）【顾问：P0-2】 |
| 投影与 SQLite 状态不一致 | chat/control 双 Doc 内存镜像与 metadata.sqlite3 无跨库事务 | 以 SQLite project 权威 + ACP list 缓存 + 视图从零重建（heartbeat 对账 / reproject）+ degraded 降级（§8.4.1）【顾问：P0-5】 |
| L3 未知状态盲重试 | L2 后 ACP 侧状态未知时自动重发 → 重复外部副作用 | delivery_unknown 状态 + 非幂等命令禁止盲重试（§4.4）【顾问2：P0-1】 |
| 单二进制被误解为单进程 | server 异常退出会同时中断 instance/ACP，直接破坏 P3 | 只合并发布物；local 使用同一可执行文件的独立 `connect` 进程，后台托管使用两个 service（ADR-0001） |

开放问题（排期时确认）：

1. ~~心跳间隔与离线判定阈值~~ → 已入配置默认值表（§16，5s/30s 可配置）。
2. `ai` 消息聚合截断长度（建议 4KB）是否按端区分（Web 可折叠全文）。**裁决方向**【顾问2：P1-2】：长度上限按端保留，但脱敏优先于截断（§9.3）；正式方案排期确认。
3. ~~归档策略正式方案~~ → 已由无状态投影重构解决：无归档机制（§8.4），视图由 ACP 重放重建。
4. `projection_version` 乐观并发校验（`VERSION_CONFLICT`）：字段与错误码已预留，**M1 不强制校验**（与 §4.4 对齐）。**裁决方向**【顾问2：P1-3】：M1 依赖服务端实际状态 + 终态守卫 + commandId 幂等；**引入并发客户端、可编辑投影或改变命令含义的操作之前，强制执行 `projection_version` 并测试 `VERSION_CONFLICT`**——单用户不等于单连接，重连后的旧面板镜像可能基于过期投影发指令。

---

## 15. 参考实现映射（chat-channel → peri-studio）

> 参考路径：`/Users/konghayao/code/pazhou/remote-control-server/packages/chat-channel/`（实现基线 `docs/arch/19-yjs-chat-streaming.md`）。

| chat-channel 组件 | peri-studio 对应 | 差异说明 |
|------------------|-------------|---------|
| `protocol/acp-channel.ts`（入站规范化） | `server/src/protocol/acp-channel` | 同构；输入来自 instance 转发的原始 ACP 帧而非直接 relay |
| `protocol/translator.ts`（出站翻译） | `server/src/protocol/translator` | 同构；`cwd`/`rpcId` 由 server 注入 |
| `state/aggregator.ts`（幂等投影） | `server/src/state/aggregator` | 同构（turnId/entryId/toolCallId/permissionId 幂等键、纯投影）；**新增 interrupted 校准例外**（chat 无此语义，§6.3） |
| `state/chat-writer.ts`（doc 写入原语） | `server/src/state/chat-writer` | 同构 |
| `state/doc-manager.ts`（doc 生命周期+16ms 微批次） | `server/src/state/doc-manager` | 同构；peri-studio 增加 Registry Doc 与每 chat 单写者约束（§7.4） |
| `state/permission.ts`（权限 CAS） | `server/src/state/permission` | 同构 |
| `state/session-list.ts`（10s 轮询全量同步） | `server/src/state/session-list` | **差异**：投影目标是 agent 磁盘历史（§5.2 裁决），与 chat「实例级对话列表」语义不同；活跃 chat 列表由 Registry 单写 |
| `channel/gateway.ts`（ws 生命周期/快照时序/keep_alive） | `server/src/channel/gateway` | 同构；补 `ready`/`pong`/`ysync.subscribe` 帧 |
| `channel/command-coordinator.ts`（串行队列+commandId 去重） | `server/src/channel/command-coordinator` | 同构；**去重记录在内存 command outbox**（chat 为进程内 Map；peri-studio 同为内存态、重启即空，命令不重发，§4.4）【顾问：P0-1】 |
| `channel/relay-event-handler.ts`（入站消费+断链清理） | `server/src/channel/relay-event-handler` | 入站源从 relay 变为 instance ws；断链语义差异见 §8.2 |
| `channel/broadcaster.ts`（fan-out+64KB 背压） | `server/src/channel/broadcaster` | 同构 |
| `channel/connection-registry.ts`（配额） | `server/src/channel/connection-registry` | 同构 |
| `persist/redis.ts`（Redis 快照 CAS） | `server/src/persist`（内存 store + metadata.sqlite3） | **差异**：M1–M3 单节点无需 Redis；无投影日志（§8.4：无落盘契约），唯一持久化产物为 metadata.sqlite3 |
| `transport/ws.ts`（前端同构 WS 客户端） | `web/src/panel/lib/ws-client` + `peri-studio-proto`【v2.6：原 tui/src/transport 未实现】 | 同构 |
| Chat Doc / Control Doc schema | 同 schema（§5.3/§5.4） | Registry Doc 为 peri-studio 新增；**Chat Doc 不含去重记录**（peri-studio 去重记录在 outbox，§4.4）【顾问：P0-1】 |
| 事件日志体系/租约 | 不实现 | 同 chat Q5 评审决策；内存 outbox 去重（§4.4）替代进程内 Map |
| 4004 关闭码 | 已删除 | chat 对应 environment 概念，peri-studio 无（§4.7） |

**已吸收的核心设计原则**（chat §2.1）：服务端单写、YJS 是实时状态投影不是命令总线、权威数据在 ACP 进程侧、传输至少一次/效果恰好一次、流式增量可丢/最终状态不可丢、慢消费者不阻塞 Agent。

---

## 16. 配置（新增章节）【审查：运维 P1-2】

配置来源优先级：**CLI > 环境变量（`PERI_STUDIO_*` 前缀，如 `PERI_STUDIO_LISTEN_ADDR` / `PERI_STUDIO_LISTEN_PORT` / `PERI_STUDIO_DATA_DIR` / `PERI_STUDIO_CONFIG_DIR` / `PERI_STUDIO_ACP_CMD`）> 配置文件（`~/.config/peri-studio/config.toml`）> 默认值**。远程 instance 的 server 地址由 `connect <URL>` 显式提供，凭据路径可由 `PERI_STUDIO_TOKEN_FILE` 注入；不再存在独立 daemon 的隐式默认远程地址。【v2.7】环境变量由 clap `env` 注入，与 CLI flag 同名映射。

| 项 | 默认值 | 说明 |
|----|--------|------|
| 监听地址 | `127.0.0.1` | M1 本机；M2 局域网显式配置为局域网地址/0.0.0.0（**明文 ws 暴露面由此决定**） |
| 监听端口 | `8456` | 可配置 |
| 数据目录 | `~/.local/share/peri-studio/` | 0600 |
| 配置/token 目录 | `~/.config/peri-studio/` | 0600 |
| 心跳间隔 / 离线判定 | 5s / 30s | §7.1 |
| 缓冲上限（内存+磁盘合计） | 10MB / 万条 | §8.5 |
| 单帧大小上限 | 1MB | §8.5 |
| 命令队列上限 | 64 | §7.4 |
| 连接配额 | 200 | §8.6 |
| 发送背压软/硬阈值 | 64KB / 128KB | §8.6 |
| 微批次窗口 | 16ms | §6.4 |
| 回放窗口 | 10s | §8.6 |
| 权限请求超时 | 5min | §7.1 |
| 取消超时 | 10s | §7.1 |
| spawn / initialize / binding 超时 | 10s / 10s / 30s | §6.2 |
| instance 单帧写超时 | 10s | §8.6；背压超时 == 断线 → 缓冲补推 |
| 缓冲环形滑窗 | 500 条 | §8.5 |
| spawn env 白名单 | 空（仅继承基集） | §9.6；键名白名单，白名单外拒绝 |
| 非回环监听开关 | `allow_non_loopback: false` | §9.5；显式声明才接受非回环连接 |

（开放问题 1 由此表解决，删除 v2.0 中「5s/30s 先固定」的表述矛盾。）

---

## 17. 可观测性与 SLO（新增章节）【审查：运维 P1-3】

### 17.1 指标清单（tracing 字段来源，结构化日志可聚合）

| 类别 | 指标 |
|------|------|
| 连接 | 在线连接数、认证失败次数（按 token_id）、重连率、心跳超时次数、背压断连次数 |
| instance | 在线/离线数、缓冲水位（每 instance）、**缓冲溢出字节数与丢弃帧数（delta/控制帧分类）**、buffer_lost 次数 |
| 同步 | 初始同步耗时、gap 计数与缺口帧数、补推重放耗时与 backlog、实时/补推乱序丢弃数 |
| 聚合 | 聚合队列深度、微批次延迟、晚到丢弃数、去重命中数 |
| 持久化 | UpdateSink 投递失败次数（§17.2 degraded 输入）、内存镜像重建耗时（§8.4：无落盘/fsync/compact） |
| 对话 | chat 创建/binding 成功率与耗时、turn 终态分布、权限请求/过期/决议计数 |

### 17.2 Degraded 判定规则（Registry Doc `global.status`）

以下任一触发 `Degraded`：**UpdateSink 投递失败 / 终态无法建立**（§8.4：无落盘路径，原「落盘失败」语义由 `PersistFailed`（sink 投递失败）与 `mark_terminal_state_unavailable`（终态无法建立的 fail-closed）承担）/ 缓冲溢出丢弃 / 任一存活 chat 存在 gap / 镜像失败（聚合器异常）/ **启动恢复不变量失败（§8.4.1）**【顾问：P0-5】。`Restarting` 从 server 启动装配持续到所有待恢复 instance 的首份权威心跳完成对账与 resume barrier；hello 不能提前开门。判定规则集中实现于 server 状态源，面板状态栏呈现。

### 17.3 最小 SLO（对照 chat §12.2 缩放到本地单节点）

| SLO | 目标 |
|-----|------|
| 视图恢复（断线重连到可交互） | P95 < 2s |
| 已缓冲帧补推不丢 | 100%（缓冲未溢出前提下） |
| 已提交消息丢失率 | 0（`committed` = ACP 已确认接收，§4.4） |

---

## 附录 A：对抗面试与审查决策记录

| # | 议题 | 裁决 |
|---|------|------|
| 1 | 核心场景 | 本机常驻 + 局域网扩展；公网/多用户后置 |
| 2 | 多端定义 | 多 TUI + 未来 Web 面板；IDE 走 ACP 协议不进 yjs |
| 3 | TUI 操作权 | 可操作；控制走 Action/Ack（请求-响应），视图走 yjs |
| 4 | 项目定位 | peri-studio 是独立项目；与 peri 唯一耦合 = ACP 进程 |
| 5 | 二进制形态（已被 #37 取代） | 历史裁决：server 与 instance 两个独立二进制（共享 proto crate） |
| 6 | instance 接入 | instance 主动 outbound 连接 + token 注册 + 心跳 |
| 7 | 断线语义 | instance 断线 → 其上 chat 标记 interrupted，绑定不迁移 |
| 8 | chat 调度 | 显式指定 instance + 默认本机 |
| 9 | yjs 边界 | ACP 事件聚合为视图对象进 yjs；原始事件走独立订阅 |
| 10 | 通道组织 | 单 ws 连接多路复用（Action/Ack + y-sync） |
| 11 | 认证模型 | server 签发 token，instance/client 角色分权 |
| 12 | server 韧性 | server 崩溃 agent 继续跑；instance 缓冲补推 |
| 13 | 聚合参考实现 | 聚合逻辑参照 `@fenix/chat-channel`（用户指定） |
| 14 | 文档拆分 | 每 chat 双 Doc（Chat/Session）+ 全局 Registry Doc（chat §5.1 同源） |
| 15 | 控制面语义 | Action/Ack 两阶段 + commandId 幂等 + 稳定错误码（chat §7.1） |
| 16 | 幂等与终态 | turnId/entryId/toolCallId/permissionId 幂等键 + turn 终态不可逆（chat §6.3/§8.1） |
| 17 | interrupted 校准【审查】 | interrupted 为可校准 turn 级终态；chat 级 gap 可恢复（§7.3） |
| 18 | 去重持久化【审查】 | committed 记录入 server command outbox（v2.1 曾裁决入 Session/Chat Doc，v2.2 由顾问 P0-1 推翻——Y.Doc 是可丢弃镜像，去重事实必须独立于 Doc 生命周期）；提交点纪律（§4.4） |
| 19 | 单写者与提交边界【审查】 | 每 chat writer task 串行化；DocManager 为唯一提交边界（§5.6/§7.4） |
| 20 | 双向认证【审查】 | instance hello 携带 nonce，server 以 HMAC 应答；校验前不执行指令（§9.2） |
| 21 | instance 崩溃语义【审查】 | 缓冲不跨重启 + buffer_lost 上报 + 孤儿进程默认 kill 清理（§7.5） |
| 22 | command outbox【顾问】 | 去重记录移出 Y.Doc 独立持久化；delivery_confirmed 三级（L1 ws/L2 stdin/L3 ACP）；崩溃点×重试行为表（§4.4） |
| 23 | stream_epoch【顾问】 | per-chat 流纪元，daemon 重启/进程重建 +1；epoch 相同补推 last_seq+1，变化 → 不可校准 gap（§4.5.1） |
| 24 | P3 有界保证【顾问】 | 「产出不丢」改写为缓冲上限内不丢 + 溢出按策略丢弃 + gap 呈现，不承诺无限缓冲（§8.3/§8.5） |
| 25 | server-authoritative yjs【顾问】 | ysync.update 单向 S→C；客户端上行拒绝；不采用双向 CRDT 握手，同步 = 快照+增量广播（§5.6） |
| 26 | 恢复不变量【顾问】 | outbox 先行 → last_seq 对齐 → Doc 补齐 → instance 对账后开门；任一失败降级 degraded（§8.4.1） |
| 27 | minimal IDL 与授权收窄【顾问】 | MVP-M1 帧集白名单 + 测试向量（§4.8）；M1 token 即身份 + spawn env 白名单 + 非回环默认拒绝（§9.5/§9.6） |
| 28 | HMAC 双向认证保留【顾问，否决删减】 | advisor 建议删除（链路级信任替代），被否决——server→instance 验证在明文 ws 阶段防冒充，M4 wss 是补充非替代（§9.2） |
| 29 | delivery_unknown【顾问2】 | L3 依赖 peri ACP 关联 ID 能力，M1 前二选一裁决：路径 A（支持）关联 ID 查询 / 路径 B（不支持）非幂等命令禁止盲重试 + 对账/人工；未裁决前按路径 B 实现（§4.4） |
| 30 | HMAC 协议级规范【顾问2】 | 双向随机 challenge + 连接绑定 + 单次使用窗口 + 角色/版本绑定 + 身份隔离 + 轮换路径；HMAC 不提供机密性，M4 强制 TLS（§9.2） |
| 31 | 归档与 outbox 解耦【顾问2】 | 视图历史可裁剪；命令账本按未裁决状态保留，删除前置条件四合一（chat 关闭 + instance 注销 + outbox 全终态 + 保留期届满，§8.4） |
| 32 | 错误截断脱敏优先【顾问2】 | 错误码 + allowlist 摘要字段；截断前剔除敏感字段（§9.3） |
| 33 | projection_version 强制时机【顾问2】 | M1 不强制；引入并发客户端/可编辑投影前强制执行并测试 VERSION_CONFLICT（§14 开放问题 4） |
| 34 | 决策门禁与幂等分类【顾问3】 | 关联 ID 确认从开工门禁降为发布前决策门禁（路径 B 兜底开工）；未分类命令默认禁止自动重发（§4.4） |
| 35 | delivery_unknown runbook【顾问3】 | 裁决入口/权限/依据状态/三种迁移结果/审计记录；可查询可持久化可展示，不静默丢弃（§4.4） |
| 36 | HMAC 线格式精度【顾问3】 | HMAC-SHA256 + 固定字节序 MAC 输入 + 常量时间比较 + HKDF 派生；字节级测试向量（§9.2） |
| 37 | 单发布物、双进程角色【v2.7】 | 发布仅 `peri-studio`；server/instance 仍为独立故障域，local 通过同一可执行文件的 `connect` 子进程走真实 `/instance` ws + HMAC（ADR-0001） |
| 38 | SSH 机器供应器【v2.16】 | SSH = 安装/token/`ssh -R`；监督在 `app/`；SSH 不进全局 Restarting；Disconnect≠Stop；destination 唯一；cwd 在目标机器上选；wire 只用既有 ErrorCode（ADR-0002，[设计](design/ssh-machine-mount.md)） |

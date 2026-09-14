---
status: audit
date: 2026-09-14
scope: static, five primary user paths, no runtime started
---

# Peri Studio 静态稳定性排查（2026-09-14）

> 静态代码审计记录，供后续对抗 reviewer 逐条核对证据。未启动 `./dev.sh` / server / instance；行为结论均来自源码与单测契约，非运行时复现。

## 范围

| 维度 | 说明 |
|------|------|
| 方法 | 只读源码 + 现有单测/契约测试路径 |
| 日期 | 2026-09-14 |
| 用户主路径 | 连接与认证、对话（Composer / transcript）、侧栏（catalog / session）、工作台（Explorer / SCM / Graph / Terminal）、后端（server / instance / persist） |
| 排除 | 未启动本地 server/instance；性能压测、像素/UI 回归、第三方 ACP 实现差异 |

## 总体判断

当前架构在 **commandId 幂等、delivery_unknown fail-closed、身份边界 reset、资源 project 租约** 等关键面上已有较完整的设计意图与测试锚点，但 **重连与 catalog 就绪时序**、**server 重启后内存 outbox 与 Web uncertain 状态组合**、**离线/只读门禁不一致**、**工作台跨 project 状态残留** 四类问题会在真实断线/重启/多 tab 场景下放大为用户可感知故障。P1 共 15 条，多数可在连接恢复、侧栏导航、资源预览三条路径上交叉验证；P2 共 23 条，多为体验缺口、可观测性或边界条件下的债务。

## 已有防护（不当稳定性缺陷）

以下行为经源码确认为 **有意设计** 或已有专门测试，reviewer 不应按缺陷回归：

| 项 | 证据 | 说明 |
|----|------|------|
| 工作台文件预览只读 | `web/src/widgets/resource/ResourceFileEditor.tsx`（`Read-only` 文案；无 save 路径） | 浮动预览为只读查看；非编辑器缺陷 |
| `delivery_unknown` fail-closed | `web/src/features/message/message-delivery.ts` `ACKNOWLEDGED_UNKNOWN_LIMIT`；`message-delivery.test.ts`「fails closed instead of evicting…」 | 全局归档满 20 条后拒绝新 acknowledge 是契约，但会导致 Composer 锁死（见 S-09） |
| `PersistedSessionCreate` SQLite 去重 | `server/src/channel/metadata_command_processor.rs` `BeginCommand::Existing` 分支 | 元数据层 create 有持久化去重；与内存 outbox `ProceedNew` 不对齐（见 S-02） |
| Session pin 绑定 principal | `web/src/features/session/session-pins.ts` `storageKey(principalId)` | 与 `last-session` 未绑定 principal 形成对比（见 S-08） |
| 上传/FS 变更 read-only 拦截 | `web/src/features/catalog/catalog-actions.ts` `canMutate`；`web/src/store/workspace-upload.ts` `uploadBlockMessage` | read-only 下 catalog 变更与上传有门禁；discover 被跳过是另一问题（见 S-17） |

---

## 缺陷清单

### P1

#### S-01 — WS 重连后 catalog 未就绪时 session 永久 Loading

| 字段 | 内容 |
|------|------|
| **严重度** | P1 |
| **用户影响** | 重连后已选 session 卡在「Loading session…」，Composer 可打字但无法发送，侧栏 session 看似选中却无 transcript |
| **来源流** | 连接 / 对话 |
| **证据** | `web/src/store/index.ts` `onReady`（L459–468）：`reactivateAfterReconnect()` 在 `scheduleSessionCatalogBootstrap()` 之前；`web/src/features/session/session-activation.ts` `reactivateAfterReconnect`（L204–215）：`lifecycle !== 'ready'` 时直接 `return`；`web/src/features/session/session-navigator.ts` `reconcileCatalog`（L102–120）：`selectedSessionId` 已存在时 `return []`，不再 `request-open`；`web/src/features/connection/connection.ts` `onConnectionLost` / `settleConnectionLoss`；`web/src/features/composer/composer-placeholder.ts`（L53–54）`Loading session…` |
| **复现场景** | server 重启或 WS 闪断 → 重连 `ready` 帧先于 `session/discover` 填满 catalog → 用户此前已选 sessionId → `reactivateAfterReconnect` 因 lifecycle 非 ready 空跑 → 后续 `reconcileCatalog` 因 `selectedSessionId` 非空跳过 open |
| **建议修复** | 将 `reactivateAfterReconnect` 延后到 catalog bootstrap 完成（或 navigator 增加「待重开 sessionId」队列）；或在 `reconcileCatalog` 对「已选但无 live runtime」显式 `request-open` |

#### S-02 — server 重启后内存 outbox 清空，同 commandId 重确认可能二次 spawn/prompt

| 字段 | 内容 |
|------|------|
| **严重度** | P1 |
| **用户影响** | 断线后以同一 commandId 重确认，可能再次创建 runtime 或重复 prompt，违背「同 commandId 不产生二次副作用」契约 |
| **来源流** | 后端 / 连接 |
| **证据** | `server/src/persist/mod.rs`（L7–8）：outbox **内存**、重启即空；`server/src/channel/coordinator_assembly.rs` `rebuild_create_index`；`server/src/channel/queued_submission.rs` `ExistingCommandDisposition::ProceedNew`（L71–72）继续 `prepare_create`；`server/src/persist/outbox_reconcile.rs` 存在但 Web 重确认路径不经过其对账；对比 `server/src/channel/metadata_command_processor.rs` `PersistedSessionCreate` 的 SQLite `BeginCommand::Existing` |
| **复现场景** | server 重启 → 内存 outbox 丢失 → 客户端带原 commandId 重发 create/prompt → broker 判 `ProceedNew` → 二次副作用 |
| **建议修复** | 重启后将 create/prompt 去重与 `metadata.sqlite3` command 表或 ACP 现场对账统一；`ProceedNew` 前增加持久化 command 终态检查 |

#### S-03 — Web 重连保留 uncertain，与 S-02 组合放大重复副作用

| 字段 | 内容 |
|------|------|
| **严重度** | P1 |
| **用户影响** | 断线后 UI 仍显示「Confirm with the same request」，用户重确认时 server 已无 outbox 记忆，重复执行风险上升 |
| **来源流** | 连接 / 对话 |
| **证据** | `web/src/features/connection/command-tracker.ts` `makeUncertain`（L188+）、`settleConnectionLoss`（L125–126）；`web/src/features/connection/connection.ts` `disconnect` / `reconnecting` / `closed` 均调用 `settleConnectionLoss` |
| **复现场景** | 提交 create/prompt 后断线 → `settleConnectionLoss` 将全部 pending 标 uncertain → 重连后 server outbox 已空（S-02）→ 用户点重确认 |
| **建议修复** | 与 S-02 一并：重连后查询 `session/prompt-status` 或 server 重放证据，再决定能否重确认 |

#### S-04 — orphan kill 失败只 warn，无重试

| 字段 | 内容 |
|------|------|
| **严重度** | P1 |
| **用户影响** | 意外存活 chat 可能长期占用 instance 资源，Registry 与现场不一致 |
| **来源流** | 后端 |
| **证据** | `server/src/control/instance_commands.rs` `kill_chats`（L343–363）、`reconcile_and_kill`（L311–319）：`send_kill` 失败仅 `warn!(…, "orphan kill failed")`，无重试队列 |
| **复现场景** | instance 短暂不可达时 orphan 裁决下发 kill → 单次失败 → chat 仍存活 |
| **建议修复** | 将失败 sid 写入待重试集合（指数退避），或在下次 reconcile 周期重试 |

#### S-05 — session/discover 失败被吞，侧栏当没有会话

| 字段 | 内容 |
|------|------|
| **严重度** | P1 |
| **用户影响** | ACP 会话实际存在但侧栏显示空项目 +「Start your first conversation」，误导用户重复 create |
| **来源流** | 侧栏 / 连接 |
| **证据** | `web/src/features/catalog/session-catalog-bootstrap.ts` `discover(projectId, onSettled)`（L46–51）：无论 `discover` 成败 `onSettled` 都会推进队列；`web/src/features/catalog/catalog-actions.ts` `discoverSessions` `onFailed` 文案（L201–205）仅回调、无全局 surfacing；`web/src/widgets/sidebar/project-sidebar-tree.tsx` 空态 CTA（L137–149） |
| **复现场景** | discover 超时或 instance 错误 → bootstrap 继续 → `project_sessions` 仍空 → 空态 CTA |
| **建议修复** | discover 失败时保留 error 状态、禁止空态 CTA，或项目级 InlineNotice + 重试 |

#### S-06 — 离线 remote 仍可 New project / New session / 点进 session

| 字段 | 内容 |
|------|------|
| **严重度** | P1 |
| **用户影响** | instance 离线时用户仍可发起创建/导航，操作悬空或超时，无前置禁用 |
| **来源流** | 侧栏 / 连接 |
| **证据** | `web/src/widgets/sidebar/project-sidebar-tree.tsx`：`New project` 仅 `disabled={readOnly()}`（L65）；`createProjectSession` 仅 `readOnly \|\| creating`（L145）；`ProjectSessionRow` 无 offline prop；`web/src/widgets/sidebar/project-sidebar-model.ts` `submitProject`（L185）仅 submit 时检查 `machineOnline`；`web/src/features/session/session-activation.ts` `mutationRejection` 只查 `isReady()` 不查 instance 在线 |
| **复现场景** | remote instance `status: offline` → 侧栏仍显示 New project / New session → 点击 session 行触发 `session/open` |
| **建议修复** | instance 离线时禁用创建/打开，或在 `SessionActivation` 增加 instance 可达性门禁 |

#### S-07 — 登出 DELETE 失败仍切 signed-out，cookie 残留

| 字段 | 内容 |
|------|------|
| **严重度** | P1 |
| **用户影响** | 用户以为已登出，刷新页面又自动登录；多用户/共享机器上有会话残留风险 |
| **来源流** | 连接 |
| **证据** | `web/src/features/auth/auth-hook.ts` `logout`（L278–289）：先 `setState('signed-out')`，再 `await fetch(DELETE)`；catch 仅 `setProblem`，不回滚状态 |
| **复现场景** | 网络断开时登出 → UI 已 signed-out → HttpOnly cookie 仍在 → 刷新 `status` 成功 → 自动 signed-in |
| **建议修复** | DELETE 成功后再切状态；或失败时保持 signed-in 并阻断导航 |

#### S-08 — last-session 不绑 principal，reset 不清记忆

| 字段 | 内容 |
|------|------|
| **严重度** | P1 |
| **用户影响** | 切换账号后可能打开上一用户的 session 偏好；登出/身份重置后仍尝试恢复旧 session |
| **来源流** | 连接 / 侧栏 |
| **证据** | `web/src/features/connection/connection.ts` `LAST_SESSION_KEY = 'peri-studio:last-session'`（L36–120）；`web/src/store/reset-session.ts` `resetAuthenticatedSession` 未调用 `forgetRememberedSession`；对比 `web/src/features/session/session-pins.ts` `storageKey(principalId)` |
| **复现场景** | 用户 A 登录并选中 session → 登出 → 用户 B 登录 → navigator 仍读 A 的 last-session |
| **建议修复** | last-session 键加入 `principalId`；`resetAuthenticatedSession` 显式 `forgetRememberedSession` |

#### S-09 — delivery_unknown 全局归档满 20 条后 Composer 锁死

| 字段 | 内容 |
|------|------|
| **严重度** | P1 |
| **用户影响** | 长期使用者积累 20 条已确认 unknown 后，新 delivery_unknown 永远无法 acknowledge，Composer 永久 `sendLocked` |
| **来源流** | 对话 |
| **证据** | `web/src/features/message/message-delivery.ts` `ACKNOWLEDGED_UNKNOWN_LIMIT = 20`、`canAcknowledgeUnknownMessageDelivery`；`web/src/widgets/composer/useComposerState.ts` `submissionDetail`（L100–102）；`web/src/features/message/message-delivery.test.ts`「fails closed instead of evicting unresolved evidence after twenty deliveries」 |
| **复现场景** | 累计 20 条 `acknowledgedUnknown` → 第 21 条 delivery_unknown 且已有 projection → `canAcknowledge` 恒 false |
| **建议修复** | 按 session/chat 分桶限额、可归档导出、或允许驱逐最旧已确认项 |

#### S-10 — Stop generation 明确失败无 UI

| 字段 | 内容 |
|------|------|
| **严重度** | P1 |
| **用户影响** | 用户点击 Stop 后 server 拒绝，无 InlineNotice/toast，仅 cancel 按钮状态变化 |
| **来源流** | 对话 |
| **证据** | `web/src/features/message/user-actions.ts` `cancelTurn` → `failRuntimeControl`（L183）；`web/src/features/runtime/runtime-control.ts` `failRuntimeControl` 设 `phase: 'failed'`；`web/src/widgets/composer/Composer.tsx` `notices`（L338+）含 voice / prompt / **message submission**，不含 `cancelControl().detail` |
| **复现场景** | turn 进行中 Stop → server 返回错误 → `failRuntimeControl` → Composer 无失败文案 |
| **建议修复** | `cancelControl()?.phase === 'failed'` 时渲染 `InlineNotice` 展示 `detail` |

#### S-11 — 非 grep/glob 工具仅凭 path 被当成 read-file 可点击

| 字段 | 内容 |
|------|------|
| **严重度** | P1 |
| **用户影响** | 工具参数含 `path` 的非读文件工具（如部分 MCP 工具）显示为可打开文件，点击后预览错误文件或空路径 |
| **来源流** | 对话 / 工作台 |
| **证据** | `web/src/features/chat/tool-narration.ts` `resolveToolCardKind`（L137–140）：`file_path`/`path` 默认识别为 `read-file`；`supportsFilePreview`（L146–148）仅排除非 read/edit/write；`web/src/widgets/chat/ToolCallActivity.tsx` 经 `openWorkspaceFromTool` 打开预览；`web/src/features/chat/tool-file-link.ts` 生产路径仅被 `tool-narration` / `open-workspace-from-tool` 引用 `normalizeWorkspaceRelativePath`，**未**用 `isStableFilesystemToolPath` 过滤 |
| **复现场景** | 工具名未知但 arguments 含 `path` → 卡片显示文件链接 → 点击打开 Explorer |
| **建议修复** | 复用 `tool-file-link` 稳定路径规则；grep/glob 与 read/write/edit 分流 |

#### S-12 — 工具文件链接不 activateResourceProject

| 字段 | 内容 |
|------|------|
| **严重度** | P1 |
| **用户影响** | 从 chat 点工具文件链接触发预览时，可能仍绑定上一 project 的资源租约，打开错误工作区文件 |
| **来源流** | 对话 / 工作台 |
| **证据** | `web/src/features/resource/open-workspace-from-tool.ts`：仅 `requestWorkbench` + `openFilePreview`；`web/src/features/resource/resource-store.ts` `openFilePreview` 使用当前 `resourceWorkspace().projectId`；`web/src/widgets/resource/ResourceWorkbench.tsx`（L138–142）`activateResourceProject` 仅在 explorer/scm/graph 面板打开时；对比 `web/src/store/workspace-upload.ts`（L185）上传前会 `activateResourceProject` |
| **复现场景** | project A 打开过工作台 → 切到 project B 的 session 但未打开工作台 → 点 Read 工具路径 → 预览仍在 project A |
| **建议修复** | `openWorkspaceFromTool` 注入当前 session 的 `projectId` 并先 `activateResourceProject` |

#### S-13 — 切 project 后 Explorer/FS 冲突/Terminal cwd 残留

| 字段 | 内容 |
|------|------|
| **严重度** | P1 |
| **用户影响** | 切换 project 后 Explorer 展开与选中路径、FS 冲突横幅、Terminal cwd 可能仍指向上一个 project |
| **来源流** | 工作台 |
| **证据** | `web/src/widgets/resource/ResourceWorkbench.tsx` `explorerExpanded` / `explorerActivePath` 等为组件本地 signal，不随 project 重置；`web/src/store/fs-mutations.ts` 全局 `fsMutationState`；`resetResourceProject`（`resource-store.ts`）不调用 `clearFsMutation`；`web/src/features/terminal/terminal-session.ts`（L120）`projectId` 在 open 时绑定；`resetTerminalSession` 仅在 `reset-session.ts` 登出路径调用 |
| **复现场景** | project A 展开 `src/` 并触发 FS 冲突 → 切到 project B session → 展开态/横幅/terminal cwd 残留 |
| **建议修复** | `selectedSessionId` / project 变化时重置 explorer 本地态、`clearFsMutation`、必要时 `resetTerminalSession` 或 re-open terminal |

#### S-14 — Graph 顶栏 Refresh 固定 repositories[0]

| 字段 | 内容 |
|------|------|
| **严重度** | P1 |
| **用户影响** | 多 repo 工作区在 Graph 视图选中非首个 repo 时，顶栏 Refresh 刷新错误仓库 |
| **来源流** | 工作台 |
| **证据** | `web/src/widgets/resource/ResourceWorkbench.tsx`（L207–214）：`resourceWorkspace().repositories[0]`；对比 `web/src/widgets/resource/git/GitGraphView.tsx` `activeGraphRepoId`（L27–33） |
| **复现场景** | 两仓库 → Graph 内切换 repo B → 点壳层 Refresh → 实际 refresh repo A |
| **建议修复** | 与 `GitGraphView` 共用 `activeGraphRepoId` 或提升选中 repo 到 store |

#### S-15 — SCM 点变更打开磁盘全文，不走 GitDiff

| 字段 | 内容 |
|------|------|
| **严重度** | P1 |
| **用户影响** | Source Control 点击变更打开工作区文件全文，无法看到 diff；staged 变更同样不准 |
| **来源流** | 工作台 / 后端 |
| **证据** | `web/src/widgets/resource/SourceControlPanel.tsx` `previewChange` → `openFilePreview(path)`（L72–76）；`web/src/features/resource/resource-protocol.ts` `kind: 'file'`；`server/src/control/resource_service.rs` / `instance/src/resource_git_diff.rs` 已实现 `GitDiff`；`web/src/widgets/resource/ResourcePanels.test.tsx`（L446–450）断言 `payload: { kind: 'file', path }` |
| **复现场景** | SCM 点击 modified 文件 → 预览磁盘当前内容而非 diff |
| **建议修复** | `previewChange` 改为 `GitDiff` query + `GitDiffPanel`（`@peri/ui` 已有） |

---

### P2

#### 连接与认证

| ID | 严重度 | 摘要 | 用户影响 | 证据路径 + 符号 | 复现场景 | 建议修复 | 来源流 |
|----|--------|------|----------|-----------------|----------|----------|--------|
| S-16 | P2 | auth_busy 时客户端不消费 Retry-After | 503 时固定文案重试，无法按服务端建议退避 | `server/src/web/auth_http.rs`（`Retry-After: 1`）；`web/src/features/auth/auth-feedback.ts` `authFeedback` 对 5xx 泛化、不读响应头 | 并发 auth 锁竞争 → 503 auth_busy | 解析 `Retry-After` 或 `setup` 字段驱动退避 | 连接 |
| S-17 | P2 | read-only 跳过 session discover | 只读 token 重连后 catalog 可能长期缺 project_sessions | `web/src/features/catalog/session-catalog-bootstrap.ts` `schedule`/`drain`（L37–40、L65）`isReadOnly()` 直接 return | read-only 连接就绪 | 只读允许 discover（不写 ACP）或显式提示 catalog 不完整 | 连接 / 侧栏 |

#### 侧栏与搜索

| ID | 严重度 | 摘要 | 用户影响 | 证据路径 + 符号 | 复现场景 | 建议修复 | 来源流 |
|----|--------|------|----------|-----------------|----------|----------|--------|
| S-18 | P2 | instance 行仅显示 Offline | SSH connecting 等 pipeline phase 不可见 | `web/src/widgets/sidebar/project-sidebar-tree.tsx`（L54–58）仅 `offline` 标签；对比 `web/src/entities/machine/machine-view.ts` `machinePhaseLabel` / `MachineRow` pipeline UI | remote instance 正在 connecting | 侧栏 instance 行复用 machine phase 文案 | 侧栏 |
| S-19 | P2 | WS 4500 未从 server 发送 | 客户端处理 4500「instance offline」，但 server 可能从不发此码 | `web/src/features/connection/connection.ts`（L170）；`server/src/control/close_codes.rs` `CLOSE_INSTANCE_OFFLINE` 定义；全仓库无 `finish_connection(..., 4500)` 调用 | instance 离线 | instance 下线时主动 4500 关闭浏览器 WS | 连接 / 后端 |
| S-20 | P2 | 搜索时 catalog 未就绪当空 | Cmd+K 搜索在 discover 前返回空结果 | `web/src/widgets/sidebar/SessionSearch.tsx` `searchProjectSessions` 直接读 `projectSessions()`，无 bootstrap pending 门禁 | 重连后立即搜索 | pending 时显示「Catalog loading」而非空 | 侧栏 |
| S-21 | P2 | 归档 / failed session 搜不到 | 无法从搜索进入归档或失败 session | `web/src/widgets/sidebar/SessionSearch.tsx`（L20–21）过滤 `!archivedAt`；`optionDisabled` 要求 `lifecycle === 'ready'` | 搜索已归档 session 名 | 扩展索引或单独「Archived search」 | 侧栏 |
| S-22 | P2 | 重命名失败无 toast | 重命名被拒时表单关闭但无反馈 | `web/src/features/session/form-mutation.ts` `onFailed` 仅 `stop()`；`project-sidebar-remote-dir.tsx` / `ProjectSessionRow.tsx` `runConfirmedMutation` 无 toast | rename 服务端错误 | `onFailed` 时 `toast` 或 InlineNotice | 侧栏 |
| S-23 | P2 | 并发 archive/restore 静默丢弃 | 快速连点归档/恢复，第二次 `already_pending` 无提示 | `web/src/store/index.ts` `sendAction`（L183–184）`already_pending` → `return false`；`catalog-actions.ts` 无队列 | 双击 archive | 返回 false 时 toast「操作进行中」 | 侧栏 |
| S-24 | P2 | 无 URL 深链 | 无法通过 URL 打开指定 project/session | `web/src/app/main.tsx` 仅渲染 `PanelPage`；`web/src/pages/panel/index.tsx` 无路由参数 | 分享链接、刷新恢复选中态 | 可选 hash/query 同步 `selectedSessionId` | 侧栏 |

#### 对话与 Composer

| ID | 严重度 | 摘要 | 用户影响 | 证据路径 + 符号 | 复现场景 | 建议修复 | 来源流 |
|----|--------|------|----------|-----------------|----------|----------|--------|
| S-25 | P2 | 上传未完成可发送 | 附件仍 uploading 时可发消息，引用未就绪文件 | `web/src/widgets/composer/useComposerState.ts` `sendLocked` 未检查 `workspaceUploadBatch`；`workspace-upload.ts` `busy` 仅用于 batch 状态 | 大文件上传中断网发送 | `sendLocked` 含 upload `busy` | 对话 |
| S-26 | P2 | Voice onclose 静默 | 语音 socket 异常关闭可能无用户可见错误 | `web/src/features/voice/dictation.ts`（L111–113）`onclose` 仅 `closeSession()`，不 `onError` | 上游断连 | onclose 且未 stopped 时 `onError` | 对话 |
| S-27 | P2 | Terminal 打开时仍可口述 | Terminal 面板与 Composer 语音无互斥 | `web/src/widgets/composer/Composer.tsx` voice 按钮未读 terminal 面板态；`TerminalPanel` 与 dictation 独立 | Terminal running + 语音输入 | 互斥或提示 | 对话 / 工作台 |
| S-28 | P2 | 虚拟化 transcript a11y 缺口 | `role="list"` 下无 `listitem`，屏幕阅读器难枚举消息 | `web/src/widgets/chat/MessageList.tsx`（L336）；`MessageList.test.tsx` 断言无 `[role="listitem"]` | 键盘/读屏浏览长 transcript | 虚拟行暴露 `role="listitem"` + posinset | 对话 |

#### 工作台

| ID | 严重度 | 摘要 | 用户影响 | 证据路径 + 符号 | 复现场景 | 建议修复 | 来源流 |
|----|--------|------|----------|-----------------|----------|----------|--------|
| S-29 | P2 | 无 session 时 fallback 第一个非归档 project | 工作台资源可能绑定非当前 session 的 project | `web/src/widgets/resource/ResourceWorkbench.tsx`（L90–94）`projects().find(!archivedAt)` fallback | 未选 session 打开工作台 | 无 session 时不 fallback 或显式提示 | 工作台 |
| S-30 | P2 | ~4MB 全文一次加载 | 大文本预览单次 GET 至多 4MB 进内存 | `web/src/features/resource/resource-preview.ts` `MAX_TEXT_PREVIEW_BYTES = 4 * 1024 * 1024`（L26、L49–63） | 打开接近 4MB 文件 | 分块加载或仅显示 head + download | 工作台 |
| S-31 | P2 | 全局 resourceWorkspace.error | 单请求失败可能污染整个工作台错误条 | `web/src/features/resource/resource-store.ts` `setResourceWorkspace({ error })`；`ResourceWorkbench.tsx`（L247–250）全局 InlineNotice | 任一 resource 查询失败 | 错误下沉到 panel 级 | 工作台 |
| S-32 | P2 | Graph 无 Loading 态 | 首次拉 log 时图区域空白无反馈 | `web/src/widgets/resource/git/GitGraphView.tsx` 无 `LoadingState`；`gitLogLoading` 仅用于 Load more 按钮 | 打开 Graph | 提交请求时显示 Loading | 工作台 |
| S-33 | P2 | refresh 先清空再拉取 | Refresh 闪烁、短暂空目录 | `web/src/features/resource/resource-store.ts` `refreshResourceProject`（L174–178）`resetResourceProject` 再 `activate` | 点 Refresh | 保留 generation 增量刷新 | 工作台 |

#### 后端与协议

| ID | 严重度 | 摘要 | 用户影响 | 证据路径 + 符号 | 复现场景 | 建议修复 | 来源流 |
|----|--------|------|----------|-----------------|----------|----------|--------|
| S-34 | P2 | ready→heartbeat 空窗 | `connectionReady` 在 ready 帧即 true，首条 heartbeat 前无额外门禁 | `web/src/features/connection/connection.ts` `case 'ready'` vs `case 'heartbeat'`；`ws-client.ts` 注释 keep_alive 周期 | 连接刚 ready | 可选「首心跳前」软门禁或 UI 提示 | 连接 / 后端 |
| S-35 | P2 | instance 畸形帧 continue | 恶意/损坏帧仅 warn 跳过，连接不断 | `server/src/channel/gateway_instance_loop.rs`（L176–180）`continue` | 畸形 JSON 洪水 | 计数阈值后断开 instance | 后端 |
| S-36 | P2 | voice unbounded channel | 语音事件队列无界可能堆积内存 | `realtime-voice/src/client.rs` / `live.rs` `mpsc::unbounded_channel` | 慢消费者 | 有界 channel + 背压 | 后端 |
| S-37 | P2 | CommandOutcomeBroker 1024 溢出 fail-closed | 超 1024 terminal fallback 后新重确认直接 Failed | `server/src/channel/command_outcome_broker.rs` `MAX_TERMINAL_FALLBACKS`、`terminal_fallback_overflow`（L173–176） | 大量历史 command 重放 | 可驱逐 LRU 或持久化 fallback | 后端 |
| S-38 | P2 | send_command 同 commandId 覆盖 pending ack | 重发覆盖旧 oneshot，原等待方永久悬空 | `server/src/control/instance_commands.rs`（L150–157）`pending_acks.insert` 覆盖并 warn | instance 侧重复 commandId | 拒绝覆盖或 fan-in 多 waiter | 后端 |

---

## 建议修复顺序

1. **S-01 + S-02 + S-03** — 重连/catalog/outbox 三角；否则其余修复无法稳定验证断线场景。
2. **S-12** — 工具链打开错误 project 的数据面风险高、改动面相对集中。
3. **S-05 + S-06** — 侧栏空态与离线门禁，减少误操作与重复 create。
4. **S-07 + S-08** — 身份边界与 cookie/last-session 一致性。
5. **其余 P1**（S-04、S-09–S-11、S-13–S-15），再 **P2**（S-16–S-38）按用户路径优先级分批。

## 工作台「只读不能保存」说明

`ResourceFileEditor` 与浮动文件预览路径 **刻意不提供保存**：头栏标注 `Read-only`（`web/src/widgets/resource/ResourceFileEditor.tsx`），协议侧打开 blob 为查看而非编辑会话。该限制 **不是** 稳定性缺陷；若产品需要工作台内编辑，应作为新能力单立 ADR，而非按 P1/P2 修复。

---

## 条目统计

| 类别 | 数量 |
|------|------|
| P1（S-01–S-15） | 15 |
| P2（S-16–S-38） | 23 |
| **合计** | **38** |

---

## 对抗复核（2026-09-14）

> 两路独立 reviewer 对上文 38 条静态审计结论做对抗核对：**Reviewer A** 以证伪为主（能否在源码中推翻条目）；**Reviewer B** 以核证为主（证据链是否闭合、符号与复现场景是否准确）。本节不修改原条目正文，仅记录复核裁决与修复取舍。

### 方法

| Reviewer | 取向 | 裁决 |
|----------|------|------|
| **A（证伪）** | 优先寻找反例、过度归因或证据不足 | `PASS` / `WEAK` / `FAIL` |
| **B（核证）** | 核对路径、符号、复现场景与行为是否成立 | `PASS` / `WEAK` |

### Reviewer A 汇总

| 裁决 | 条目 |
|------|------|
| **PASS** | S-01, S-03, S-04, S-05, S-07, S-08, S-09, S-10, S-11, S-12, S-13, S-14, S-17, S-20, S-25, S-28, S-31, S-33 |
| **FAIL** | S-19, S-24, S-30, S-34, S-37 |
| **WEAK** | S-02, S-06, S-15, S-16, S-18, S-21, S-22, S-23, S-26, S-27, S-29, S-32, S-35, S-36, S-38 |

### Reviewer B 汇总

| 裁决 | 条目 | 备注 |
|------|------|------|
| **PASS** | 除下表外其余 36 条 | — |
| **WEAK** | S-09 | 复现场景表述有误；`delivery_unknown` 归档满 20 条后 Composer 锁死仍成立 |
| **WEAK** | S-11 | 符号 `isStableFilesystemToolPath` 不存在；应为 `extractLinkableFilePath` 未在生产路径接线 |

**B 新发现**

| ID | 严重度 | 摘要 | 证据方向 |
|----|--------|------|----------|
| **N-01** | P1（建议） | 自动重连不 reset catalog bootstrap | 重连 `onReady` 未清空/重启 `session-catalog-bootstrap` 队列与 pending 态，与 S-01 同路径叠加 |

### 双 PASS 交集 → 进入修复

两路均为 `PASS` 的 16 条，外加 B 新发现 **N-01**（与 S-01 配套）：

S-01, S-03, S-04, S-05, S-07, S-08, S-10, S-12, S-13, S-14, S-17, S-20, S-25, S-28, S-31, S-33, **N-01**

### 明确不修

双非 PASS，或仅一路 `PASS` 的条目 **不进入本轮修复**（保留原文供后续单独评估）：

| ID | A | B | 不修原因 |
|----|---|---|----------|
| S-02 | WEAK | PASS | 仅 B 单 PASS；server 重启 outbox 与 `ProceedNew` 路径需运行时对账后再定 |
| S-06 | WEAK | PASS | 仅 B 单 PASS；离线门禁与 read-only 语义边界未闭合 |
| S-09 | PASS | WEAK | 仅 A 单 PASS；B 指出复现场景需改写，缺陷仍真实但不纳入本轮 |
| S-11 | PASS | WEAK | 仅 A 单 PASS；证据符号应为 `extractLinkableFilePath`，待更正后再修 |
| S-15 | WEAK | PASS | 仅 B 单 PASS；SCM 预览走磁盘全文属产品/UX 缺口，非本轮稳定性 |
| S-16 | WEAK | PASS | 仅 B 单 PASS；`Retry-After` 未消费为体验债务 |
| S-18 | WEAK | PASS | 仅 B 单 PASS；instance 行 phase 文案不完整 |
| S-19 | FAIL | PASS | A 证伪不成立；server 侧 4500 关闭路径待单独核实 |
| S-21 | WEAK | PASS | 仅 B 单 PASS；归档 session 搜索为功能缺口 |
| S-22 | WEAK | PASS | 仅 B 单 PASS；重命名失败无 toast |
| S-23 | WEAK | PASS | 仅 B 单 PASS；并发 catalog 变更静默丢弃 |
| S-24 | FAIL | PASS | A 证伪不成立；无 URL 深链为产品能力项 |
| S-26 | WEAK | PASS | 仅 B 单 PASS；voice `onclose` 静默 |
| S-27 | WEAK | PASS | 仅 B 单 PASS；Terminal 与口述无互斥 |
| S-29 | WEAK | PASS | 仅 B 单 PASS；无 session 时 project fallback |
| S-30 | FAIL | PASS | A 证伪不成立；4MB 预览上限为已知设计边界 |
| S-32 | WEAK | PASS | 仅 B 单 PASS；Graph 无 Loading 态 |
| S-34 | FAIL | PASS | A 证伪不成立；ready→heartbeat 空窗影响待量化 |
| S-35 | WEAK | PASS | 仅 B 单 PASS；畸形帧 continue 为防御性债务 |
| S-36 | WEAK | PASS | 仅 B 单 PASS；voice 无界 channel |
| S-37 | FAIL | PASS | A 证伪不成立；CommandOutcomeBroker 1024 为 fail-closed 契约 |
| S-38 | WEAK | PASS | 仅 B 单 PASS；`pending_acks` 覆盖需 instance 侧复现 |

### 复核后建议修复顺序（收窄版）

1. **S-01 + N-01 + S-03** — 重连 / catalog bootstrap / uncertain 三角（仍优先于其余双 PASS 项）。
2. **S-12** — 工具链打开错误 `projectId` 的数据面风险。
3. **S-05 + S-07 + S-08** — discover 失败 surfacing、登出 cookie、last-session 身份边界。
4. **其余双 PASS P1**（S-04、S-10、S-13、S-14），再 **双 PASS P2**（S-17、S-20、S-25、S-28、S-31、S-33）。

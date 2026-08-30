---
status: accepted
date: 2026-08-30
---

# ACP 权威会话目录：移除 SQLite `project_sessions`

## 背景

Hub 曾在 `metadata.sqlite3` 的 `project_sessions` 表维护「项目会话」目录（hub 生成的
`project_session_id`、ACP id 指针、lifecycle、`last_chat_id` 等）。这与无状态投影
原则冲突：server 重启后该表驱动的 `rebuild_chat_views` 会错误复用已失效的 runtime
chat，且目录事实与 ACP agent 磁盘上的 durable thread 形成双源。

对话正文从未落入 SQLite；落库的仅是目录元数据。产品决策：**目录也不再由 SQLite
承载**，ACP `session/list` + agent 磁盘为 durable 会话的唯一权威。

## 决策

1. **删除 SQLite 表**：`project_sessions`、`session_activations`、`session_runtime_history`
   （V7 迁移：归档旧表或 DROP；一次性丢弃 hub `project_session_id` 行）。

2. **保留 SQLite**：`projects`、`metadata_commands`（缩减：不再含 session/create|open
   等持久会话 mutation 的 session_id 外键）、`machines`、`oauth_commands`、`projection_state`。

3. **Wire `sessionId` 语义变更**：`session/open`、`session/archive` 等 action 的
   `sessionId` **即 ACP durable `session_id`**（与 `acpSessionId` 同值；Registry 投影
   字段 `acp_session_id` 保留兼容，hub 不再生成独立 logical id）。

4. **目录投影**：`hub:registry` 的 `project_sessions` 段改为 **ACP 列表缓存**：
   - 按 `project_id` 调用 `session/list`（经 discovery runtime 或项目级 single-flight）
   - 合并 ChatRegistry 运行态（`active_chat_id`、status）与内存激活表
   - server 重启后目录为空，直至 `session/discover` 或用户打开项目触发 list

5. **用户偏好（归档/重命名）**：不落 SQLite。Web 以 IndexedDB
   `{principalId, projectId, acpSessionId}` 存 `archived` / `customName`；server 不持久化
   这些覆盖（读侧合并）。

6. **`session/create`**：在 project cwd 上 `session/new`，committed ack 的 `sessionId` =
   新 ACP id；刷新该 project 的 list 缓存。

7. **`session/open`**：参数为 ACP id → 始终 `spawn + session/load`（无 live 复用快路径
   依赖 SQLite `last_chat_id`）；运行中复用仍可由 `ChatRegistry.runtime_confirmed` 判定
   **同一 ACP id 已绑定且 confirmed 的 chat**。

8. **`session/import`**：废弃或改为 no-op（list 已包含即已在目录）；保留 action 仅
   作兼容 duplicate ack。

9. **测试**：更新 `product_flow_tests` 重启旅程——不再断言 sqlite `last_chat_id` 保留；
   断言 wire `session/load` 使用同一 ACP id。

## 后果

- 现有 `metadata.sqlite3` 中 project session 行在升级后不可恢复（可接受：ACP 磁盘仍在）。
- 多 Web 客户端不共享归档/重命名（仅本浏览器 IndexedDB）。
- `session_activations` / metadata 屏障路径删除或改为 per-chat outbox only。
- 文档：`terminology.md`、`architecture.md` §3.0 / §8.3 / §8.4 同步。

## 实施分域

| 域 | 职责 |
|----|------|
| persist | V7 迁移、删除 metadata_sessions API、recovery 收敛 |
| catalog | SessionCatalogService、list 缓存、reproject、metadata_session_actions |
| proto/registry | ProjectSessionSummary 语义、Registry 写入 |
| web | sessionId=acp id、IndexedDB 偏好、sidebar/search |

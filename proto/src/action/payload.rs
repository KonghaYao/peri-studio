//! Action payload 结构与相关枚举（§4.3 / §4.3.1）。
//!
//! 与 [`super::ActionEnvelope`] 分文件承载：envelope 层保留 `type` 判别与
//! [`super::ActionEnvelope::type_str`]，本文件承载全部 payload 结构与 payload
//! 相关的枚举（`PermissionDecision` / `ElicitationResponseAction` /
//! `ElicitationAnswer`）。经 `super` 的 `pub use payload::*;` 保持
//! `crate::action::XxxPayload` 导出路径不变，外部 crate 引用零改动。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCreatePayload {
    pub name: String,
    pub cwd: String,
    pub instance_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectArchivePayload {
    pub project_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRenamePayload {
    pub project_id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSessionCreatePayload {
    pub project_id: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSessionOpenPayload {
    pub session_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSessionRenamePayload {
    pub session_id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSessionImportPayload {
    pub project_id: String,
    pub acp_session_id: String,
}

/// `chat/create` payload；`instance_id`/`cwd`/`title` 均可缺省，服务端按
/// 连接绑定补充与校验（§4.3），客户端字段不可覆盖 binding。
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateChatPayload {
    /// 目标 instance；缺省 = 本机（P5）。
    pub instance_id: Option<String>,
    /// 工作目录；未指定时 server 注入已认证上下文默认目录（§4.3 裁决）。
    pub cwd: Option<String>,
    /// 会话标题。
    pub title: Option<String>,
    /// ACP 历史会话恢复（§8.5）：携带 session/list 返回的 acp_session_id 时，
    /// create 序列走 `session/load`（回放历史）而非 `session/new`。
    pub acp_session_id: Option<String>,
    /// 工作区归属（workspace/create 返回后可用）：存在时对话继承该工作区的
    /// cwd（优先级高于 `cwd`）；不存在时 `cwd` 生效；两者皆缺省 → server 默认目录。
    pub workspace_id: Option<String>,
}

/// `chat/load` payload：在当前对话（其 ACP 进程）内切换会话（§8.5）。
///
/// 点击 SessionList 历史会话 → 前端向**当前对话**发 load——进程不新建，
/// 直接把目标历史会话加载为进程的当前会话（会话是进程内实体，随进程
/// 消亡；一个进程可先后持有多个会话）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadChatPayload {
    pub chat_id: String,
    /// 目标 ACP 会话 id（来自 session/list 响应；须属于该 chat 的进程）。
    pub acp_session_id: String,
}

/// `chat/close` payload。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseChatPayload {
    pub chat_id: String,
}

/// `chat/prompt` payload。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptChatPayload {
    pub chat_id: String,
    pub message: String,
    /// 推理强度档位（low|medium|high，跨任务契约 §2）；缺省 = agent 默认。
    pub effort: Option<String>,
}

/// `chat/session-new` payload：在当前对话（其 ACP 进程）内新建会话（§8.5）。
///
/// 会话是进程内实体——不新建对话/进程；服务端向 agent 侧发 `session/new`
/// RPC，响应中的新 sessionId 更新当前 chat 的 binding。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionNewChatPayload {
    pub chat_id: String,
}

/// `chat/cancel` payload。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelChatPayload {
    pub chat_id: String,
}

/// `chat/config-set` payload。第一条纵切只接受 ACP select option 的 value id；
/// boolean 等扩展类型需单独协商后再增加 wire 变体。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSetPayload {
    pub chat_id: String,
    pub config_id: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindCandidatesPayload {
    pub chat_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindPreviewPayload {
    pub chat_id: String,
    pub target_message_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindPayload {
    pub chat_id: String,
    pub target_message_id: String,
    pub preview_fingerprint: String,
    pub revert_files: bool,
}

/// `permission/resolve` payload。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvePermissionPayload {
    pub chat_id: String,
    pub permission_id: String,
    pub decision: PermissionDecision,
    /// 官方 ACP optionId；旧 legacy producer 无此身份时缺省。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub option_id: Option<String>,
}

/// `elicitation/respond` payload。`answers` 的 key 必须与 server 投影字段精确
/// 相等；accept 时必填字段由 server 校验，decline/cancel 时必须为空。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RespondElicitationPayload {
    pub chat_id: String,
    pub elicitation_id: String,
    pub action: ElicitationResponseAction,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub answers: BTreeMap<String, ElicitationAnswer>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ElicitationResponseAction {
    Accept,
    Decline,
    Cancel,
}

/// 与 Hub 投影的表单子集匹配的封闭 answer 值集。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ElicitationAnswer {
    Text(String),
    Multiple(Vec<String>),
}

/// `events/subscribe` payload（M3，类型保留）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscribeEventsPayload {
    /// 缺省 = 订阅全部可见 chat。
    pub chat_id: Option<String>,
    /// 缺省 = 实时起（不重放历史）；带 `from_seq` 则从该序号起推。
    pub from_seq: Option<u64>,
}

/// `events/unsubscribe` payload（M3，类型保留）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnsubscribeEventsPayload {
    /// 缺省 = 退订全部。
    pub chat_id: Option<String>,
}

/// 权限决议（§4.3）；也供 §7 schema 的 `PermissionProjection.decision` 复用。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionDecision {
    Allow,
    Deny,
}

/// `workspace/create` payload：定义本地目录（cwd），其下新建对话继承。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCreatePayload {
    /// 工作区名称（展示用；可为空串 → server 以目录名兜底）。
    pub name: String,
    /// 本地绝对目录（server 校验存在性；spawn/initialize/session/list 均
    /// 以它为工作目录）。
    pub cwd: String,
}

/// `workspace/remove` payload。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRemovePayload {
    pub workspace_id: String,
}

/// `session/list` payload：按需查询指定对话的 ACP 会话列表（§6.3）。
///
/// cwd/instance 不信任客户端直传——server 从 chat record 解析
/// （spawn/initialize/session/list 的查询面一致）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionListPayload {
    pub chat_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpListPayload {
    pub chat_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOAuthStartPayload {
    pub chat_id: String,
    pub server_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOAuthFlowPayload {
    pub chat_id: String,
    pub flow_id: String,
}

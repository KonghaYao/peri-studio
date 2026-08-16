//! Action envelope 与方法面（§4.3 / §4.3.1）。
//!
//! `ActionEnvelope` 是第二层 internally tagged 枚举（tag `"type"`），与
//! [`Frame::Action`](crate::Frame::Action) 的外层 `"t"` 嵌套序列化为文档 §4.3
//! 形态：`{"t":"action","commandId":…,"type":"chat/prompt","payload":{…}}`。
//!
//! `type` 判别放在 envelope 层而非 payload untagged 枚举：`chat/load` 与
//! `chat/close` 的 payload 同为 `{ chat_id }` 单字段，untagged 无法区分。
//!
//! payload 结构与相关枚举（`XxxPayload` / `PermissionDecision` /
//! `ElicitationAnswer` 等）见 [`payload`] 子模块；本文件顶部 `pub use` 保持
//! `crate::action::XxxPayload` 导出路径不变，外部 crate 引用零改动。

mod payload;

pub use payload::*;

use serde::{Deserialize, Serialize};

/// Action 方法面（§4.3 表 + §4.3.1）。
///
/// 全部携带 `command_id`（uuid 形态，幂等键，同 chat 唯一；重试复用同一
/// ID 绝不可换 ID 猜测结果）。文档「uuid」不做格式强校验，幂等键语义在 server。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ActionEnvelope {
    /// 创建持久化 project（workspace 的兼容后继）。
    #[serde(rename = "project/create", rename_all = "camelCase")]
    ProjectCreate {
        command_id: String,
        payload: ProjectCreatePayload,
    },
    /// 归档持久化 project；已有 session 不做物理删除。
    #[serde(rename = "project/archive", rename_all = "camelCase")]
    ProjectArchive {
        command_id: String,
        payload: ProjectArchivePayload,
    },
    /// 恢复已归档 project；不创建或复制其 session。
    #[serde(rename = "project/restore", rename_all = "camelCase")]
    ProjectRestore {
        command_id: String,
        payload: ProjectArchivePayload,
    },
    /// 修改 project 展示名；cwd 与 instance binding 保持不变。
    #[serde(rename = "project/rename", rename_all = "camelCase")]
    ProjectRename {
        command_id: String,
        payload: ProjectRenamePayload,
    },
    /// 在 project 下创建持久化 logical session 并激活 ACP runtime。
    #[serde(rename = "session/create", rename_all = "camelCase")]
    PersistedSessionCreate {
        command_id: String,
        payload: PersistedSessionCreatePayload,
    },
    /// 打开持久化 logical session；必要时新建 runtime 并 session/load。
    #[serde(rename = "session/open", rename_all = "camelCase")]
    PersistedSessionOpen {
        command_id: String,
        payload: PersistedSessionOpenPayload,
    },
    /// 修改 hub 侧展示名，不修改 ACP ThreadStore title。
    #[serde(rename = "session/rename", rename_all = "camelCase")]
    PersistedSessionRename {
        command_id: String,
        payload: PersistedSessionRenamePayload,
    },
    /// 从导航中可逆归档一个持久会话；不删除 ACP thread 或 chat history。
    #[serde(rename = "session/archive", rename_all = "camelCase")]
    PersistedSessionArchive {
        command_id: String,
        payload: PersistedSessionOpenPayload,
    },
    /// 恢复一个已归档的持久会话。
    #[serde(rename = "session/restore", rename_all = "camelCase")]
    PersistedSessionRestore {
        command_id: String,
        payload: PersistedSessionOpenPayload,
    },
    /// 将 ACP 历史会话显式加入某个 project 的持久侧边栏。
    #[serde(rename = "session/import", rename_all = "camelCase")]
    PersistedSessionImport {
        command_id: String,
        payload: PersistedSessionImportPayload,
    },
    /// 刷新某个 project 的 ACP 历史会话候选。没有可复用 runtime 时，
    /// server 使用不可见的短生命周期 discovery runtime。
    #[serde(rename = "session/discover", rename_all = "camelCase")]
    PersistedSessionDiscover {
        command_id: String,
        payload: ProjectArchivePayload,
    },
    /// 读取一个持久 logical session 的安全 prompt delivery 摘要。服务端仅
    /// 通过 session 身份解析历史 runtime；client 不得指定任意 chat id。
    #[serde(rename = "session/prompt-status", rename_all = "camelCase")]
    PersistedSessionPromptStatus {
        command_id: String,
        payload: PersistedSessionOpenPayload,
    },
    /// 创建对话；`instance_id` 缺省 = 本机（§4.3）。
    #[serde(rename = "chat/create", rename_all = "camelCase")]
    Create {
        command_id: String,
        payload: CreateChatPayload,
    },
    /// 载入既有会话（M2，类型保留；转发前开启回放窗口）。
    #[serde(rename = "chat/load", rename_all = "camelCase")]
    Load {
        command_id: String,
        payload: LoadChatPayload,
    },
    /// 关闭并 kill 对应 ACP 进程（offline 时语义见架构 §7.6）。
    #[serde(rename = "chat/close", rename_all = "camelCase")]
    Close {
        command_id: String,
        payload: CloseChatPayload,
    },
    /// 转发 prompt 到目标 instance。
    #[serde(rename = "chat/prompt", rename_all = "camelCase")]
    Prompt {
        command_id: String,
        payload: PromptChatPayload,
    },
    /// 当前对话内新建 ACP 会话（§8.5 会话是进程内实体——不新建对话/进程，
    /// 等价 create 序列的 `session/new` 一步；committed ack 可携带新
    /// acpSessionId）。
    #[serde(rename = "chat/session-new", rename_all = "camelCase")]
    SessionNew {
        command_id: String,
        payload: SessionNewChatPayload,
    },
    /// 转发 cancel（携带目标 chat_id，路由据此精确投递）。
    #[serde(rename = "chat/cancel", rename_all = "camelCase")]
    Cancel {
        command_id: String,
        payload: CancelChatPayload,
    },
    /// 修改当前 ACP runtime 的一个 Agent-authoritative session config option。
    /// value 必须来自最新投影目录；server 会在下发前再次校验。
    #[serde(rename = "chat/config-set", rename_all = "camelCase")]
    ConfigSet {
        command_id: String,
        payload: ConfigSetPayload,
    },
    /// 读取当前 Peri runtime 的有界 user-message 回退候选。
    #[serde(rename = "chat/rewind-candidates", rename_all = "camelCase")]
    RewindCandidates {
        command_id: String,
        payload: RewindCandidatesPayload,
    },
    /// 读取一个候选的安全、project-relative 文件影响预览与确认指纹。
    #[serde(rename = "chat/rewind-preview", rename_all = "camelCase")]
    RewindPreview {
        command_id: String,
        payload: RewindPreviewPayload,
    },
    /// 执行已经预览并确认的 Peri session rewind。previewFingerprint 必须
    /// 原样来自同一 runtime 的最新 preview。
    #[serde(rename = "chat/rewind", rename_all = "camelCase")]
    Rewind {
        command_id: String,
        payload: RewindPayload,
    },
    /// 权限应答（CAS 校验通过后才下发，见架构 §7.4）。
    #[serde(rename = "permission/resolve", rename_all = "camelCase")]
    ResolvePermission {
        command_id: String,
        payload: ResolvePermissionPayload,
    },
    /// 回答 agent 发起的 ACP form elicitation。回答只接受 Hub 已投影的
    /// 有界字段，不能携带任意 JSON Schema 或指定 agent request id。
    #[serde(rename = "elicitation/respond", rename_all = "camelCase")]
    RespondElicitation {
        command_id: String,
        payload: RespondElicitationPayload,
    },
    /// 原始 ACP 事件订阅（M3，类型保留；`from_seq` 缺省 = 实时起）。
    #[serde(rename = "events/subscribe", rename_all = "camelCase")]
    SubscribeEvents {
        command_id: String,
        payload: SubscribeEventsPayload,
    },
    /// 事件退订（M3，类型保留）。
    #[serde(rename = "events/unsubscribe", rename_all = "camelCase")]
    UnsubscribeEvents {
        command_id: String,
        payload: UnsubscribeEventsPayload,
    },
    /// 创建工作区（独立于 chat 的上层概念：定义本地目录 cwd，其下新建的
    /// 对话继承该 cwd——ACP 进程工作目录与 session/list 查询面一致）。
    #[serde(rename = "workspace/create", rename_all = "camelCase")]
    WorkspaceCreate {
        command_id: String,
        payload: WorkspaceCreatePayload,
    },
    /// 删除工作区定义（不影响已建对话与会话；仅移除目录定义）。
    #[serde(rename = "workspace/remove", rename_all = "camelCase")]
    WorkspaceRemove {
        command_id: String,
        payload: WorkspaceRemovePayload,
    },
    /// 查询指定对话的 ACP 会话列表（§6.3 按需查询）：server 从 chat record
    /// 解析 (instance_id, cwd) 后向 agent 侧发 `session/list` RPC，结果经
    /// `session_list` 下行帧回投。agent 侧是真实数据源——不依赖轮询投影。
    #[serde(rename = "session/list", rename_all = "camelCase")]
    SessionList {
        command_id: String,
        payload: SessionListPayload,
    },
    /// 查询当前 runtime 的安全 MCP 连接快照；不包含 URL、headers 或 raw error。
    #[serde(rename = "mcp/list", rename_all = "camelCase")]
    McpList {
        command_id: String,
        payload: McpListPayload,
    },
    /// 显式开始一个 MCP OAuth flow。
    #[serde(rename = "mcp/oauth-start", rename_all = "camelCase")]
    McpOAuthStart {
        command_id: String,
        payload: McpOAuthStartPayload,
    },
    /// 在用户点击后读取 exact flow 的瞬时 authorization URL。
    #[serde(rename = "mcp/oauth-authorization", rename_all = "camelCase")]
    McpOAuthAuthorization {
        command_id: String,
        payload: McpOAuthFlowPayload,
    },
    /// 精确取消一个 MCP OAuth flow。
    #[serde(rename = "mcp/oauth-cancel", rename_all = "camelCase")]
    McpOAuthCancel {
        command_id: String,
        payload: McpOAuthFlowPayload,
    },
}

impl ActionEnvelope {
    /// serde `type` 判别值（§4.3 方法面；与 `whitelist::M1_ACTION_TYPES`
    /// 对照用于 §4.8 action type 收窄检查）。
    pub fn type_str(&self) -> &'static str {
        match self {
            ActionEnvelope::ProjectCreate { .. } => "project/create",
            ActionEnvelope::ProjectArchive { .. } => "project/archive",
            ActionEnvelope::ProjectRestore { .. } => "project/restore",
            ActionEnvelope::ProjectRename { .. } => "project/rename",
            ActionEnvelope::PersistedSessionCreate { .. } => "session/create",
            ActionEnvelope::PersistedSessionOpen { .. } => "session/open",
            ActionEnvelope::PersistedSessionRename { .. } => "session/rename",
            ActionEnvelope::PersistedSessionArchive { .. } => "session/archive",
            ActionEnvelope::PersistedSessionRestore { .. } => "session/restore",
            ActionEnvelope::PersistedSessionImport { .. } => "session/import",
            ActionEnvelope::PersistedSessionDiscover { .. } => "session/discover",
            ActionEnvelope::PersistedSessionPromptStatus { .. } => "session/prompt-status",
            ActionEnvelope::Create { .. } => "chat/create",
            ActionEnvelope::Load { .. } => "chat/load",
            ActionEnvelope::Close { .. } => "chat/close",
            ActionEnvelope::Prompt { .. } => "chat/prompt",
            ActionEnvelope::SessionNew { .. } => "chat/session-new",
            ActionEnvelope::Cancel { .. } => "chat/cancel",
            ActionEnvelope::ConfigSet { .. } => "chat/config-set",
            ActionEnvelope::RewindCandidates { .. } => "chat/rewind-candidates",
            ActionEnvelope::RewindPreview { .. } => "chat/rewind-preview",
            ActionEnvelope::Rewind { .. } => "chat/rewind",
            ActionEnvelope::ResolvePermission { .. } => "permission/resolve",
            ActionEnvelope::RespondElicitation { .. } => "elicitation/respond",
            ActionEnvelope::SubscribeEvents { .. } => "events/subscribe",
            ActionEnvelope::UnsubscribeEvents { .. } => "events/unsubscribe",
            ActionEnvelope::WorkspaceCreate { .. } => "workspace/create",
            ActionEnvelope::WorkspaceRemove { .. } => "workspace/remove",
            ActionEnvelope::SessionList { .. } => "session/list",
            ActionEnvelope::McpList { .. } => "mcp/list",
            ActionEnvelope::McpOAuthStart { .. } => "mcp/oauth-start",
            ActionEnvelope::McpOAuthAuthorization { .. } => "mcp/oauth-authorization",
            ActionEnvelope::McpOAuthCancel { .. } => "mcp/oauth-cancel",
        }
    }
}

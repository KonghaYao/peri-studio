//! CommandCoordinator 的纯函数 helpers（review #3 结构拆分）：command_id/
//! chat_id 提取、command 类型映射、SubmitAck 转换等——不依赖 CoordInner 的
//! 模块级函数集中于此（结构拆分，行为语义不变）。

use peri_studio_proto::ack::ActionError;
use peri_studio_proto::action::ActionEnvelope;

use crate::channel::command_coordinator::SubmitAck;
use crate::channel::command_outcome_broker::ExistingCommandResponse;
use crate::persist::outbox::CommandType;

/// 提交结果构造（错误侧；crate 内共享）。
pub(super) fn action_error(
    command_id: String,
    code: peri_studio_proto::ack::ErrorCode,
    message: &str,
    retryable: bool,
) -> ActionError {
    ActionError {
        command_id,
        code,
        message: message.to_string(),
        retryable,
        retry_after_ms: None,
    }
}

pub(super) fn submit_ack_from_existing(response: ExistingCommandResponse) -> SubmitAck {
    match response {
        ExistingCommandResponse::Accepted { command_id } => SubmitAck::Accepted { command_id },
        ExistingCommandResponse::Duplicate(ack) => SubmitAck::Duplicate(ack),
        ExistingCommandResponse::Failed(error) => SubmitAck::Failed(error),
    }
}

pub(super) fn command_type_of(action: &ActionEnvelope) -> CommandType {
    match action {
        ActionEnvelope::Create { .. } => CommandType::Create,
        ActionEnvelope::Prompt { .. } => CommandType::Prompt,
        ActionEnvelope::Cancel { .. } => CommandType::Cancel,
        ActionEnvelope::Close { .. } => CommandType::Close,
        ActionEnvelope::ResolvePermission { .. } => CommandType::Resolve,
        ActionEnvelope::RespondElicitation { .. } => CommandType::ElicitationRespond,
        ActionEnvelope::RespondQuestion { .. } => CommandType::QuestionRespond,
        // 白名单外 action 在 gateway/chat_channel 已拦（review #10：此前的
        // 静默 Prompt 降级会把未知命令持久化到 outbox、获得 turn_id 进入
        // prompt 语义——错误被掩盖；改为 unreachable 让防御路径在测试期
        // 暴露）。
        _ => unreachable!("action type whitelisted in gateway/chat_channel"),
    }
}

/// ActionEnvelope → command_id（幂等键，uuid 形态，§4.3）。
///
/// 权威单一实现（review #7）：gateway/chat_channel 曾各自维护完整拷贝，
/// ActionEnvelope 每新增变体须同步 4 处且漏改会静默退化为空串；现统一
/// 收敛于此（`pub(crate)`，crate 内共享），枚举扩展只需改此处。
pub(crate) fn extract_command_id(action: &ActionEnvelope) -> Option<String> {
    match action {
        ActionEnvelope::ProjectCreate { command_id, .. }
        | ActionEnvelope::ProjectArchive { command_id, .. }
        | ActionEnvelope::ProjectRestore { command_id, .. }
        | ActionEnvelope::ProjectRename { command_id, .. }
        | ActionEnvelope::PersistedSessionCreate { command_id, .. }
        | ActionEnvelope::PersistedSessionOpen { command_id, .. }
        | ActionEnvelope::PersistedSessionRename { command_id, .. }
        | ActionEnvelope::PersistedSessionArchive { command_id, .. }
        | ActionEnvelope::PersistedSessionRestore { command_id, .. }
        | ActionEnvelope::PersistedSessionImport { command_id, .. }
        | ActionEnvelope::PersistedSessionDiscover { command_id, .. }
        | ActionEnvelope::PersistedSessionPromptStatus { command_id, .. }
        | ActionEnvelope::Create { command_id, .. }
        | ActionEnvelope::Load { command_id, .. }
        | ActionEnvelope::Close { command_id, .. }
        | ActionEnvelope::Prompt { command_id, .. }
        | ActionEnvelope::SessionNew { command_id, .. }
        | ActionEnvelope::Cancel { command_id, .. }
        | ActionEnvelope::ConfigSet { command_id, .. }
        | ActionEnvelope::RewindCandidates { command_id, .. }
        | ActionEnvelope::RewindPreview { command_id, .. }
        | ActionEnvelope::Rewind { command_id, .. }
        | ActionEnvelope::ResolvePermission { command_id, .. }
        | ActionEnvelope::RespondElicitation { command_id, .. }
        | ActionEnvelope::RespondQuestion { command_id, .. }
        | ActionEnvelope::SubscribeEvents { command_id, .. }
        | ActionEnvelope::UnsubscribeEvents { command_id, .. }
        | ActionEnvelope::WorkspaceCreate { command_id, .. }
        | ActionEnvelope::WorkspaceRemove { command_id, .. }
        | ActionEnvelope::SessionList { command_id, .. }
        | ActionEnvelope::McpList { command_id, .. }
        | ActionEnvelope::McpOAuthStart { command_id, .. }
        | ActionEnvelope::McpOAuthAuthorization { command_id, .. }
        | ActionEnvelope::McpOAuthCancel { command_id, .. }
        | ActionEnvelope::McpAppOpen { command_id, .. }
        | ActionEnvelope::McpAppResource { command_id, .. }
        | ActionEnvelope::McpAppCall { command_id, .. } => Some(command_id.clone()),
        ActionEnvelope::MachineAdd { command_id, .. }
        | ActionEnvelope::MachineConnect { command_id, .. }
        | ActionEnvelope::MachineDisconnect { command_id, .. }
        | ActionEnvelope::MachineStop { command_id, .. }
        | ActionEnvelope::MachineCancel { command_id, .. }
        | ActionEnvelope::MachineRetry { command_id, .. }
        | ActionEnvelope::MachineTrustHost { command_id, .. }
        | ActionEnvelope::MachineConfirmReplace { command_id, .. }
        | ActionEnvelope::MachineRename { command_id, .. }
        | ActionEnvelope::MachineSetAutoReconnect { command_id, .. }
        | ActionEnvelope::MachineRemove { command_id, .. }
        | ActionEnvelope::MachineRestore { command_id, .. }
        | ActionEnvelope::FsWriteFile { command_id, .. }
        | ActionEnvelope::FsCreateDir { command_id, .. }
        | ActionEnvelope::FsMove { command_id, .. }
        | ActionEnvelope::FsDelete { command_id, .. } => Some(command_id.clone()),
    }
}

/// ActionEnvelope → chat_id（§6.2；create 与 metadata 命令无 chat_id）。
pub(super) fn extract_chat_id(action: &ActionEnvelope) -> Option<String> {
    match action {
        ActionEnvelope::Prompt { payload, .. } => Some(payload.chat_id.clone()),
        ActionEnvelope::Cancel { payload, .. } => Some(payload.chat_id.clone()),
        ActionEnvelope::ConfigSet { payload, .. } => Some(payload.chat_id.clone()),
        ActionEnvelope::RewindCandidates { payload, .. } => Some(payload.chat_id.clone()),
        ActionEnvelope::RewindPreview { payload, .. } => Some(payload.chat_id.clone()),
        ActionEnvelope::Rewind { payload, .. } => Some(payload.chat_id.clone()),
        ActionEnvelope::Close { payload, .. } => Some(payload.chat_id.clone()),
        ActionEnvelope::ResolvePermission { payload, .. } => Some(payload.chat_id.clone()),
        ActionEnvelope::RespondElicitation { payload, .. } => Some(payload.chat_id.clone()),
        ActionEnvelope::RespondQuestion { payload, .. } => Some(payload.chat_id.clone()),
        ActionEnvelope::Load { payload, .. } => Some(payload.chat_id.clone()),
        ActionEnvelope::SessionNew { payload, .. } => Some(payload.chat_id.clone()),
        ActionEnvelope::Create { .. } => None,
        ActionEnvelope::ProjectCreate { .. }
        | ActionEnvelope::ProjectArchive { .. }
        | ActionEnvelope::ProjectRestore { .. }
        | ActionEnvelope::ProjectRename { .. }
        | ActionEnvelope::PersistedSessionCreate { .. }
        | ActionEnvelope::PersistedSessionOpen { .. }
        | ActionEnvelope::PersistedSessionRename { .. } => None,
        ActionEnvelope::PersistedSessionArchive { .. }
        | ActionEnvelope::PersistedSessionRestore { .. } => None,
        ActionEnvelope::PersistedSessionImport { .. } => None,
        ActionEnvelope::PersistedSessionDiscover { .. } => None,
        ActionEnvelope::PersistedSessionPromptStatus { .. } => None,
        ActionEnvelope::SubscribeEvents { .. } | ActionEnvelope::UnsubscribeEvents { .. } => None,
        // workspace 管理命令 / session/list 按需查询：submit 层直接执行
        // （不解析 chat_id）。
        ActionEnvelope::WorkspaceCreate { .. }
        | ActionEnvelope::WorkspaceRemove { .. }
        | ActionEnvelope::SessionList { .. } => None,
        ActionEnvelope::McpList { payload, .. } => Some(payload.chat_id.clone()),
        ActionEnvelope::McpOAuthStart { payload, .. } => Some(payload.chat_id.clone()),
        ActionEnvelope::McpOAuthAuthorization { payload, .. }
        | ActionEnvelope::McpOAuthCancel { payload, .. } => Some(payload.chat_id.clone()),
        ActionEnvelope::McpAppOpen { payload, .. } => Some(payload.chat_id.clone()),
        ActionEnvelope::McpAppResource { payload, .. } => Some(payload.chat_id.clone()),
        ActionEnvelope::McpAppCall { payload, .. } => Some(payload.chat_id.clone()),
        ActionEnvelope::MachineAdd { .. }
        | ActionEnvelope::MachineConnect { .. }
        | ActionEnvelope::MachineDisconnect { .. }
        | ActionEnvelope::MachineStop { .. }
        | ActionEnvelope::MachineCancel { .. }
        | ActionEnvelope::MachineRetry { .. }
        | ActionEnvelope::MachineTrustHost { .. }
        | ActionEnvelope::MachineConfirmReplace { .. }
        | ActionEnvelope::MachineRename { .. }
        | ActionEnvelope::MachineSetAutoReconnect { .. }
        | ActionEnvelope::MachineRemove { .. }
        | ActionEnvelope::MachineRestore { .. }
        | ActionEnvelope::FsWriteFile { .. }
        | ActionEnvelope::FsCreateDir { .. }
        | ActionEnvelope::FsMove { .. }
        | ActionEnvelope::FsDelete { .. } => None,
    }
}

/// chat_id（hub 侧，uuid 形态）→ Uuid。
pub(super) fn chat_uuid(chat_id: &str) -> Option<uuid::Uuid> {
    uuid::Uuid::parse_str(chat_id).ok()
}

/// active prompt 等待 L3 期间须立即执行的交互控制（与 cancel 同级抢占）。
///
/// AskUserQuestion / elicitation / permission 的应答是 agent 当前 turn 的
/// 阻塞依赖；若排在 prompt 之后会造成「前端已提交、server 永不 ack」的死锁。
pub(super) fn preempts_active_prompt_delivery(action: &ActionEnvelope) -> bool {
    matches!(
        action,
        ActionEnvelope::RespondQuestion { .. }
        | ActionEnvelope::RespondElicitation { .. }
        | ActionEnvelope::ResolvePermission { .. }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use peri_studio_proto::action::{
        CancelChatPayload, ElicitationResponseAction, PermissionDecision,
        RespondElicitationPayload, RespondQuestionPayload, ResolvePermissionPayload,
    };

    #[test]
    fn preempts_active_prompt_delivery_for_interactive_controls_only() {
        let chat_id = "00000000-0000-0000-0000-000000000001".to_string();
        assert!(preempts_active_prompt_delivery(&ActionEnvelope::RespondQuestion {
            command_id: "c1".into(),
            payload: RespondQuestionPayload {
                chat_id: chat_id.clone(),
                question_id: "q1".into(),
                answers: vec![],
            },
        }));
        assert!(preempts_active_prompt_delivery(&ActionEnvelope::RespondElicitation {
            command_id: "c2".into(),
            payload: RespondElicitationPayload {
                chat_id: chat_id.clone(),
                elicitation_id: "e1".into(),
                action: ElicitationResponseAction::Accept,
                answers: Default::default(),
            },
        }));
        assert!(preempts_active_prompt_delivery(&ActionEnvelope::ResolvePermission {
            command_id: "c3".into(),
            payload: ResolvePermissionPayload {
                chat_id: chat_id.clone(),
                permission_id: "p1".into(),
                decision: PermissionDecision::Allow,
                option_id: None,
            },
        }));
        assert!(!preempts_active_prompt_delivery(&ActionEnvelope::Cancel {
            command_id: "c4".into(),
            payload: CancelChatPayload { chat_id },
        }));
    }
}

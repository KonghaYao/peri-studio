//! `machine/*` 元数据域命令：校验 → commandId 去重 → accepted ack → 按 action 分发。

use std::sync::Arc;

use peri_studio_proto::ack::{AckStatus, ActionAck, ErrorCode};
use peri_studio_proto::action::ActionEnvelope;
use peri_studio_proto::frame::Frame;
use tokio::sync::{mpsc, RwLock};
use uuid::Uuid;

use crate::auth::ConnectionCtx;
use crate::channel::broadcaster::OutboundMsg;
use crate::control::MachineService;
use crate::persist::metadata::{payload_hash, BeginCommand, MetadataError};

use super::command_coordinator::{action_error, extract_command_id, SubmitAck};

#[derive(Clone)]
pub(super) struct MachineCommandProcessor {
    pub(super) machines: Arc<RwLock<Option<MachineService>>>,
}

#[derive(Clone)]
pub(super) struct MachineCommand {
    pub ctx: ConnectionCtx,
    pub action: ActionEnvelope,
    pub tx: mpsc::Sender<OutboundMsg>,
}

impl MachineCommandProcessor {
    pub fn new(machines: Arc<RwLock<Option<MachineService>>>) -> Self {
        Self { machines }
    }

    /// 提交入口：公共序列（校验 → payload_hash → BeginCommand 去重 →
    /// accepted ack → 按 action 分发）；被拒绝的请求不得留下 in-progress 去重行。
    pub async fn submit(
        &self,
        ctx: &ConnectionCtx,
        action: ActionEnvelope,
        tx: mpsc::Sender<OutboundMsg>,
    ) -> SubmitAck {
        let command_id = extract_command_id(&action).unwrap_or_default();
        if Uuid::parse_str(&command_id).is_err() {
            return SubmitAck::Failed(action_error(
                command_id,
                ErrorCode::InvalidState,
                "invalid commandId",
                false,
            ));
        }
        if !ctx.can_send_action() {
            return SubmitAck::Failed(action_error(
                command_id,
                ErrorCode::Forbidden,
                "read-only session cannot modify machines",
                false,
            ));
        }
        let Some(machines) = self.machines.read().await.clone() else {
            return SubmitAck::Failed(action_error(
                command_id,
                ErrorCode::AgentUnavailable,
                "machine catalog unavailable",
                true,
            ));
        };
        let hash = match payload_hash(&action) {
            Ok(v) => v,
            Err(_) => {
                return SubmitAck::Failed(action_error(
                    command_id,
                    ErrorCode::InvalidState,
                    "invalid machine payload",
                    false,
                ))
            }
        };
        let prepared = match self.validate(&machines, &action).await {
            Ok(prepared) => prepared,
            Err(ack) => return ack,
        };
        let instance_hint = prepared.instance_id.as_deref();
        match machines
            .metadata()
            .begin_command_with_instance(&command_id, action.type_str(), &hash, instance_hint)
            .await
        {
            Ok(BeginCommand::Existing) => match machines.metadata().command(&command_id).await {
                Ok(Some(c)) if c.phase == "committed" => {
                    return SubmitAck::Duplicate(ActionAck {
                        command_id,
                        status: AckStatus::Duplicate,
                        turn_id: None,
                        chat_id: None,
                        project_id: None,
                        instance_id: c.instance_id,
                        session_id: None,
                        acp_session_id: None,
                        committed_projection_version: None,
                    })
                }
                Ok(Some(c)) if c.phase == "projection_pending" => {
                    if machines.reproject().await.is_err()
                        || machines
                            .metadata()
                            .update_command(&command_id, "committed", None, None, None, None, None)
                            .await
                            .is_err()
                    {
                        return SubmitAck::Failed(action_error(
                            command_id,
                            ErrorCode::AgentUnavailable,
                            "machine projection retry failed",
                            true,
                        ));
                    }
                    return SubmitAck::Duplicate(ActionAck {
                        command_id,
                        status: AckStatus::Duplicate,
                        turn_id: None,
                        chat_id: None,
                        project_id: None,
                        instance_id: c.instance_id,
                        session_id: None,
                        acp_session_id: None,
                        committed_projection_version: None,
                    });
                }
                Ok(Some(c)) if c.phase == "reconciliation_required" => {
                    return SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "machine command requires reconciliation",
                        false,
                    ))
                }
                Ok(Some(c)) if c.phase == "failed" => {
                    return SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::AgentUnavailable,
                        c.error_code.as_deref().unwrap_or("machine command failed"),
                        false,
                    ))
                }
                Ok(_) => {
                    return SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "machine command already in progress",
                        false,
                    ))
                }
                Err(_) => {
                    return SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::AgentUnavailable,
                        "machine command lookup failed",
                        true,
                    ))
                }
            },
            Err(MetadataError::Conflict(_)) => {
                return SubmitAck::Failed(action_error(
                    command_id,
                    ErrorCode::InvalidState,
                    "commandId reused with different payload",
                    false,
                ))
            }
            Err(_) => {
                return SubmitAck::Failed(action_error(
                    command_id,
                    ErrorCode::DeliveryUnknown,
                    "machine command persist failed",
                    true,
                ))
            }
            Ok(BeginCommand::New) => {}
        }
        if tx
            .send(OutboundMsg::Frame(Frame::ActionAck(ActionAck {
                command_id: command_id.clone(),
                status: AckStatus::Accepted,
                turn_id: None,
                chat_id: None,
                project_id: None,
                instance_id: instance_hint.map(str::to_string),
                session_id: None,
                acp_session_id: None,
                committed_projection_version: None,
            })))
            .await
            .is_err()
        {
            return SubmitAck::Handled;
        }
        let cmd = MachineCommand {
            ctx: ctx.clone(),
            action: action.clone(),
            tx: tx.clone(),
        };
        match action {
            ActionEnvelope::MachineAdd { payload, .. } => {
                self.submit_machine_add(&cmd, &machines, &command_id, &payload)
                    .await
            }
            ActionEnvelope::MachineConnect { payload, .. } => {
                self.submit_machine_connect(&cmd, &machines, &command_id, &payload)
                    .await
            }
            ActionEnvelope::MachineDisconnect { payload, .. } => {
                self.submit_machine_disconnect(&cmd, &machines, &command_id, &payload)
                    .await
            }
            ActionEnvelope::MachineStop { payload, .. } => {
                self.submit_machine_stop(&cmd, &machines, &command_id, &payload)
                    .await
            }
            ActionEnvelope::MachineCancel { payload, .. } => {
                self.submit_machine_cancel(&cmd, &machines, &command_id, &payload)
                    .await
            }
            ActionEnvelope::MachineRetry { payload, .. } => {
                self.submit_machine_retry(&cmd, &machines, &command_id, &payload)
                    .await
            }
            ActionEnvelope::MachineTrustHost { payload, .. } => {
                self.submit_machine_trust_host(&cmd, &machines, &command_id, &payload)
                    .await
            }
            ActionEnvelope::MachineConfirmReplace { payload, .. } => {
                self.submit_machine_confirm_replace(&cmd, &machines, &command_id, &payload)
                    .await
            }
            ActionEnvelope::MachineRename { payload, .. } => {
                self.submit_machine_rename(&cmd, &machines, &command_id, &payload)
                    .await
            }
            ActionEnvelope::MachineSetAutoReconnect { payload, .. } => {
                self.submit_machine_set_auto_reconnect(&cmd, &machines, &command_id, &payload)
                    .await
            }
            ActionEnvelope::MachineRemove { payload, .. } => {
                self.submit_machine_remove(&cmd, &machines, &command_id, &payload)
                    .await
            }
            ActionEnvelope::MachineRestore { payload, .. } => {
                self.submit_machine_restore(&cmd, &machines, &command_id, &payload)
                    .await
            }
            _ => unreachable!("dispatch guarantees machine action"),
        }
    }

    /// instance hello 后更新 SSH 机器 phase 并唤醒供应管道等待。
    pub async fn on_instance_hello(&self, instance_id: &str) {
        let Some(machines) = self.machines.read().await.clone() else {
            return;
        };
        if let Err(error) = machines.on_instance_hello(instance_id).await {
            tracing::warn!(
                instance_id = %instance_id,
                ?error,
                "machine hello handling failed"
            );
        }
    }
}

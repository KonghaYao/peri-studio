//! machine 命令的预校验段：submit 入口在 `begin_command_with_instance` 前做
//! 权威 catalog 校验——被拒绝的请求不得留下 in-progress 去重行。

use peri_studio_proto::ack::ErrorCode;
use peri_studio_proto::action::ActionEnvelope;

use crate::channel::machine_command_processor::MachineCommandProcessor;
use crate::control::MachineService;
use crate::persist::machine_phases::{
    is_in_progress, is_terminal_failure, PHASE_AWAITING_HOST_KEY, PHASE_AWAITING_REPLACE,
    PHASE_OFFLINE,
};
use crate::persist::metadata::MachineRecord;
use crate::protocol::{validate_identity_file_path, validate_ssh_destination};

use super::command_coordinator::{action_error, extract_command_id, SubmitAck};

/// 预校验产物（submit 后续 begin_command 与 action 执行使用）。
pub(super) struct PreparedMachine {
    pub instance_id: Option<String>,
}

impl MachineCommandProcessor {
    /// 预校验（§10：校验先于保留 commandId 去重行）。
    #[allow(clippy::result_large_err)]
    pub(super) async fn validate(
        &self,
        machines: &MachineService,
        action: &ActionEnvelope,
    ) -> Result<PreparedMachine, SubmitAck> {
        let command_id = extract_command_id(action).unwrap_or_default();
        match action {
            ActionEnvelope::MachineAdd { payload, .. } => {
                if let Err(message) = validate_ssh_destination(&payload.destination) {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        &message,
                        false,
                    )));
                }
                if let Err(message) = validate_identity_file_path(payload.identity_file.as_deref())
                {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        &message,
                        false,
                    )));
                }
                let port = payload.port.map(|p| p as i64);
                if let Ok(Some(existing)) = machines
                    .metadata()
                    .find_ssh_by_destination(&payload.destination, port)
                    .await
                {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        &format!(
                            "a computer with this destination already exists ({})",
                            existing.instance_id
                        ),
                        false,
                    )));
                }
                if !machines.has_pipeline() {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::AgentUnavailable,
                        "SSH machine provisioning is not available",
                        true,
                    )));
                }
                Ok(PreparedMachine { instance_id: None })
            }
            ActionEnvelope::MachineConnect { .. }
            | ActionEnvelope::MachineDisconnect { .. }
            | ActionEnvelope::MachineStop { .. }
            | ActionEnvelope::MachineCancel { .. }
            | ActionEnvelope::MachineRetry { .. }
            | ActionEnvelope::MachineTrustHost { .. }
            | ActionEnvelope::MachineConfirmReplace { .. }
            | ActionEnvelope::MachineRename { .. }
            | ActionEnvelope::MachineSetAutoReconnect { .. }
            | ActionEnvelope::MachineRemove { .. } => {
                let instance_id = machine_instance_id(action).expect("machine instance action");
                validate_active_ssh_machine(machines, action, &command_id, instance_id).await
            }
            ActionEnvelope::MachineRestore { payload, .. } => {
                let instance_id = payload.instance_id.clone();
                match machines.metadata().machine(&instance_id).await {
                    Ok(Some(record)) if record.archived_at.is_some() => {
                        let _ = record;
                    }
                    Ok(Some(_)) => {
                        return Err(SubmitAck::Failed(action_error(
                            command_id,
                            ErrorCode::InvalidState,
                            "machine is not archived",
                            false,
                        )));
                    }
                    _ => {
                        return Err(SubmitAck::Failed(action_error(
                            command_id,
                            ErrorCode::InvalidState,
                            "archived machine not found",
                            false,
                        )));
                    }
                };
                if !machines.has_pipeline() {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::AgentUnavailable,
                        "SSH machine provisioning is not available",
                        true,
                    )));
                }
                Ok(PreparedMachine {
                    instance_id: Some(instance_id),
                })
            }
            _ => Err(SubmitAck::Failed(action_error(
                command_id,
                ErrorCode::InvalidState,
                "unsupported machine action",
                false,
            ))),
        }
    }
}

#[allow(clippy::result_large_err)]
async fn validate_active_ssh_machine(
    machines: &MachineService,
    action: &ActionEnvelope,
    command_id: &str,
    instance_id: &str,
) -> Result<PreparedMachine, SubmitAck> {
    let record = match machines.metadata().machine(instance_id).await {
        Ok(Some(record)) if record.archived_at.is_none() => record,
        Ok(Some(_)) => {
            return Err(SubmitAck::Failed(action_error(
                command_id.to_string(),
                ErrorCode::InvalidState,
                "machine is archived",
                false,
            )));
        }
        _ => {
            return Err(SubmitAck::Failed(action_error(
                command_id.to_string(),
                ErrorCode::InvalidState,
                "machine not found",
                false,
            )));
        }
    };
    if record.kind == "local" {
        return Err(SubmitAck::Failed(action_error(
            command_id.to_string(),
            ErrorCode::InvalidState,
            "operation not allowed on local machine",
            false,
        )));
    }
    validate_instance_action(command_id, action, &record)?;
    if requires_pipeline(action) && !machines.has_pipeline() {
        return Err(SubmitAck::Failed(action_error(
            command_id.to_string(),
            ErrorCode::AgentUnavailable,
            "SSH machine provisioning is not available",
            true,
        )));
    }
    Ok(PreparedMachine {
        instance_id: Some(instance_id.to_string()),
    })
}

fn machine_instance_id(action: &ActionEnvelope) -> Option<&str> {
    match action {
        ActionEnvelope::MachineConnect { payload, .. }
        | ActionEnvelope::MachineDisconnect { payload, .. }
        | ActionEnvelope::MachineStop { payload, .. }
        | ActionEnvelope::MachineCancel { payload, .. }
        | ActionEnvelope::MachineRetry { payload, .. }
        | ActionEnvelope::MachineRemove { payload, .. } => Some(&payload.instance_id),
        ActionEnvelope::MachineTrustHost { payload, .. } => Some(&payload.instance_id),
        ActionEnvelope::MachineConfirmReplace { payload, .. } => Some(&payload.instance_id),
        ActionEnvelope::MachineRename { payload, .. } => Some(&payload.instance_id),
        ActionEnvelope::MachineSetAutoReconnect { payload, .. } => Some(&payload.instance_id),
        ActionEnvelope::MachineRestore { payload, .. } => Some(&payload.instance_id),
        _ => None,
    }
}

fn requires_pipeline(action: &ActionEnvelope) -> bool {
    matches!(
        action,
        ActionEnvelope::MachineConnect { .. }
            | ActionEnvelope::MachineDisconnect { .. }
            | ActionEnvelope::MachineStop { .. }
            | ActionEnvelope::MachineCancel { .. }
            | ActionEnvelope::MachineRetry { .. }
            | ActionEnvelope::MachineTrustHost { .. }
            | ActionEnvelope::MachineConfirmReplace { .. }
            | ActionEnvelope::MachineRestore { .. }
    )
}

#[allow(clippy::result_large_err)]
fn validate_instance_action(
    command_id: &str,
    action: &ActionEnvelope,
    record: &MachineRecord,
) -> Result<(), SubmitAck> {
    match action {
        ActionEnvelope::MachineConnect { .. } => {
            if is_in_progress(&record.phase) {
                return Err(SubmitAck::Failed(action_error(
                    command_id.to_string(),
                    ErrorCode::InvalidState,
                    "machine pipeline already in progress",
                    false,
                )));
            }
        }
        ActionEnvelope::MachineCancel { .. } => {
            if !is_in_progress(&record.phase) {
                return Err(SubmitAck::Failed(action_error(
                    command_id.to_string(),
                    ErrorCode::InvalidState,
                    "machine is not in an active pipeline",
                    false,
                )));
            }
        }
        ActionEnvelope::MachineRetry { .. } => {
            if !is_terminal_failure(&record.phase) {
                return Err(SubmitAck::Failed(action_error(
                    command_id.to_string(),
                    ErrorCode::InvalidState,
                    "machine is not in a failed state",
                    false,
                )));
            }
        }
        ActionEnvelope::MachineTrustHost { payload, .. } => {
            if record.phase != PHASE_AWAITING_HOST_KEY {
                return Err(SubmitAck::Failed(action_error(
                    command_id.to_string(),
                    ErrorCode::InvalidState,
                    "machine is not awaiting host key trust",
                    false,
                )));
            }
            if record.pending_host_key_fingerprint.as_deref() != Some(payload.fingerprint.as_str())
            {
                return Err(SubmitAck::Failed(action_error(
                    command_id.to_string(),
                    ErrorCode::InvalidState,
                    "host key fingerprint mismatch",
                    false,
                )));
            }
        }
        ActionEnvelope::MachineConfirmReplace { .. } => {
            if record.phase != PHASE_AWAITING_REPLACE {
                return Err(SubmitAck::Failed(action_error(
                    command_id.to_string(),
                    ErrorCode::InvalidState,
                    "machine is not awaiting binary replace confirmation",
                    false,
                )));
            }
        }
        ActionEnvelope::MachineRename { payload, .. } => {
            if payload.name.trim().is_empty() {
                return Err(SubmitAck::Failed(action_error(
                    command_id.to_string(),
                    ErrorCode::InvalidState,
                    "display name is empty",
                    false,
                )));
            }
        }
        ActionEnvelope::MachineRemove { .. } => {
            if record.phase != PHASE_OFFLINE && !is_terminal_failure(&record.phase) {
                return Err(SubmitAck::Failed(action_error(
                    command_id.to_string(),
                    ErrorCode::InvalidState,
                    "stop agents on this computer before removing it from Peri",
                    false,
                )));
            }
        }
        ActionEnvelope::MachineRestore { .. } => {}
        _ => {}
    }
    Ok(())
}

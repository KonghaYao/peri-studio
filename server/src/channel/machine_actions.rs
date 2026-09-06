//! machine 命令的 action 执行段：SQLite 变更 → 管道编排 → Registry 投影屏障 →
//! committed ack；失败路径落 `reconciliation_required`（可恢复，不静默）。

use std::time::Instant;

use peri_studio_proto::ack::{AckStatus, ErrorCode};
use peri_studio_proto::action::{
    MachineAddPayload, MachineInstancePayload, MachineRenamePayload,
    MachineSetAutoReconnectPayload, MachineTrustHostPayload,
};

use crate::auth::audit::machine_audit;
use crate::channel::machine_command_processor::{MachineCommand, MachineCommandProcessor};
use crate::control::{AdmitAddParams, MachineDeliveryOutcome, MachineService};
use crate::persist::machine_phases::normalize_ssh_hostname;

use super::command_coordinator::{action_error, SubmitAck};

impl MachineCommandProcessor {
    pub(super) async fn submit_machine_add(
        &self,
        cmd: &MachineCommand,
        machines: &MachineService,
        command_id: &str,
        payload: &MachineAddPayload,
    ) -> SubmitAck {
        let started = Instant::now();
        let display_name = payload
            .display_name
            .as_deref()
            .unwrap_or(&payload.destination);
        match machines
            .admit_and_start_add(AdmitAddParams {
                destination: &payload.destination,
                port: payload.port.map(|p| p as i64),
                identity_file: payload.identity_file.as_deref(),
                display_name,
            })
            .await
        {
            Ok(instance_id) => {
                if machines
                    .metadata()
                    .set_command_instance_id(command_id, &instance_id)
                    .await
                    .is_err()
                    || self
                        .commit_metadata_barrier(machines, command_id)
                        .await
                        .is_err()
                {
                    return SubmitAck::Failed(action_error(
                        command_id.to_string(),
                        ErrorCode::AgentUnavailable,
                        "machine commit barrier failed",
                        true,
                    ));
                }
                self.audit_machine_committed(machines, &instance_id, "machine.add", started)
                    .await;
                self.send_machine_ack(cmd, AckStatus::Committed, Some(&instance_id))
                    .await;
            }
            Err(_) => {
                let _ = machines
                    .metadata()
                    .update_command(
                        command_id,
                        "reconciliation_required",
                        None,
                        None,
                        None,
                        None,
                        Some("machine_add_failed"),
                    )
                    .await;
                self.send_error(cmd, ErrorCode::AgentUnavailable, "machine add failed", true)
                    .await;
            }
        }
        SubmitAck::Handled
    }

    pub(super) async fn submit_machine_connect(
        &self,
        cmd: &MachineCommand,
        machines: &MachineService,
        command_id: &str,
        payload: &MachineInstancePayload,
    ) -> SubmitAck {
        let started = Instant::now();
        self.finish_pipeline_action(
            cmd,
            machines,
            command_id,
            &payload.instance_id,
            "machine connect failed",
            machines.connect(&payload.instance_id).await.map(|_| ()),
            Some(("machine.connect", started)),
        )
        .await
    }

    pub(super) async fn submit_machine_disconnect(
        &self,
        cmd: &MachineCommand,
        machines: &MachineService,
        command_id: &str,
        payload: &MachineInstancePayload,
    ) -> SubmitAck {
        let started = Instant::now();
        self.finish_pipeline_action(
            cmd,
            machines,
            command_id,
            &payload.instance_id,
            "machine disconnect failed",
            machines.disconnect_tunnel(&payload.instance_id).await,
            Some(("machine.disconnect", started)),
        )
        .await
    }

    pub(super) async fn submit_machine_stop(
        &self,
        cmd: &MachineCommand,
        machines: &MachineService,
        command_id: &str,
        payload: &MachineInstancePayload,
    ) -> SubmitAck {
        let started = Instant::now();
        match machines.stop_agents(&payload.instance_id).await {
            Ok(MachineDeliveryOutcome::Committed) => {
                if self
                    .commit_metadata_barrier(machines, command_id)
                    .await
                    .is_err()
                {
                    return SubmitAck::Failed(action_error(
                        command_id.to_string(),
                        ErrorCode::AgentUnavailable,
                        "machine stop finalize failed",
                        true,
                    ));
                }
                self.audit_machine_committed(
                    machines,
                    &payload.instance_id,
                    "machine.stop",
                    started,
                )
                .await;
                self.send_machine_ack(cmd, AckStatus::Committed, Some(&payload.instance_id))
                    .await;
            }
            Ok(MachineDeliveryOutcome::DeliveryUnknown) => {
                self.send_error(
                    cmd,
                    ErrorCode::DeliveryUnknown,
                    "remote agents stop result is unknown",
                    false,
                )
                .await;
            }
            Err(_) => {
                self.send_error(
                    cmd,
                    ErrorCode::AgentUnavailable,
                    "machine stop failed",
                    true,
                )
                .await;
            }
        }
        SubmitAck::Handled
    }

    pub(super) async fn submit_machine_cancel(
        &self,
        cmd: &MachineCommand,
        machines: &MachineService,
        command_id: &str,
        payload: &MachineInstancePayload,
    ) -> SubmitAck {
        match machines.cancel_pipeline(&payload.instance_id).await {
            Ok(MachineDeliveryOutcome::Committed) => {
                if self
                    .commit_metadata_barrier(machines, command_id)
                    .await
                    .is_err()
                {
                    return SubmitAck::Failed(action_error(
                        command_id.to_string(),
                        ErrorCode::AgentUnavailable,
                        "machine cancel finalize failed",
                        true,
                    ));
                }
                self.send_machine_ack(cmd, AckStatus::Committed, Some(&payload.instance_id))
                    .await;
            }
            Ok(MachineDeliveryOutcome::DeliveryUnknown) => {
                self.send_error(
                    cmd,
                    ErrorCode::DeliveryUnknown,
                    "remote instance may already be running",
                    false,
                )
                .await;
            }
            Err(_) => {
                self.send_error(
                    cmd,
                    ErrorCode::AgentUnavailable,
                    "machine cancel failed",
                    true,
                )
                .await;
            }
        }
        SubmitAck::Handled
    }

    pub(super) async fn submit_machine_retry(
        &self,
        cmd: &MachineCommand,
        machines: &MachineService,
        command_id: &str,
        payload: &MachineInstancePayload,
    ) -> SubmitAck {
        self.finish_pipeline_action(
            cmd,
            machines,
            command_id,
            &payload.instance_id,
            "machine retry failed",
            machines.retry(&payload.instance_id).await,
            None,
        )
        .await
    }

    pub(super) async fn submit_machine_trust_host(
        &self,
        cmd: &MachineCommand,
        machines: &MachineService,
        command_id: &str,
        payload: &MachineTrustHostPayload,
    ) -> SubmitAck {
        self.finish_pipeline_action(
            cmd,
            machines,
            command_id,
            &payload.instance_id,
            "machine trust-host failed",
            machines
                .trust_host(&payload.instance_id, &payload.fingerprint)
                .await,
            None,
        )
        .await
    }

    pub(super) async fn submit_machine_confirm_replace(
        &self,
        cmd: &MachineCommand,
        machines: &MachineService,
        command_id: &str,
        payload: &MachineInstancePayload,
    ) -> SubmitAck {
        self.finish_pipeline_action(
            cmd,
            machines,
            command_id,
            &payload.instance_id,
            "machine confirm-replace failed",
            machines.confirm_replace(&payload.instance_id).await,
            None,
        )
        .await
    }

    pub(super) async fn submit_machine_rename(
        &self,
        cmd: &MachineCommand,
        machines: &MachineService,
        command_id: &str,
        payload: &MachineRenamePayload,
    ) -> SubmitAck {
        self.finish_metadata_action(
            cmd,
            machines,
            command_id,
            &payload.instance_id,
            "machine rename failed",
            machines
                .rename(&payload.instance_id, payload.name.trim())
                .await,
            None,
        )
        .await
    }

    pub(super) async fn submit_machine_set_auto_reconnect(
        &self,
        cmd: &MachineCommand,
        machines: &MachineService,
        command_id: &str,
        payload: &MachineSetAutoReconnectPayload,
    ) -> SubmitAck {
        self.finish_metadata_action(
            cmd,
            machines,
            command_id,
            &payload.instance_id,
            "machine auto-reconnect update failed",
            machines
                .set_auto_reconnect(&payload.instance_id, payload.enabled)
                .await,
            None,
        )
        .await
    }

    pub(super) async fn submit_machine_remove(
        &self,
        cmd: &MachineCommand,
        machines: &MachineService,
        command_id: &str,
        payload: &MachineInstancePayload,
    ) -> SubmitAck {
        let started = Instant::now();
        self.finish_metadata_action(
            cmd,
            machines,
            command_id,
            &payload.instance_id,
            "machine remove failed",
            machines.remove(&payload.instance_id).await,
            Some(("machine.remove", started)),
        )
        .await
    }

    pub(super) async fn submit_machine_restore(
        &self,
        cmd: &MachineCommand,
        machines: &MachineService,
        command_id: &str,
        payload: &MachineInstancePayload,
    ) -> SubmitAck {
        let started = Instant::now();
        self.finish_pipeline_action(
            cmd,
            machines,
            command_id,
            &payload.instance_id,
            "machine restore failed",
            machines.restore(&payload.instance_id).await,
            Some(("machine.restore", started)),
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn finish_pipeline_action(
        &self,
        cmd: &MachineCommand,
        machines: &MachineService,
        command_id: &str,
        instance_id: &str,
        failure_message: &str,
        result: Result<(), crate::control::MachineServiceError>,
        audit: Option<(&str, Instant)>,
    ) -> SubmitAck {
        match result {
            Ok(()) => {
                if self
                    .commit_metadata_barrier(machines, command_id)
                    .await
                    .is_err()
                {
                    return SubmitAck::Failed(action_error(
                        command_id.to_string(),
                        ErrorCode::AgentUnavailable,
                        "machine command finalize failed",
                        true,
                    ));
                }
                if let Some((action, started)) = audit {
                    self.audit_machine_committed(machines, instance_id, action, started)
                        .await;
                }
                self.send_machine_ack(cmd, AckStatus::Committed, Some(instance_id))
                    .await;
            }
            Err(_) => {
                self.send_error(cmd, ErrorCode::AgentUnavailable, failure_message, true)
                    .await;
            }
        }
        SubmitAck::Handled
    }

    #[allow(clippy::too_many_arguments)]
    async fn finish_metadata_action(
        &self,
        cmd: &MachineCommand,
        machines: &MachineService,
        command_id: &str,
        instance_id: &str,
        failure_message: &str,
        result: Result<(), crate::control::MachineServiceError>,
        audit: Option<(&str, Instant)>,
    ) -> SubmitAck {
        match result {
            Ok(()) => {
                if self
                    .commit_metadata_barrier(machines, command_id)
                    .await
                    .is_err()
                {
                    return SubmitAck::Failed(action_error(
                        command_id.to_string(),
                        ErrorCode::AgentUnavailable,
                        "machine command finalize failed",
                        true,
                    ));
                }
                if let Some((action, started)) = audit {
                    self.audit_machine_committed(machines, instance_id, action, started)
                        .await;
                }
                self.send_machine_ack(cmd, AckStatus::Committed, Some(instance_id))
                    .await;
            }
            Err(_) => {
                let _ = machines
                    .metadata()
                    .update_command(
                        command_id,
                        "reconciliation_required",
                        None,
                        None,
                        None,
                        None,
                        Some("machine_metadata_failed"),
                    )
                    .await;
                self.send_error(cmd, ErrorCode::AgentUnavailable, failure_message, false)
                    .await;
            }
        }
        SubmitAck::Handled
    }

    async fn commit_metadata_barrier(
        &self,
        machines: &MachineService,
        command_id: &str,
    ) -> Result<(), ()> {
        if machines
            .metadata()
            .update_command(
                command_id,
                "projection_pending",
                None,
                None,
                None,
                None,
                None,
            )
            .await
            .is_err()
            || machines.reproject().await.is_err()
            || machines
                .metadata()
                .update_command(command_id, "committed", None, None, None, None, None)
                .await
                .is_err()
        {
            let _ = machines
                .metadata()
                .update_command(
                    command_id,
                    "reconciliation_required",
                    None,
                    None,
                    None,
                    None,
                    Some("machine_projection_or_finalize_failed"),
                )
                .await;
            return Err(());
        }
        Ok(())
    }

    async fn audit_machine_committed(
        &self,
        machines: &MachineService,
        instance_id: &str,
        action: &str,
        started: Instant,
    ) {
        let Ok(Some(record)) = machines.metadata().machine(instance_id).await else {
            return;
        };
        let hostname = record
            .ssh_destination
            .as_deref()
            .map(normalize_ssh_hostname);
        machine_audit(
            instance_id,
            hostname.as_deref(),
            action,
            "ok",
            started.elapsed().as_millis() as u64,
            Some(record.pipeline_generation as u64),
        );
    }

    pub(super) async fn send_machine_ack(
        &self,
        cmd: &MachineCommand,
        status: AckStatus,
        instance_id: Option<&str>,
    ) {
        let _ = cmd
            .tx
            .send(crate::channel::broadcaster::OutboundMsg::Frame(
                peri_studio_proto::frame::Frame::ActionAck(peri_studio_proto::ack::ActionAck {
                    command_id: super::command_coordinator::extract_command_id(&cmd.action)
                        .unwrap_or_default(),
                    status,
                    turn_id: None,
                    chat_id: None,
                    project_id: None,
                    instance_id: instance_id.map(str::to_string),
                    session_id: None,
                    acp_session_id: None,
                    committed_projection_version: None,
                }),
            ))
            .await;
    }

    pub(super) async fn send_error(
        &self,
        cmd: &MachineCommand,
        code: ErrorCode,
        message: &str,
        retryable: bool,
    ) {
        let command_id =
            super::command_coordinator::extract_command_id(&cmd.action).unwrap_or_default();
        crate::auth::audit::audit(
            "command.error",
            Some(&command_id),
            Some(&cmd.ctx.token_id),
            "error",
            std::time::Duration::ZERO,
            None,
        );
        let _ = cmd
            .tx
            .send(crate::channel::broadcaster::OutboundMsg::Frame(
                peri_studio_proto::frame::Frame::ActionError(action_error(
                    command_id, code, message, retryable,
                )),
            ))
            .await;
    }
}

//! SessionRewindExecution 执行侧（拆分自 session_rewind.rs，原文件 700 行）。
//!
//! 拆分动机：rewind 的执行轨道（submit/execute）与查询轨道（candidates/
//! preview）共享能力门与转换租赁，但终结语义完全不同。本文件收敛
//! `SessionRewindExecution`：ledger 预留与 Accepted 发射（submit）、dispatch
//! 与 replay 加载（execute）、payload 校验（validate_execute_payload），以及
//! ledger 错误转换与 frame 构造（prepare_error / finish_* / replay_terminal /
//! acknowledged / delivery_unknown / ledger_unavailable / error_key）。
//! 查询侧与共享私有 helper（validate_message_id、error）保留在父模块
//! `session_rewind.rs`，本文件经 `super::` 引用；不改变任何分支语义。

use std::sync::Arc;

use peri_studio_proto::ack::{AckStatus, ActionAck, ActionError, ErrorCode};
use peri_studio_proto::action::RewindPayload;
use peri_studio_proto::frame::Frame;
use tokio::sync::mpsc;

use crate::channel::broadcaster::OutboundMsg;
use crate::channel::runtime_command_ledger::{
    RuntimeCommandClaim, RuntimeCommandIdentity, RuntimeCommandLedger, RuntimeCommandLedgerError,
    RuntimeCommandPermit, RuntimeCommandTerminal,
};
use crate::channel::session_runtime_operations::{
    SessionOperationOutcome, SessionRuntimeOperations,
};
use crate::persist::metadata::{payload_hash, BeginCommand, MetadataError, MetadataStore};

use super::{
    error, validate_message_id, RewindFingerprint, SessionRewindExecution, SessionRewindQueries,
    REWIND_COMMAND_TYPE,
};

impl SessionRewindExecution {
    pub fn new(queries: SessionRewindQueries, operations: SessionRuntimeOperations) -> Self {
        Self {
            queries,
            operations,
            ledger: RuntimeCommandLedger::default(),
        }
    }

    pub async fn install_metadata(&self, metadata: Arc<MetadataStore>) {
        self.ledger.install(metadata).await;
    }

    pub async fn submit(
        &self,
        command_id: &str,
        payload: &RewindPayload,
        tx: mpsc::Sender<OutboundMsg>,
    ) -> Result<(), ActionError> {
        validate_execute_payload(command_id, payload)?;
        let fingerprint = payload_hash(&RewindFingerprint {
            schema: 1,
            command_type: REWIND_COMMAND_TYPE,
            chat_id: &payload.chat_id,
            target_message_id: &payload.target_message_id,
            preview_fingerprint: &payload.preview_fingerprint,
            revert_files: payload.revert_files,
        })
        .map_err(|_| {
            error(
                command_id,
                ErrorCode::InvalidState,
                "invalid rewind command payload",
                false,
            )
        })?;
        let identity = RuntimeCommandIdentity {
            command_id: command_id.to_string(),
            command_type: REWIND_COMMAND_TYPE,
            chat_id: payload.chat_id.clone(),
            payload_fingerprint: fingerprint,
        };
        let exists = self
            .ledger
            .exists(&identity)
            .await
            .map_err(|failure| prepare_error(command_id, failure))?;
        if !exists {
            let _guard = self
                .queries
                .chats
                .runtime_transition_guard(&payload.chat_id)
                .await;
            self.queries
                .validate_target(command_id, &payload.chat_id)
                .await?;
        }
        match self.ledger.reserve(&identity).await {
            Ok(BeginCommand::New | BeginCommand::Existing) => {}
            Err(failure) => return Err(prepare_error(command_id, failure)),
        }
        let _ = tx
            .send(OutboundMsg::Frame(acknowledged(
                command_id,
                AckStatus::Accepted,
            )))
            .await;
        let this = self.clone();
        let payload = payload.clone();
        tokio::spawn(async move {
            let frame = this.execute(identity, payload).await;
            let _ = tx.send(OutboundMsg::Frame(frame)).await;
        });
        Ok(())
    }

    async fn execute(&self, identity: RuntimeCommandIdentity, payload: RewindPayload) -> Frame {
        let command_id = identity.command_id.clone();
        let claim = match self.ledger.claim(identity).await {
            Ok(claim) => claim,
            Err(_) => return ledger_unavailable(&command_id),
        };
        let RuntimeCommandClaim::Execute(mut permit) = claim else {
            return replay_terminal(&command_id, claim);
        };
        let _runtime_guard = self
            .queries
            .chats
            .runtime_transition_guard(&payload.chat_id)
            .await;
        let target = match self
            .queries
            .validate_target(&command_id, &payload.chat_id)
            .await
        {
            Ok(record) => record,
            Err(failure) => return finish_not_delivered(permit, failure).await,
        };
        let session_id = target.session_id.expect("validated active ACP session");
        if permit.mark_dispatching().await.is_err() {
            return ledger_unavailable(&command_id);
        }
        let rpc_id = self.queries.translator.alloc_rpc_id();
        let message = serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "method": "session/rewind",
            "params": {
                "sessionId": session_id,
                "target_message_id": payload.target_message_id,
                "preview_fingerprint": payload.preview_fingerprint,
                "revert_files": payload.revert_files,
            },
        });
        let response = self
            .queries
            .relay
            .register_rpc(&rpc_id, command_id.clone())
            .await;
        if self
            .queries
            .instance
            .forward_rpc(&target.instance_id, &payload.chat_id, &message)
            .await
            .is_err()
        {
            self.queries.relay.cancel_rpc(&rpc_id).await;
            return finish_unknown(permit, &command_id, "rewind_forward_unknown").await;
        }
        let response = match tokio::time::timeout(self.queries.timeout, response).await {
            Ok(Ok(response))
                if response.get("error").is_none()
                    && response["result"]["status"].as_str() == Some("executed") =>
            {
                response
            }
            _ => {
                self.queries.relay.cancel_rpc(&rpc_id).await;
                return finish_unknown(permit, &command_id, "rewind_response_unknown").await;
            }
        };
        let _ = response;
        if permit.mark_effect_confirmed().await.is_err() {
            return finish_unknown(permit, &command_id, "rewind_confirmation_not_durable").await;
        }

        // RewindCompleted is an activity signal, not a projection barrier.
        // Re-load the same durable ACP session through the official replay path
        // before telling the browser that history has committed.
        //
        // 必须先释放 `_runtime_guard` 再进入 start_load：guard 是 per-chat 的
        // tokio Mutex（不可重入），而 start_load/prepare 会再次获取同一把锁
        // 并持有到回放窗口结束；若此处不释放，replay 将永久等待自身持有的
        // 锁（rewind 保护段已随 effect 确认结束，由 load 无缝接管互斥）。
        drop(_runtime_guard);
        let load = match self
            .operations
            .start_load(&command_id, &payload.chat_id, &session_id)
            .await
        {
            Ok(load) => load,
            Err(_) => {
                return finish_unknown(permit, &command_id, "rewind_replay_prepare_failed").await;
            }
        };
        if !matches!(
            load.execute().await,
            Ok(SessionOperationOutcome::Loaded { .. })
        ) {
            return finish_unknown(permit, &command_id, "rewind_replay_failed").await;
        }
        if permit.commit_after_effect().await.is_err() {
            return delivery_unknown(&command_id);
        }
        acknowledged(&command_id, AckStatus::Committed)
    }
}

fn validate_execute_payload(command_id: &str, payload: &RewindPayload) -> Result<(), ActionError> {
    validate_message_id(&payload.target_message_id)
        .map_err(|message| error(command_id, ErrorCode::InvalidState, message, false))?;
    if payload.preview_fingerprint.len() != 64
        || !payload
            .preview_fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(error(
            command_id,
            ErrorCode::InvalidState,
            "rewind preview fingerprint is invalid",
            false,
        ));
    }
    if !payload.revert_files {
        return Err(error(
            command_id,
            ErrorCode::InvalidState,
            "this rewind flow requires the previewed file rollback",
            false,
        ));
    }
    Ok(())
}

fn prepare_error(command_id: &str, failure: RuntimeCommandLedgerError) -> ActionError {
    match failure {
        RuntimeCommandLedgerError::Metadata(MetadataError::Conflict(_)) => error(
            command_id,
            ErrorCode::InvalidState,
            "commandId reused with a different rewind payload",
            false,
        ),
        _ => error(
            command_id,
            ErrorCode::AgentUnavailable,
            "rewind command ledger is unavailable",
            true,
        ),
    }
}

async fn finish_not_delivered(permit: RuntimeCommandPermit, failure: ActionError) -> Frame {
    let command_id = failure.command_id.clone();
    if permit
        .fail_not_delivered(error_key(failure.code))
        .await
        .is_err()
    {
        return ledger_unavailable(&command_id);
    }
    Frame::ActionError(failure)
}

async fn finish_unknown(permit: RuntimeCommandPermit, command_id: &str, reason: &str) -> Frame {
    let _ = permit.delivery_unknown(reason).await;
    delivery_unknown(command_id)
}

fn replay_terminal(command_id: &str, claim: RuntimeCommandClaim) -> Frame {
    let RuntimeCommandClaim::Terminal(terminal) = claim else {
        unreachable!("execute claim handled by caller")
    };
    match terminal {
        RuntimeCommandTerminal::Committed => acknowledged(command_id, AckStatus::Duplicate),
        RuntimeCommandTerminal::Rejected { error_code }
        | RuntimeCommandTerminal::FailedNotDelivered { error_code } => Frame::ActionError(error(
            command_id,
            ErrorCode::InvalidState,
            error_code.as_deref().unwrap_or("rewind was not delivered"),
            false,
        )),
        RuntimeCommandTerminal::DeliveryUnknown { .. } => delivery_unknown(command_id),
    }
}

fn acknowledged(command_id: &str, status: AckStatus) -> Frame {
    Frame::ActionAck(ActionAck {
        command_id: command_id.to_string(),
        status,
        turn_id: None,
        chat_id: None,
        project_id: None,
        instance_id: None,
        session_id: None,
        acp_session_id: None,
        committed_projection_version: None,
        resource_result: None,
    })
}

fn delivery_unknown(command_id: &str) -> Frame {
    Frame::ActionError(error(
        command_id,
        ErrorCode::DeliveryUnknown,
        "rewind outcome is unknown; do not execute another rewind",
        false,
    ))
}

fn ledger_unavailable(command_id: &str) -> Frame {
    Frame::ActionError(error(
        command_id,
        ErrorCode::AgentUnavailable,
        "rewind command ledger is unavailable",
        true,
    ))
}

fn error_key(code: ErrorCode) -> &'static str {
    match code {
        ErrorCode::ChatNotFound => "CHAT_NOT_FOUND",
        ErrorCode::UnsupportedFrame => "UNSUPPORTED_FRAME",
        ErrorCode::InvalidState => "INVALID_STATE",
        _ => "AGENT_UNAVAILABLE",
    }
}

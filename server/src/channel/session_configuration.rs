//! Agent-authoritative ACP session configuration mutation lifecycle.

use std::sync::Arc;
use std::time::Duration;

use peri_studio_proto::ack::{AckStatus, ActionAck, ActionError, ErrorCode};
use peri_studio_proto::action::ConfigSetPayload;
use peri_studio_proto::frame::Frame;
use serde::Serialize;
use tokio::sync::mpsc;

use crate::channel::broadcaster::OutboundMsg;
use crate::channel::relay_event_handler::RelayEventHandler;
use crate::channel::runtime_command_ledger::{
    RuntimeCommandClaim, RuntimeCommandIdentity, RuntimeCommandLedger, RuntimeCommandLedgerError,
    RuntimeCommandPermit, RuntimeCommandTerminal,
};
use crate::control::{ChatRegistry, InstanceRegistry};
use crate::persist::metadata::{payload_hash, BeginCommand, MetadataError, MetadataStore};
use crate::protocol::{normalize_agent_config, AgentConfigSnapshot, Translator};
use crate::state::doc_manager::{DocCommand, DocManager, SubmitResult};

const COMMAND_TYPE: &str = "chat/config-set";

#[derive(Clone)]
pub(super) struct SessionConfiguration {
    chats: ChatRegistry,
    doc: Arc<DocManager>,
    instance: Arc<InstanceRegistry>,
    relay: Arc<RelayEventHandler>,
    translator: Arc<Translator>,
    ledger: RuntimeCommandLedger,
    timeout: Duration,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigFingerprint<'a> {
    schema: u8,
    command_type: &'static str,
    chat_id: &'a str,
    config_id: &'a str,
    value: &'a str,
}

struct Target {
    instance_id: String,
    session_id: String,
}

impl SessionConfiguration {
    pub fn new(
        chats: ChatRegistry,
        doc: Arc<DocManager>,
        instance: Arc<InstanceRegistry>,
        relay: Arc<RelayEventHandler>,
        translator: Arc<Translator>,
        timeout: Duration,
    ) -> Self {
        Self {
            chats,
            doc,
            instance,
            relay,
            translator,
            ledger: RuntimeCommandLedger::default(),
            timeout,
        }
    }

    pub async fn install_metadata(&self, metadata: Arc<MetadataStore>) {
        self.ledger.install(metadata).await;
    }

    pub async fn set(
        &self,
        command_id: &str,
        payload: &ConfigSetPayload,
        tx: mpsc::Sender<OutboundMsg>,
    ) -> Result<(), ActionError> {
        validate_identifier(&payload.config_id)
            .map_err(|message| error(command_id, ErrorCode::InvalidState, message, false))?;
        validate_identifier(&payload.value)
            .map_err(|message| error(command_id, ErrorCode::InvalidState, message, false))?;
        let fingerprint = payload_hash(&ConfigFingerprint {
            schema: 1,
            command_type: COMMAND_TYPE,
            chat_id: &payload.chat_id,
            config_id: &payload.config_id,
            value: &payload.value,
        })
        .map_err(|_| {
            error(
                command_id,
                ErrorCode::InvalidState,
                "invalid config command payload",
                false,
            )
        })?;
        let identity = RuntimeCommandIdentity {
            command_id: command_id.to_string(),
            command_type: COMMAND_TYPE,
            chat_id: payload.chat_id.clone(),
            payload_fingerprint: fingerprint,
        };
        let exists = self
            .ledger
            .exists(&identity)
            .await
            .map_err(|failure| prepare_error(command_id, failure))?;
        if !exists {
            self.validate_target(command_id, payload).await?;
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

    async fn execute(&self, identity: RuntimeCommandIdentity, payload: ConfigSetPayload) -> Frame {
        let command_id = identity.command_id.clone();
        let claim = match self.ledger.claim(identity).await {
            Ok(claim) => claim,
            Err(_) => return ledger_unavailable(&command_id),
        };
        let RuntimeCommandClaim::Execute(mut permit) = claim else {
            return replay_terminal(&command_id, claim);
        };
        let _runtime_guard = self.chats.runtime_transition_guard(&payload.chat_id).await;
        let target = match self.validate_target(&command_id, &payload).await {
            Ok(target) => target,
            Err(failure) => return finish_not_delivered(permit, failure).await,
        };
        if permit.mark_dispatching().await.is_err() {
            return ledger_unavailable(&command_id);
        }
        let rpc_id = self.translator.alloc_rpc_id();
        let message = serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "method": "session/set_config_option",
            "params": {
                "sessionId": target.session_id,
                "configId": payload.config_id,
                "value": payload.value,
            },
        });
        let response = self.relay.register_rpc(&rpc_id, command_id.clone()).await;
        if self
            .instance
            .forward_rpc(&target.instance_id, &payload.chat_id, &message)
            .await
            .is_err()
        {
            self.relay.cancel_rpc(&rpc_id).await;
            return finish_unknown(permit, &command_id, "config_forward_unknown").await;
        }
        let response = match tokio::time::timeout(self.timeout, response).await {
            Ok(Ok(response)) if response.get("error").is_none() => response,
            _ => {
                self.relay.cancel_rpc(&rpc_id).await;
                return finish_unknown(permit, &command_id, "config_response_unknown").await;
            }
        };
        let Some(raw_options) = response
            .get("result")
            .and_then(serde_json::Value::as_object)
            .and_then(|result| result.get("configOptions"))
            .and_then(serde_json::Value::as_array)
        else {
            return finish_unknown(permit, &command_id, "config_response_missing_catalog").await;
        };
        let Ok(AgentConfigSnapshot {
            model,
            effort,
            options,
        }) = normalize_agent_config(raw_options)
        else {
            return finish_unknown(permit, &command_id, "config_response_invalid_catalog").await;
        };
        if !catalog_has_current_value(&options, &payload.config_id, &payload.value) {
            return finish_unknown(permit, &command_id, "config_response_value_mismatch").await;
        }
        if !matches!(
            self.doc
                .submit_command(
                    &payload.chat_id,
                    DocCommand::SetAgentConfig {
                        model,
                        effort,
                        config_options: Some(options.clone()),
                    },
                )
                .await,
            SubmitResult::Applied(_)
        ) {
            return finish_unknown(permit, &command_id, "config_projection_failed").await;
        }
        self.chats
            .set_config_catalog(&payload.chat_id, options)
            .await;
        if permit.commit().await.is_err() {
            return delivery_unknown(&command_id);
        }
        acknowledged(&command_id, AckStatus::Committed)
    }

    async fn validate_target(
        &self,
        command_id: &str,
        payload: &ConfigSetPayload,
    ) -> Result<Target, ActionError> {
        let Some(record) = self.chats.entry(&payload.chat_id).await else {
            return Err(error(
                command_id,
                ErrorCode::ChatNotFound,
                "chat not found",
                false,
            ));
        };
        let Some(session_id) = record.session_id else {
            return Err(error(
                command_id,
                ErrorCode::InvalidState,
                "chat has no active ACP session",
                false,
            ));
        };
        if record.state.is_terminal() {
            return Err(error(
                command_id,
                ErrorCode::InvalidState,
                "chat runtime is terminal",
                false,
            ));
        }
        if self.chats.active_turn(&payload.chat_id).await.is_some() {
            return Err(error(
                command_id,
                ErrorCode::InvalidState,
                "session config cannot change while Agent is running",
                false,
            ));
        }
        let Some(catalog) = self.chats.config_catalog(&payload.chat_id).await else {
            return Err(error(
                command_id,
                ErrorCode::UnsupportedFrame,
                "Agent did not advertise session config options",
                false,
            ));
        };
        if !catalog_selects(&catalog, &payload.config_id, &payload.value) {
            return Err(error(
                command_id,
                ErrorCode::InvalidState,
                "config option or value is not in the current Agent catalog",
                false,
            ));
        }
        Ok(Target {
            instance_id: record.instance_id,
            session_id,
        })
    }
}

pub(super) fn validate_identifier(value: &str) -> Result<(), &'static str> {
    if value.is_empty() || value.len() > 128 {
        return Err("config identifiers must be 1..128 bytes");
    }
    Ok(())
}

pub(super) fn catalog_selects(
    options: &[peri_studio_proto::schema::SessionConfigOptionProjection],
    config_id: &str,
    value: &str,
) -> bool {
    options.iter().any(|option| {
        option.id == config_id && option.options.iter().any(|choice| choice.value == value)
    })
}

pub(super) fn catalog_has_current_value(
    options: &[peri_studio_proto::schema::SessionConfigOptionProjection],
    config_id: &str,
    value: &str,
) -> bool {
    options.iter().any(|option| {
        option.id == config_id
            && option.current_value == value
            && option.options.iter().any(|choice| choice.value == value)
    })
}

fn prepare_error(command_id: &str, failure: RuntimeCommandLedgerError) -> ActionError {
    match failure {
        RuntimeCommandLedgerError::Metadata(MetadataError::Conflict(_)) => error(
            command_id,
            ErrorCode::InvalidState,
            "commandId reused with a different config payload",
            false,
        ),
        _ => error(
            command_id,
            ErrorCode::AgentUnavailable,
            "session config command ledger is unavailable",
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
            error_code
                .as_deref()
                .unwrap_or("session config command was not delivered"),
            false,
        )),
        RuntimeCommandTerminal::DeliveryUnknown { error_code } => {
            let _ = error_code;
            delivery_unknown(command_id)
        }
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
        "session config delivery is unknown; do not retry with a new command",
        false,
    ))
}

fn ledger_unavailable(command_id: &str) -> Frame {
    Frame::ActionError(error(
        command_id,
        ErrorCode::AgentUnavailable,
        "session config command ledger is unavailable",
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

fn error(command_id: &str, code: ErrorCode, message: &str, retryable: bool) -> ActionError {
    ActionError {
        command_id: command_id.to_string(),
        code,
        message: message.to_string(),
        retryable,
        retry_after_ms: None,
    }
}

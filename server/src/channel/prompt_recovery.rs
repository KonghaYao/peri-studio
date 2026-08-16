//! Conservative prompt-delivery recovery across catalog provenance, per-chat
//! outboxes, and persisted Chat/Session projections.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use peri_studio_proto::conn::DocId;
use peri_studio_proto::session::{PromptDeliveryStatus, PromptStatusItem};
use thiserror::Error;
use uuid::Uuid;
use yrs::updates::decoder::Decode as _;
use yrs::{Map as _, ReadTxn as _, Transact as _};

use crate::control::{ProjectService, StoreSink};
use crate::persist::metadata::SessionRuntimeRecord;
use crate::persist::outbox::{CommandType, OutboxRecord, OutboxStatus};
use crate::persist::Store;

const STATUS_LIMIT: usize = 200;

#[derive(Debug, Error)]
pub(super) enum PromptRecoveryError {
    #[error("session not found")]
    SessionNotFound,
    #[error("session runtime history unavailable")]
    RuntimeHistoryUnavailable,
    #[error("history sink unavailable during prompt reconciliation")]
    HistorySinkUnavailable,
    #[error("prompt recovery store failure: {0}")]
    Store(String),
}

#[derive(Debug)]
pub(super) struct PromptRecoveryReport {
    pub session_id: String,
    pub truncated: bool,
    pub evidence_incomplete: bool,
    pub prompts: Vec<PromptStatusItem>,
}

#[derive(Clone)]
pub(super) struct PromptRecovery {
    store: Arc<Store>,
    projects: ProjectService,
    sink: Option<Arc<StoreSink>>,
}

pub(super) struct PreparedPromptStatus {
    store: Arc<Store>,
    sink: Option<Arc<StoreSink>>,
    session_id: String,
    runtimes: Vec<SessionRuntimeRecord>,
}

#[cfg(test)]
#[path = "prompt_recovery_test.rs"]
mod prompt_recovery_test;

impl PromptRecovery {
    pub fn new(store: Arc<Store>, projects: ProjectService, sink: Option<Arc<StoreSink>>) -> Self {
        Self {
            store,
            projects,
            sink,
        }
    }

    /// Resolve authorization/provenance before the coordinator returns
    /// `accepted`, preserving the existing synchronous failure boundary.
    pub async fn prepare_status(
        &self,
        logical_session_id: &str,
    ) -> Result<PreparedPromptStatus, PromptRecoveryError> {
        let Some(session) = self
            .projects
            .metadata()
            .session(logical_session_id)
            .await
            .ok()
            .flatten()
            .filter(|session| session.origin != "legacy_hidden")
        else {
            return Err(PromptRecoveryError::SessionNotFound);
        };
        let runtimes = self
            .projects
            .metadata()
            .session_runtimes(&session.id)
            .await
            .map_err(|_| PromptRecoveryError::RuntimeHistoryUnavailable)?;
        Ok(PreparedPromptStatus {
            store: self.store.clone(),
            sink: self.sink.clone(),
            session_id: session.id,
            runtimes,
        })
    }

    /// Reconcile both durable stores before Gateway accepts clients.
    pub async fn reconcile_after_restart(&self) -> Result<(), PromptRecoveryError> {
        let Some(sink) = self.sink.as_ref() else {
            return Err(PromptRecoveryError::HistorySinkUnavailable);
        };
        for (chat_id, store) in self.store.chats_snapshot() {
            let chat_id_text = chat_id.to_string();
            let evidence = projection_evidence(
                sink.snapshot(&DocId::chat(&chat_id_text)).await,
                sink.snapshot(&DocId::session(&chat_id_text)).await,
            )
            .map(|(evidence, _)| evidence)
            .unwrap_or_default();
            let records = store
                .outbox()
                .lock()
                .await
                .records()
                .filter(|record| record.command_type == CommandType::Prompt)
                .cloned()
                .collect::<Vec<_>>();
            let exact_terminal = records
                .iter()
                .filter_map(|record| {
                    let projected = evidence.get(&record.command_id)?;
                    exact_terminal_evidence(record, projected).then_some(record.command_id)
                })
                .collect::<HashSet<_>>();
            store
                .outbox()
                .lock()
                .await
                .reconcile_prompt_delivery_after_restart(&exact_terminal)
                .map_err(|error| PromptRecoveryError::Store(error.to_string()))?;

            let reconciled = store
                .outbox()
                .lock()
                .await
                .records()
                .filter(|record| record.command_type == CommandType::Prompt)
                .cloned()
                .collect::<Vec<_>>();
            let known = reconciled
                .iter()
                .map(|record| record.command_id)
                .collect::<HashSet<_>>();
            for record in reconciled {
                let Some(turn_id) = record.turn_id else {
                    continue;
                };
                let (state, code) = match record.status {
                    OutboxStatus::Completed => ("completed", None),
                    OutboxStatus::Failed => (
                        "failed_not_delivered",
                        record.last_error.as_ref().map(|error| error.code.as_str()),
                    ),
                    OutboxStatus::DeliveryUnknown => ("delivery_unknown", Some("DELIVERY_UNKNOWN")),
                    _ => continue,
                };
                sink.reconcile_prompt_entry_delivery(
                    &chat_id_text,
                    &format!("{turn_id}:user"),
                    state,
                    code,
                )
                .await
                .map_err(|error| PromptRecoveryError::Store(error.to_string()))?;
            }
            for (command_id, projected) in evidence {
                if known.contains(&command_id) || !is_pending_orphan(&projected) {
                    continue;
                }
                let Some(entry_id) = projected.entry_id else {
                    continue;
                };
                sink.reconcile_prompt_entry_delivery(
                    &chat_id_text,
                    &entry_id,
                    "failed_not_delivered",
                    Some("AGENT_UNAVAILABLE"),
                )
                .await
                .map_err(|error| PromptRecoveryError::Store(error.to_string()))?;
            }
        }
        Ok(())
    }
}

impl PreparedPromptStatus {
    pub async fn execute(self) -> PromptRecoveryReport {
        let mut prompts_by_command = HashMap::<String, PromptStatusItem>::new();
        let mut evidence_incomplete = self.sink.is_none();
        for runtime in self.runtimes {
            let Ok(chat_id) = Uuid::parse_str(&runtime.chat_id) else {
                evidence_incomplete = true;
                continue;
            };
            let Some(chat_store) = self.store.chat(chat_id) else {
                evidence_incomplete = true;
                continue;
            };
            let evidence = if let Some(sink) = &self.sink {
                match projection_evidence(
                    sink.snapshot(&DocId::chat(&runtime.chat_id)).await,
                    sink.snapshot(&DocId::session(&runtime.chat_id)).await,
                ) {
                    Some((evidence, complete)) => {
                        evidence_incomplete |= !complete;
                        evidence
                    }
                    None => {
                        evidence_incomplete = true;
                        HashMap::new()
                    }
                }
            } else {
                HashMap::new()
            };
            for record in chat_store.outbox_records().await {
                if record.command_type != CommandType::Prompt {
                    continue;
                }
                let projection = evidence.get(&record.command_id);
                let item = normalize_status(record, projection);
                match prompts_by_command.entry(item.command_id.clone()) {
                    std::collections::hash_map::Entry::Vacant(entry) => {
                        entry.insert(item);
                    }
                    std::collections::hash_map::Entry::Occupied(mut entry) => {
                        evidence_incomplete = true;
                        merge_conflict(entry.get_mut(), item);
                    }
                }
            }
        }
        let mut prompts = prompts_by_command.into_values().collect::<Vec<_>>();
        prompts.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        let truncated = prompts.len() > STATUS_LIMIT;
        if truncated {
            let mut unresolved = prompts
                .iter()
                .filter(|item| {
                    matches!(
                        item.status,
                        PromptDeliveryStatus::DeliveryUnknown | PromptDeliveryStatus::Projected
                    )
                })
                .take(STATUS_LIMIT)
                .cloned()
                .collect::<Vec<_>>();
            let unresolved_ids = unresolved
                .iter()
                .map(|item| item.command_id.clone())
                .collect::<HashSet<_>>();
            let remaining = STATUS_LIMIT.saturating_sub(unresolved.len());
            unresolved.extend(
                prompts
                    .into_iter()
                    .filter(|item| !unresolved_ids.contains(&item.command_id))
                    .take(remaining),
            );
            prompts = unresolved;
        }
        PromptRecoveryReport {
            session_id: self.session_id,
            truncated,
            evidence_incomplete,
            prompts,
        }
    }
}

#[derive(Debug, Clone, Default)]
struct PromptProjectionEvidence {
    projected: bool,
    terminal: bool,
    entry_id: Option<String>,
    turn_id: Option<Uuid>,
    delivery_schema_version: Option<i64>,
    delivery_state: Option<String>,
    payload_fingerprint: Option<String>,
    conflicted: bool,
}

fn exact_terminal_evidence(record: &OutboxRecord, projected: &PromptProjectionEvidence) -> bool {
    projected.projected
        && !projected.conflicted
        && projected.terminal
        && projected.delivery_schema_version == Some(2)
        && projected.turn_id == record.turn_id
        && projected.payload_fingerprint.is_some()
        && projected.payload_fingerprint.as_deref() == record.payload_fingerprint.as_deref()
}

fn is_pending_orphan(projected: &PromptProjectionEvidence) -> bool {
    projected.delivery_schema_version == Some(2)
        && !projected.conflicted
        && projected.payload_fingerprint.is_some()
        && projected.delivery_state.as_deref() == Some("pending")
}

fn projection_evidence(
    chat_snapshot: Option<(Vec<u8>, u32)>,
    session_snapshot: Option<(Vec<u8>, u32)>,
) -> Option<(HashMap<Uuid, PromptProjectionEvidence>, bool)> {
    let mut evidence = HashMap::<Uuid, PromptProjectionEvidence>::new();
    let (chat_update, _) = chat_snapshot?;
    let chat = yrs::Doc::new();
    chat.transact_mut()
        .apply_update(yrs::Update::decode_v1(&chat_update).ok()?)
        .ok()?;
    let txn = chat.transact();
    let root = txn.get_map(crate::state::factory::ROOT)?;
    let entries = root
        .get(&txn, "entries")
        .and_then(|value| value.cast::<yrs::MapRef>().ok())?;
    let mut turns = HashMap::<String, Uuid>::new();
    let mut terminal_turns = HashSet::<String>::new();
    for (entry_id, value) in entries.iter(&txn) {
        let Ok(entry) = value.cast::<yrs::MapRef>() else {
            continue;
        };
        let role = entry
            .get(&txn, "role")
            .and_then(|value| value.cast::<String>().ok());
        let turn_id = entry
            .get(&txn, "turn_id")
            .and_then(|value| value.cast::<String>().ok());
        if role.as_deref() == Some("assistant") {
            let status = entry
                .get(&txn, "status")
                .and_then(|value| value.cast::<String>().ok());
            if status
                .as_deref()
                .is_some_and(|status| matches!(status, "completed" | "error" | "cancelled"))
            {
                if let Some(turn_id) = turn_id {
                    terminal_turns.insert(turn_id);
                }
            }
            continue;
        }
        if role.as_deref() != Some("user") {
            continue;
        }
        let Some(command_id) = entry
            .get(&txn, "source_command_id")
            .and_then(|value| value.cast::<String>().ok())
            .and_then(|value| Uuid::parse_str(&value).ok())
        else {
            continue;
        };
        let candidate_entry_id = entry_id.to_string();
        let candidate_turn_id = turn_id
            .as_deref()
            .and_then(|value| Uuid::parse_str(value).ok());
        let candidate_schema = entry
            .get(&txn, "delivery_schema_version")
            .and_then(|value| value.cast::<i64>().ok());
        let candidate_state = entry
            .get(&txn, "delivery_state")
            .and_then(|value| value.cast::<String>().ok());
        let candidate_fingerprint = entry
            .get(&txn, "payload_fingerprint")
            .and_then(|value| value.cast::<String>().ok());
        let item = evidence.entry(command_id).or_default();
        if item.projected
            && (item.entry_id.as_deref() != Some(candidate_entry_id.as_str())
                || item.turn_id != candidate_turn_id
                || item.payload_fingerprint != candidate_fingerprint)
        {
            item.conflicted = true;
        }
        item.projected = true;
        item.entry_id = Some(candidate_entry_id);
        item.turn_id = candidate_turn_id;
        item.delivery_schema_version = candidate_schema;
        item.delivery_state = candidate_state;
        item.payload_fingerprint = candidate_fingerprint;
        if let Some(turn_id) = turn_id {
            turns.insert(turn_id, command_id);
        }
    }
    for turn in terminal_turns {
        if let Some(command_id) = turns.get(&turn).copied() {
            evidence.entry(command_id).or_default().terminal = true;
        }
    }
    drop(txn);

    let mut complete = session_snapshot.is_some();
    if let Some((session_update, _)) = session_snapshot {
        let session = yrs::Doc::new();
        if let Ok(update) = yrs::Update::decode_v1(&session_update) {
            if session.transact_mut().apply_update(update).is_ok() {
                let txn = session.transact();
                if let Some(map) = txn
                    .get_map(crate::state::factory::ROOT)
                    .and_then(|root| root.get(&txn, "session"))
                    .and_then(|value| value.cast::<yrs::MapRef>().ok())
                {
                    let turn_id = map
                        .get(&txn, "active_turn_id")
                        .and_then(|value| value.cast::<String>().ok());
                    let status = map
                        .get(&txn, "active_turn_status")
                        .and_then(|value| value.cast::<String>().ok());
                    if status.as_deref().is_some_and(|status| {
                        matches!(status, "completed" | "failed" | "cancelled" | "interrupted")
                    }) {
                        if let Some(command_id) = turn_id.and_then(|turn| turns.get(&turn).copied())
                        {
                            evidence.entry(command_id).or_default().terminal = true;
                        }
                    }
                } else {
                    complete = false;
                }
            } else {
                complete = false;
            }
        } else {
            complete = false;
        }
    }
    Some((evidence, complete))
}

fn normalize_status(
    record: OutboxRecord,
    projection: Option<&PromptProjectionEvidence>,
) -> PromptStatusItem {
    let projection = projection.cloned().unwrap_or_default();
    let status = match record.status {
        OutboxStatus::DeliveryUnknown => PromptDeliveryStatus::DeliveryUnknown,
        OutboxStatus::Completed if projection.projected && projection.terminal => {
            PromptDeliveryStatus::Completed
        }
        OutboxStatus::Failed => PromptDeliveryStatus::Failed,
        _ if projection.projected => PromptDeliveryStatus::Projected,
        _ => PromptDeliveryStatus::DeliveryUnknown,
    };
    PromptStatusItem {
        command_id: record.command_id.to_string(),
        turn_id: record.turn_id.map(|turn| turn.to_string()),
        status,
        created_at: record.created_at.to_rfc3339(),
        updated_at: record.updated_at.to_rfc3339(),
        error_code: matches!(
            status,
            PromptDeliveryStatus::Failed | PromptDeliveryStatus::DeliveryUnknown
        )
        .then(|| record.last_error.map(|error| error.code))
        .flatten(),
    }
}

fn merge_conflict(existing: &mut PromptStatusItem, conflicting: PromptStatusItem) {
    existing.status = PromptDeliveryStatus::DeliveryUnknown;
    existing.error_code = None;
    if existing.turn_id != conflicting.turn_id {
        existing.turn_id = None;
    }
    if conflicting.created_at < existing.created_at {
        existing.created_at = conflicting.created_at;
    }
    if conflicting.updated_at > existing.updated_at {
        existing.updated_at = conflicting.updated_at;
    }
}

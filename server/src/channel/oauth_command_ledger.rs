//! Durable, body-free command outcomes for MCP OAuth mutations.
//!
//! This module owns the single-executor gate and SQLite phase interpretation.
//! It never accepts an authorization URL, provider response, callback value, or
//! raw error; callers provide only a canonical one-way payload fingerprint.

use std::collections::HashMap;
use std::sync::{Arc, Weak};

use thiserror::Error;
use tokio::sync::{Mutex, OwnedMutexGuard, RwLock};

use crate::persist::metadata::{
    BeginOAuthCommand, MetadataError, MetadataStore, OAuthCommandRecord,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct OAuthCommandIdentity {
    pub command_id: String,
    pub command_type: &'static str,
    pub chat_id: String,
    pub payload_fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum OAuthTerminal {
    Committed,
    Rejected { error_code: Option<String> },
    FailedNotDelivered { error_code: Option<String> },
    DeliveryUnknown { error_code: Option<String> },
}

pub(super) enum OAuthClaim {
    Execute(OAuthExecutionPermit),
    Terminal(OAuthTerminal),
}

#[derive(Debug, Error)]
pub(super) enum OAuthLedgerError {
    #[error("OAuth command ledger is unavailable")]
    Unavailable,
    #[error(transparent)]
    Metadata(#[from] MetadataError),
}

#[derive(Clone, Default)]
pub(super) struct OAuthCommandLedger {
    metadata: Arc<RwLock<Option<Arc<MetadataStore>>>>,
    gates: Arc<Mutex<HashMap<String, Weak<Mutex<()>>>>>,
}

impl OAuthCommandLedger {
    pub async fn install(&self, metadata: Arc<MetadataStore>) {
        *self.metadata.write().await = Some(metadata);
    }

    /// Returns true only when this exact durable identity already exists. A
    /// mismatch is an error, never a reason to inspect or overwrite the row.
    pub async fn exists(&self, identity: &OAuthCommandIdentity) -> Result<bool, OAuthLedgerError> {
        let metadata = self.metadata().await?;
        let Some(record) = metadata.oauth_command(&identity.command_id).await? else {
            return Ok(false);
        };
        verify_identity(&record, identity)?;
        Ok(true)
    }

    pub async fn reserve(
        &self,
        identity: &OAuthCommandIdentity,
    ) -> Result<BeginOAuthCommand, OAuthLedgerError> {
        Ok(self
            .metadata()
            .await?
            .begin_oauth_command(
                &identity.command_id,
                identity.command_type,
                &identity.chat_id,
                &identity.payload_fingerprint,
            )
            .await?)
    }

    /// Acquires the process-local single-executor lease, then re-reads SQLite.
    /// A waiter therefore observes the first owner's terminal transition and
    /// never executes the ACP mutation a second time.
    pub async fn claim(
        &self,
        identity: OAuthCommandIdentity,
    ) -> Result<OAuthClaim, OAuthLedgerError> {
        let gate = self.gate(&identity.command_id).await;
        let guard = gate.lock_owned().await;
        let metadata = self.metadata().await?;
        let record = metadata
            .oauth_command(&identity.command_id)
            .await?
            .ok_or_else(|| MetadataError::NotFound(identity.command_id.clone()))?;
        verify_identity(&record, &identity)?;
        match record.phase.as_str() {
            "intent_durable" => Ok(OAuthClaim::Execute(OAuthExecutionPermit {
                metadata,
                identity,
                _guard: guard,
                dispatching: false,
            })),
            "dispatching" => {
                metadata
                    .transition_oauth_command(
                        &record.command_id,
                        "dispatching",
                        "delivery_unknown",
                        Some("executor_ended_after_dispatch"),
                    )
                    .await?;
                Ok(OAuthClaim::Terminal(OAuthTerminal::DeliveryUnknown {
                    error_code: Some("executor_ended_after_dispatch".into()),
                }))
            }
            _ => Ok(OAuthClaim::Terminal(terminal_from_record(&record)?)),
        }
    }

    async fn metadata(&self) -> Result<Arc<MetadataStore>, OAuthLedgerError> {
        self.metadata
            .read()
            .await
            .clone()
            .ok_or(OAuthLedgerError::Unavailable)
    }

    async fn gate(&self, command_id: &str) -> Arc<Mutex<()>> {
        let mut gates = self.gates.lock().await;
        gates.retain(|_, gate| gate.strong_count() > 0);
        if let Some(gate) = gates.get(command_id).and_then(Weak::upgrade) {
            return gate;
        }
        let gate = Arc::new(Mutex::new(()));
        gates.insert(command_id.to_string(), Arc::downgrade(&gate));
        gate
    }
}

pub(super) struct OAuthExecutionPermit {
    metadata: Arc<MetadataStore>,
    identity: OAuthCommandIdentity,
    _guard: OwnedMutexGuard<()>,
    dispatching: bool,
}

impl OAuthExecutionPermit {
    /// Crosses the no-redelivery barrier. The ACP request must not be written
    /// unless this durable compare-and-set succeeds.
    pub async fn mark_dispatching(&mut self) -> Result<(), OAuthLedgerError> {
        self.metadata
            .transition_oauth_command(
                &self.identity.command_id,
                "intent_durable",
                "dispatching",
                None,
            )
            .await?;
        self.dispatching = true;
        Ok(())
    }

    pub async fn commit(self) -> Result<(), OAuthLedgerError> {
        self.finish_after_dispatch("committed", None).await
    }

    pub async fn reject(self, error_code: &str) -> Result<(), OAuthLedgerError> {
        self.finish_after_dispatch("rejected", Some(error_code))
            .await
    }

    pub async fn delivery_unknown(self, error_code: &str) -> Result<(), OAuthLedgerError> {
        self.finish_after_dispatch("delivery_unknown", Some(error_code))
            .await
    }

    pub async fn fail_not_delivered(self, error_code: &str) -> Result<(), OAuthLedgerError> {
        if self.dispatching {
            return Err(MetadataError::InvalidState(
                "cannot mark a dispatching OAuth command undelivered".into(),
            )
            .into());
        }
        self.metadata
            .transition_oauth_command(
                &self.identity.command_id,
                "intent_durable",
                "failed_not_delivered",
                Some(error_code),
            )
            .await?;
        Ok(())
    }

    async fn finish_after_dispatch(
        self,
        phase: &str,
        error_code: Option<&str>,
    ) -> Result<(), OAuthLedgerError> {
        if !self.dispatching {
            return Err(MetadataError::InvalidState(
                "OAuth command did not cross the dispatch barrier".into(),
            )
            .into());
        }
        self.metadata
            .transition_oauth_command(&self.identity.command_id, "dispatching", phase, error_code)
            .await?;
        Ok(())
    }
}

fn verify_identity(
    record: &OAuthCommandRecord,
    identity: &OAuthCommandIdentity,
) -> Result<(), MetadataError> {
    if record.command_type != identity.command_type
        || record.chat_id != identity.chat_id
        || record.payload_fingerprint != identity.payload_fingerprint
    {
        return Err(MetadataError::Conflict(format!(
            "OAuth command {} identity mismatch",
            identity.command_id
        )));
    }
    Ok(())
}

fn terminal_from_record(record: &OAuthCommandRecord) -> Result<OAuthTerminal, MetadataError> {
    let error_code = record.error_code.clone();
    match record.phase.as_str() {
        "committed" => Ok(OAuthTerminal::Committed),
        "rejected" => Ok(OAuthTerminal::Rejected { error_code }),
        "failed_not_delivered" => Ok(OAuthTerminal::FailedNotDelivered { error_code }),
        "delivery_unknown" => Ok(OAuthTerminal::DeliveryUnknown { error_code }),
        phase => Err(MetadataError::InvalidState(format!(
            "unknown OAuth command phase {phase}"
        ))),
    }
}

#[cfg(test)]
#[path = "oauth_command_ledger_test.rs"]
mod oauth_command_ledger_test;

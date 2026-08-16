//! Durable single-executor ledger for body-free runtime mutations.

use std::collections::HashMap;
use std::sync::{Arc, Weak};

use thiserror::Error;
use tokio::sync::{Mutex, OwnedMutexGuard, RwLock};

use crate::persist::metadata::{BeginCommand, MetadataCommand, MetadataError, MetadataStore};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct RuntimeCommandIdentity {
    pub command_id: String,
    pub command_type: &'static str,
    pub chat_id: String,
    pub payload_fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum RuntimeCommandTerminal {
    Committed,
    Rejected { error_code: Option<String> },
    FailedNotDelivered { error_code: Option<String> },
    DeliveryUnknown { error_code: Option<String> },
}

pub(super) enum RuntimeCommandClaim {
    Execute(RuntimeCommandPermit),
    Terminal(RuntimeCommandTerminal),
}

#[derive(Debug, Error)]
pub(super) enum RuntimeCommandLedgerError {
    #[error("runtime command ledger is unavailable")]
    Unavailable,
    #[error(transparent)]
    Metadata(#[from] MetadataError),
}

#[derive(Clone, Default)]
pub(super) struct RuntimeCommandLedger {
    metadata: Arc<RwLock<Option<Arc<MetadataStore>>>>,
    gates: Arc<Mutex<HashMap<String, Weak<Mutex<()>>>>>,
}

impl RuntimeCommandLedger {
    pub async fn install(&self, metadata: Arc<MetadataStore>) {
        *self.metadata.write().await = Some(metadata);
    }

    pub async fn exists(
        &self,
        identity: &RuntimeCommandIdentity,
    ) -> Result<bool, RuntimeCommandLedgerError> {
        let Some(record) = self.metadata().await?.command(&identity.command_id).await? else {
            return Ok(false);
        };
        verify_identity(&record, identity)?;
        Ok(true)
    }

    pub async fn reserve(
        &self,
        identity: &RuntimeCommandIdentity,
    ) -> Result<BeginCommand, RuntimeCommandLedgerError> {
        Ok(self
            .metadata()
            .await?
            .begin_runtime_command(
                &identity.command_id,
                identity.command_type,
                &identity.payload_fingerprint,
                &identity.chat_id,
            )
            .await?)
    }

    pub async fn claim(
        &self,
        identity: RuntimeCommandIdentity,
    ) -> Result<RuntimeCommandClaim, RuntimeCommandLedgerError> {
        let gate = self.gate(&identity.command_id).await;
        let guard = gate.lock_owned().await;
        let metadata = self.metadata().await?;
        let record = metadata
            .command(&identity.command_id)
            .await?
            .ok_or_else(|| MetadataError::NotFound(identity.command_id.clone()))?;
        verify_identity(&record, &identity)?;
        match record.phase.as_str() {
            "intention_durable" => Ok(RuntimeCommandClaim::Execute(RuntimeCommandPermit {
                metadata,
                identity,
                _guard: guard,
                dispatching: false,
                effect_confirmed: false,
            })),
            "dispatching" => {
                metadata
                    .transition_runtime_command(
                        &record.command_id,
                        &record.command_type,
                        "dispatching",
                        "delivery_unknown",
                        Some("executor_ended_after_dispatch"),
                    )
                    .await?;
                Ok(RuntimeCommandClaim::Terminal(
                    RuntimeCommandTerminal::DeliveryUnknown {
                        error_code: Some("executor_ended_after_dispatch".into()),
                    },
                ))
            }
            "effect_confirmed" => {
                metadata
                    .transition_runtime_command(
                        &record.command_id,
                        &record.command_type,
                        "effect_confirmed",
                        "delivery_unknown",
                        Some("effect_confirmed_projection_incomplete"),
                    )
                    .await?;
                Ok(RuntimeCommandClaim::Terminal(
                    RuntimeCommandTerminal::DeliveryUnknown {
                        error_code: Some("effect_confirmed_projection_incomplete".into()),
                    },
                ))
            }
            _ => Ok(RuntimeCommandClaim::Terminal(terminal_from_record(
                &record,
            )?)),
        }
    }

    async fn metadata(&self) -> Result<Arc<MetadataStore>, RuntimeCommandLedgerError> {
        self.metadata
            .read()
            .await
            .clone()
            .ok_or(RuntimeCommandLedgerError::Unavailable)
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

pub(super) struct RuntimeCommandPermit {
    metadata: Arc<MetadataStore>,
    identity: RuntimeCommandIdentity,
    _guard: OwnedMutexGuard<()>,
    dispatching: bool,
    effect_confirmed: bool,
}

impl RuntimeCommandPermit {
    pub async fn mark_dispatching(&mut self) -> Result<(), RuntimeCommandLedgerError> {
        self.metadata
            .transition_runtime_command(
                &self.identity.command_id,
                self.identity.command_type,
                "intention_durable",
                "dispatching",
                None,
            )
            .await?;
        self.dispatching = true;
        Ok(())
    }

    pub async fn commit(self) -> Result<(), RuntimeCommandLedgerError> {
        self.finish_after_dispatch("committed", None).await
    }

    pub async fn mark_effect_confirmed(&mut self) -> Result<(), RuntimeCommandLedgerError> {
        if !self.dispatching || self.effect_confirmed {
            return Err(MetadataError::InvalidState(
                "runtime command is not awaiting effect confirmation".into(),
            )
            .into());
        }
        self.metadata
            .transition_runtime_command(
                &self.identity.command_id,
                self.identity.command_type,
                "dispatching",
                "effect_confirmed",
                None,
            )
            .await?;
        self.effect_confirmed = true;
        Ok(())
    }

    pub async fn commit_after_effect(self) -> Result<(), RuntimeCommandLedgerError> {
        if !self.effect_confirmed {
            return Err(MetadataError::InvalidState(
                "runtime command effect is not confirmed".into(),
            )
            .into());
        }
        self.finish_after_dispatch("committed", None).await
    }

    pub async fn delivery_unknown(self, error_code: &str) -> Result<(), RuntimeCommandLedgerError> {
        self.finish_after_dispatch("delivery_unknown", Some(error_code))
            .await
    }

    pub async fn fail_not_delivered(
        self,
        error_code: &str,
    ) -> Result<(), RuntimeCommandLedgerError> {
        if self.dispatching {
            return Err(MetadataError::InvalidState(
                "cannot mark a dispatching runtime command undelivered".into(),
            )
            .into());
        }
        self.metadata
            .transition_runtime_command(
                &self.identity.command_id,
                self.identity.command_type,
                "intention_durable",
                "failed",
                Some(error_code),
            )
            .await?;
        Ok(())
    }

    async fn finish_after_dispatch(
        self,
        phase: &str,
        error_code: Option<&str>,
    ) -> Result<(), RuntimeCommandLedgerError> {
        if !self.dispatching {
            return Err(MetadataError::InvalidState(
                "runtime command did not cross the dispatch barrier".into(),
            )
            .into());
        }
        let expected_phase = if self.effect_confirmed {
            "effect_confirmed"
        } else {
            "dispatching"
        };
        self.metadata
            .transition_runtime_command(
                &self.identity.command_id,
                self.identity.command_type,
                expected_phase,
                phase,
                error_code,
            )
            .await?;
        Ok(())
    }
}

fn verify_identity(
    record: &MetadataCommand,
    identity: &RuntimeCommandIdentity,
) -> Result<(), MetadataError> {
    if record.command_type != identity.command_type
        || record.chat_id.as_deref() != Some(identity.chat_id.as_str())
        || record.payload_hash != identity.payload_fingerprint
    {
        return Err(MetadataError::Conflict(format!(
            "runtime command {} identity mismatch",
            identity.command_id
        )));
    }
    Ok(())
}

fn terminal_from_record(record: &MetadataCommand) -> Result<RuntimeCommandTerminal, MetadataError> {
    let error_code = record.error_code.clone();
    match record.phase.as_str() {
        "committed" => Ok(RuntimeCommandTerminal::Committed),
        "rejected" => Ok(RuntimeCommandTerminal::Rejected { error_code }),
        "failed" => Ok(RuntimeCommandTerminal::FailedNotDelivered { error_code }),
        "delivery_unknown" | "reconciliation_required" => {
            Ok(RuntimeCommandTerminal::DeliveryUnknown { error_code })
        }
        phase => Err(MetadataError::InvalidState(format!(
            "unknown runtime command phase {phase}"
        ))),
    }
}

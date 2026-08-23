//! Server 重启后的 instance 恢复深模块。
//!
//! 唯一顺序：authoritative heartbeat → alive 对账 → confirmed runtime resume
//! → per-instance barrier → Healthy/Degraded。hello 不携带 alive_sessions，不能
//! 触发此流程；Gateway 只负责把 HeartbeatOutcome 适配到这里。

use std::collections::HashSet;
use std::sync::Arc;

use tokio::sync::Mutex;
use tracing::{info, warn};

use crate::channel::CommandCoordinator;
use crate::control::InstanceRegistry;
use crate::state::registry::{DegradeCause, RegistryState};

#[derive(Default)]
struct RecoveryState {
    pending: HashSet<String>,
    in_flight: HashSet<String>,
}

#[derive(Clone)]
pub(super) struct RecoveryCoordinator {
    state: Arc<Mutex<RecoveryState>>,
    instance: Arc<InstanceRegistry>,
    coordinator: Arc<CommandCoordinator>,
    registry: RegistryState,
}

impl RecoveryCoordinator {
    pub(super) fn new(
        pending: HashSet<String>,
        instance: Arc<InstanceRegistry>,
        coordinator: Arc<CommandCoordinator>,
        registry: RegistryState,
    ) -> Self {
        Self {
            state: Arc::new(Mutex::new(RecoveryState {
                pending,
                in_flight: HashSet::new(),
            })),
            instance,
            coordinator,
            registry,
        }
    }

    /// 消费一份 authoritative heartbeat。变化快照始终执行对账；只有启动时
    /// pending instance 的首份快照拥有 resume/barrier 完成权。
    pub(super) async fn on_heartbeat_snapshot(
        &self,
        instance_id: &str,
        alive: Vec<String>,
        first_snapshot: bool,
        changed: bool,
    ) {
        if !changed {
            return;
        }
        if let Err(error) = self
            .instance
            .reconcile_authoritative_alive(instance_id, &alive)
            .await
        {
            warn!(
                instance_id,
                ?error,
                "authoritative alive reconciliation failed"
            );
            self.fail_instance(instance_id).await;
            return;
        }
        if !first_snapshot || !self.claim_pending(instance_id).await {
            return;
        }

        let summary = self
            .coordinator
            .resume_instance_chats_and_wait(instance_id)
            .await;
        if summary.failed > 0 {
            warn!(
                instance_id,
                launched = summary.launched,
                failed = summary.failed,
                "live chat recovery incomplete"
            );
            self.fail_instance(instance_id).await;
        } else {
            info!(
                instance_id,
                resumed = summary.launched,
                "instance recovery barrier completed"
            );
            self.complete_instance(instance_id).await;
        }
    }

    async fn claim_pending(&self, instance_id: &str) -> bool {
        let mut state = self.state.lock().await;
        state.pending.contains(instance_id) && state.in_flight.insert(instance_id.to_string())
    }

    async fn fail_instance(&self, instance_id: &str) {
        if let Err(error) = self
            .registry
            .report_condition(DegradeCause::RestoreInvariant)
            .await
        {
            warn!(instance_id, ?error, "restore degradation report failed");
        }
        self.complete_instance(instance_id).await;
    }

    async fn complete_instance(&self, instance_id: &str) {
        let complete = {
            let mut state = self.state.lock().await;
            state.in_flight.remove(instance_id);
            state.pending.remove(instance_id);
            state.pending.is_empty()
        };
        if complete {
            if let Err(error) = self.registry.clear_restarting().await {
                warn!(?error, "recovery barrier could not clear restarting");
                let _ = self
                    .registry
                    .report_condition(DegradeCause::RestoreInvariant)
                    .await;
            }
        }
    }
}

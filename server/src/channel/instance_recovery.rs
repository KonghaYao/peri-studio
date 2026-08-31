//! Server 重启后的 instance 恢复深模块。
//!
//! 唯一顺序：authoritative heartbeat → alive 对账 → confirmed runtime resume
//! → per-instance barrier → Healthy/Degraded。hello 不携带 alive_sessions，不能
//! 触发此流程；Gateway 只负责按连接 epoch 提交 HeartbeatOutcome。

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use tokio::sync::Mutex;
#[cfg(test)]
use tokio::sync::Semaphore;
use tracing::{info, warn};

use crate::channel::{CommandCoordinator, ConnId};
use crate::control::InstanceRegistry;
use crate::state::registry::{DegradeCause, RegistryState};

#[derive(Debug)]
struct HeartbeatSnapshot {
    connection_id: ConnId,
    sequence: u64,
    alive: Vec<String>,
}

#[derive(Debug, Default)]
struct RecoveryLane {
    connection_id: ConnId,
    next_sequence: u64,
    latest: Option<HeartbeatSnapshot>,
    worker_running: bool,
    recovery_required: bool,
}

#[derive(Default)]
struct RecoveryState {
    pending: HashSet<String>,
    in_flight: HashMap<String, ConnId>,
    lanes: HashMap<String, RecoveryLane>,
    #[cfg(test)]
    pause_next_reconcile: Option<Arc<RecoveryPause>>,
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
                ..RecoveryState::default()
            })),
            instance,
            coordinator,
            registry,
        }
    }

    /// hello 完成 fencing 后登记新的连接 epoch。尚未处理的旧快照立即失效；
    /// 已在执行的旧快照会在每个副作用边界重新校验 epoch，不能完成恢复门禁。
    pub(super) async fn on_connection_registered(&self, instance_id: &str, connection_id: ConnId) {
        let mut state = self.state.lock().await;
        let lane = state.lanes.entry(instance_id.to_string()).or_default();
        if lane.connection_id == connection_id {
            return;
        }
        lane.connection_id = connection_id;
        lane.next_sequence = 0;
        lane.latest = None;
        lane.recovery_required = false;
        state.in_flight.remove(instance_id);
    }

    /// 提交 authoritative heartbeat。Gateway 帧循环只等待这段内存入队；每个
    /// instance 仅有一个后台 worker，未开始对账的快照按 latest-wins 合并。
    pub(super) async fn on_heartbeat_snapshot(
        &self,
        instance_id: &str,
        connection_id: ConnId,
        alive: Vec<String>,
        first_snapshot: bool,
        changed: bool,
    ) {
        if !changed {
            return;
        }
        let start_worker = {
            let mut state = self.state.lock().await;
            let Some(lane) = state.lanes.get_mut(instance_id) else {
                return;
            };
            if lane.connection_id != connection_id {
                return;
            }
            lane.next_sequence += 1;
            lane.latest = Some(HeartbeatSnapshot {
                connection_id,
                sequence: lane.next_sequence,
                alive,
            });
            lane.recovery_required |= first_snapshot;
            if lane.worker_running {
                false
            } else {
                lane.worker_running = true;
                true
            }
        };
        if start_worker {
            let worker = self.clone();
            let instance_id = instance_id.to_string();
            tokio::spawn(async move { worker.drain_instance(instance_id).await });
        }
    }

    async fn drain_instance(&self, instance_id: String) {
        loop {
            let snapshot = {
                let mut state = self.state.lock().await;
                let Some(lane) = state.lanes.get_mut(&instance_id) else {
                    return;
                };
                match lane.latest.take() {
                    Some(snapshot) => snapshot,
                    None => {
                        lane.worker_running = false;
                        return;
                    }
                }
            };
            self.pause_before_reconcile_for_test().await;
            if !self.is_current_latest(&instance_id, &snapshot).await {
                continue;
            }
            if let Err(error) = self
                .instance
                .reconcile_authoritative_alive(&instance_id, &snapshot.alive)
                .await
            {
                if self.is_current_latest(&instance_id, &snapshot).await {
                    warn!(
                        instance_id,
                        ?error,
                        "authoritative alive reconciliation failed"
                    );
                    self.fail_instance(&instance_id, snapshot.connection_id)
                        .await;
                }
                continue;
            }
            // 对账期间若收到更新快照，先让最新事实覆盖本次结果，再决定 resume。
            if !self.is_current_latest(&instance_id, &snapshot).await {
                continue;
            }
            if !self
                .claim_pending(&instance_id, snapshot.connection_id)
                .await
            {
                continue;
            }

            let summary = self
                .coordinator
                .resume_instance_chats_and_wait(&instance_id)
                .await;
            if !self
                .is_current_connection(&instance_id, snapshot.connection_id)
                .await
            {
                continue;
            }
            if summary.failed > 0 {
                warn!(
                    instance_id,
                    launched = summary.launched,
                    failed = summary.failed,
                    "live chat recovery incomplete"
                );
                self.fail_instance(&instance_id, snapshot.connection_id)
                    .await;
            } else {
                info!(
                    instance_id,
                    resumed = summary.launched,
                    "instance recovery barrier completed"
                );
                self.complete_instance(&instance_id, snapshot.connection_id)
                    .await;
            }
        }
    }

    async fn is_current_latest(&self, instance_id: &str, snapshot: &HeartbeatSnapshot) -> bool {
        let state = self.state.lock().await;
        state.lanes.get(instance_id).is_some_and(|lane| {
            lane.connection_id == snapshot.connection_id
                && lane
                    .latest
                    .as_ref()
                    .is_none_or(|latest| latest.sequence <= snapshot.sequence)
        })
    }

    async fn is_current_connection(&self, instance_id: &str, connection_id: ConnId) -> bool {
        self.state
            .lock()
            .await
            .lanes
            .get(instance_id)
            .is_some_and(|lane| lane.connection_id == connection_id)
    }

    async fn claim_pending(&self, instance_id: &str, connection_id: ConnId) -> bool {
        let mut state = self.state.lock().await;
        let recovery_required = state
            .lanes
            .get(instance_id)
            .is_some_and(|lane| lane.connection_id == connection_id && lane.recovery_required);
        recovery_required
            && state.pending.contains(instance_id)
            && state
                .in_flight
                .insert(instance_id.to_string(), connection_id)
                .is_none()
    }

    async fn fail_instance(&self, instance_id: &str, connection_id: ConnId) {
        if !self.is_current_connection(instance_id, connection_id).await {
            return;
        }
        if let Err(error) = self
            .registry
            .report_condition(DegradeCause::RestoreInvariant)
            .await
        {
            warn!(instance_id, ?error, "restore degradation report failed");
        }
        self.complete_instance(instance_id, connection_id).await;
    }

    async fn complete_instance(&self, instance_id: &str, connection_id: ConnId) {
        let complete = {
            let mut state = self.state.lock().await;
            let current = state
                .lanes
                .get(instance_id)
                .is_some_and(|lane| lane.connection_id == connection_id);
            if !current || state.in_flight.get(instance_id) != Some(&connection_id) {
                return;
            }
            state.in_flight.remove(instance_id);
            state.pending.remove(instance_id);
            if let Some(lane) = state.lanes.get_mut(instance_id) {
                lane.recovery_required = false;
            }
            state.pending.is_empty()
        };
        if complete {
            if let Err(error) = self.registry.clear_restarting().await {
                warn!(?error, "recovery barrier could not clear restarting");
                let _ = self
                    .registry
                    .report_condition(DegradeCause::RestoreInvariant)
                    .await;
            } else {
                self.coordinator.on_recovery_barrier_cleared().await;
            }
        }
    }

    #[cfg(test)]
    pub(super) async fn pause_next_reconcile(&self) -> Arc<RecoveryPause> {
        let pause = Arc::new(RecoveryPause::default());
        self.state.lock().await.pause_next_reconcile = Some(pause.clone());
        pause
    }

    #[cfg(test)]
    async fn pause_before_reconcile_for_test(&self) {
        let pause = self.state.lock().await.pause_next_reconcile.take();
        if let Some(pause) = pause {
            pause.blocked.add_permits(1);
            let permit = pause.release.acquire().await.expect("测试门禁保持存活");
            permit.forget();
        }
    }

    #[cfg(not(test))]
    async fn pause_before_reconcile_for_test(&self) {}
}

#[cfg(test)]
pub(super) struct RecoveryPause {
    blocked: Semaphore,
    release: Semaphore,
}

#[cfg(test)]
impl Default for RecoveryPause {
    fn default() -> Self {
        Self {
            blocked: Semaphore::new(0),
            release: Semaphore::new(0),
        }
    }
}

#[cfg(test)]
impl RecoveryPause {
    pub(super) async fn wait_until_blocked(&self) {
        let permit = self.blocked.acquire().await.expect("测试门禁保持存活");
        permit.forget();
    }

    pub(super) fn release(&self) {
        self.release.add_permits(1);
    }
}

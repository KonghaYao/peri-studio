//! SQLite `machines` 权威、Registry 投影与 SSH 供应管道编排（§6；server 禁止 spawn ssh）。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use peri_studio_proto::schema::MachineSummary;
use thiserror::Error;
use tokio::sync::{mpsc, Mutex};

use crate::persist::machine_phases::{
    connect_entry_phase, is_in_progress, is_terminal_failure, PHASE_AWAITING_HOST_KEY,
    PHASE_AWAITING_REPLACE, PHASE_CONNECTING, PHASE_FAILED, PHASE_OFFLINE, PHASE_ONLINE,
    PHASE_PENDING,
};
use crate::persist::metadata::{
    new_ssh_instance_id, AdmitSshMachineParams, MachineRecord, MetadataError, MetadataStore,
};
use crate::state::registry::{RegistryError, RegistryState};

use super::chat_registry::ChatRegistry;
use super::instance_registry::{InstanceRegistry, InstanceState};
use super::machine_pipeline::{
    CancelResult, MachinePipelinePort, PipelineError, PipelineEvent, PipelineSpec, PipelineStep,
    StopResult,
};

#[derive(Debug, Error)]
pub enum MachineServiceError {
    #[error(transparent)]
    Metadata(#[from] MetadataError),
    #[error(transparent)]
    Registry(#[from] RegistryError),
    #[error(transparent)]
    Pipeline(#[from] PipelineError),
    #[error("SSH machine pipeline is not configured")]
    PipelineUnavailable,
    #[error("machine {0} not found")]
    NotFound(String),
    #[error("invalid machine state: {0}")]
    InvalidState(String),
}

/// `machine/stop` 与 `machine/cancel` 的交付分类（§6.2 / §10）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MachineDeliveryOutcome {
    Committed,
    DeliveryUnknown,
}

/// `machine/add` 准入参数。
pub struct AdmitAddParams<'a> {
    pub destination: &'a str,
    pub port: Option<i64>,
    pub identity_file: Option<&'a str>,
    pub display_name: &'a str,
}

#[derive(Clone)]
pub struct MachineService {
    metadata: Arc<MetadataStore>,
    registry: RegistryState,
    pipeline: Option<Arc<dyn MachinePipelinePort>>,
    instances: Option<Arc<InstanceRegistry>>,
    chats: Option<Arc<ChatRegistry>>,
    auth: Option<Arc<Mutex<crate::auth::AuthService>>>,
    listen_port: u16,
    data_dir: PathBuf,
    current_exe: PathBuf,
    active_generations: Arc<Mutex<HashMap<String, u64>>>,
}

impl MachineService {
    pub fn new(metadata: Arc<MetadataStore>, registry: RegistryState) -> Self {
        Self {
            metadata,
            registry,
            pipeline: None,
            instances: None,
            chats: None,
            auth: None,
            listen_port: 8456,
            data_dir: PathBuf::new(),
            current_exe: std::env::current_exe().unwrap_or_default(),
            active_generations: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn with_pipeline(mut self, pipeline: Arc<dyn MachinePipelinePort>) -> Self {
        self.pipeline = Some(pipeline);
        self
    }

    pub fn with_runtime_paths(
        mut self,
        listen_port: u16,
        data_dir: PathBuf,
        current_exe: PathBuf,
    ) -> Self {
        self.listen_port = listen_port;
        self.data_dir = data_dir;
        self.current_exe = current_exe;
        self
    }

    /// 注入 instance/chat 注册表与 token 吊销能力（Remove fail-closed 门禁）。
    pub fn with_instance_chats(
        mut self,
        instances: Arc<InstanceRegistry>,
        chats: Arc<ChatRegistry>,
        auth: Arc<Mutex<crate::auth::AuthService>>,
    ) -> Self {
        self.instances = Some(instances);
        self.chats = Some(chats);
        self.auth = Some(auth);
        self
    }

    pub fn metadata(&self) -> &Arc<MetadataStore> {
        &self.metadata
    }

    pub fn has_pipeline(&self) -> bool {
        self.pipeline.is_some()
    }

    pub async fn bootstrap(&self) -> Result<(), MachineServiceError> {
        self.metadata.ensure_local_machine().await?;
        self.metadata.fail_in_progress_machines_on_restart().await?;
        self.reproject().await?;
        Ok(())
    }

    pub async fn reproject(&self) -> Result<(), MachineServiceError> {
        let machines = self.metadata.list_machines().await?;
        let summaries = machines.into_iter().map(machine_summary).collect();
        self.registry.replace_machines(summaries).await?;
        Ok(())
    }

    /// admit 新 SSH 机器并启动完整供应管道（`machine/add`）。
    pub async fn admit_and_start_add(
        &self,
        params: AdmitAddParams<'_>,
    ) -> Result<String, MachineServiceError> {
        let pipeline = self.require_pipeline()?;
        let instance_id = new_ssh_instance_id();
        let record = self
            .metadata
            .admit_ssh_machine(AdmitSshMachineParams {
                instance_id: &instance_id,
                destination: params.destination,
                port: params.port,
                identity_file: params.identity_file,
                display_name: params.display_name,
            })
            .await?;
        self.reproject().await?;
        self.spawn_pipeline(pipeline, &record, None).await?;
        Ok(instance_id)
    }

    /// 从 tunnel 步骤重建隧道（`machine/connect` 与自动重连）。
    pub async fn connect(&self, instance_id: &str) -> Result<(), MachineServiceError> {
        let pipeline = self.require_pipeline()?;
        let record = self.require_ssh_machine(instance_id).await?;
        if is_in_progress(&record.phase) {
            return Err(MachineServiceError::InvalidState(
                "machine pipeline already in progress".into(),
            ));
        }
        if record.phase != PHASE_OFFLINE && !is_terminal_failure(&record.phase) {
            return Err(MachineServiceError::InvalidState(format!(
                "machine cannot connect from phase {}",
                record.phase
            )));
        }
        let generation = self.metadata.bump_pipeline_generation(instance_id).await? as u64;
        let record = self
            .metadata
            .machine(instance_id)
            .await?
            .ok_or_else(|| MachineServiceError::NotFound(instance_id.into()))?;
        self.metadata
            .update_machine_phase(instance_id, connect_entry_phase(), None)
            .await?;
        self.reproject().await?;
        self.spawn_pipeline(pipeline, &record, Some(PipelineStep::Tunnel))
            .await?;
        self.active_generations
            .lock()
            .await
            .insert(instance_id.to_string(), generation);
        Ok(())
    }

    /// 只拆本机 `ssh -R` 隧道（`machine/disconnect`）。
    pub async fn disconnect_tunnel(&self, instance_id: &str) -> Result<(), MachineServiceError> {
        let pipeline = self.require_pipeline()?;
        self.require_ssh_machine(instance_id).await?;
        pipeline.teardown_tunnel(instance_id).await?;
        self.metadata.clear_remote_forward_port(instance_id).await?;
        self.metadata
            .update_machine_phase(instance_id, PHASE_OFFLINE, None)
            .await?;
        self.active_generations.lock().await.remove(instance_id);
        self.reproject().await?;
        Ok(())
    }

    /// 经 ssh exec 关闭远端 connect 与 ACP（`machine/stop`）。
    pub async fn stop_agents(
        &self,
        instance_id: &str,
    ) -> Result<MachineDeliveryOutcome, MachineServiceError> {
        let pipeline = self.require_pipeline()?;
        self.require_ssh_machine(instance_id).await?;
        match pipeline.stop_remote(instance_id).await? {
            StopResult::Committed => {
                let _ = pipeline.teardown_tunnel(instance_id).await;
                self.metadata.clear_remote_forward_port(instance_id).await?;
                self.metadata
                    .update_machine_phase(instance_id, PHASE_OFFLINE, None)
                    .await?;
                self.active_generations.lock().await.remove(instance_id);
                self.reproject().await?;
                Ok(MachineDeliveryOutcome::Committed)
            }
            StopResult::DeliveryUnknown => Ok(MachineDeliveryOutcome::DeliveryUnknown),
        }
    }

    /// 取消进行中的管道（`machine/cancel`）。
    pub async fn cancel_pipeline(
        &self,
        instance_id: &str,
    ) -> Result<MachineDeliveryOutcome, MachineServiceError> {
        let pipeline = self.require_pipeline()?;
        let record = self.require_ssh_machine(instance_id).await?;
        if !is_in_progress(&record.phase) {
            return Err(MachineServiceError::InvalidState(
                "machine is not in an active pipeline".into(),
            ));
        }
        let generation = record.pipeline_generation as u64;
        match pipeline.cancel(instance_id, generation).await? {
            CancelResult::Committed => {
                self.metadata
                    .update_machine_phase(instance_id, PHASE_FAILED, Some("canceled"))
                    .await?;
                self.active_generations.lock().await.remove(instance_id);
                self.reproject().await?;
                Ok(MachineDeliveryOutcome::Committed)
            }
            CancelResult::DeliveryUnknown => {
                self.metadata
                    .update_machine_phase(
                        instance_id,
                        PHASE_FAILED,
                        Some("connect_delivery_unknown"),
                    )
                    .await?;
                self.active_generations.lock().await.remove(instance_id);
                self.reproject().await?;
                Ok(MachineDeliveryOutcome::DeliveryUnknown)
            }
        }
    }

    /// 失败终态后重试（`machine/retry`）；须使用新 commandId。
    pub async fn retry(&self, instance_id: &str) -> Result<(), MachineServiceError> {
        let pipeline = self.require_pipeline()?;
        let record = self.require_ssh_machine(instance_id).await?;
        if !is_terminal_failure(&record.phase) {
            return Err(MachineServiceError::InvalidState(
                "machine is not in a failed state".into(),
            ));
        }
        let from_step = if record.error_code.as_deref() == Some("server_restarted") {
            Some(PipelineStep::Tunnel)
        } else {
            Some(PipelineStep::HostKeyProbe)
        };
        let generation = self.metadata.bump_pipeline_generation(instance_id).await? as u64;
        let record = self
            .metadata
            .machine(instance_id)
            .await?
            .ok_or_else(|| MachineServiceError::NotFound(instance_id.into()))?;
        self.metadata
            .update_machine_phase(instance_id, PHASE_PENDING, None)
            .await?;
        self.reproject().await?;
        self.spawn_pipeline(pipeline, &record, from_step).await?;
        self.active_generations
            .lock()
            .await
            .insert(instance_id.to_string(), generation);
        Ok(())
    }

    /// Trust host key 并续跑管道（`machine/trust-host`）。
    pub async fn trust_host(
        &self,
        instance_id: &str,
        fingerprint: &str,
    ) -> Result<(), MachineServiceError> {
        let pipeline = self.require_pipeline()?;
        let record = self.require_ssh_machine(instance_id).await?;
        if record.phase != PHASE_AWAITING_HOST_KEY {
            return Err(MachineServiceError::InvalidState(
                "machine is not awaiting host key trust".into(),
            ));
        }
        let line = record.pending_host_key_line.clone().ok_or_else(|| {
            MachineServiceError::InvalidState("pending host key line missing".into())
        })?;
        pipeline.append_known_hosts_line(instance_id, &line).await?;
        self.metadata
            .trust_host_key(instance_id, fingerprint)
            .await?;
        self.reproject().await?;
        self.spawn_pipeline(pipeline, &record, Some(PipelineStep::SshConnect))
            .await?;
        Ok(())
    }

    /// 确认替换远端已有 peri-studio 二进制并续跑 install（`machine/confirm-replace`）。
    pub async fn confirm_replace(&self, instance_id: &str) -> Result<(), MachineServiceError> {
        let pipeline = self.require_pipeline()?;
        let record = self.require_ssh_machine(instance_id).await?;
        if record.phase != PHASE_AWAITING_REPLACE {
            return Err(MachineServiceError::InvalidState(
                "machine is not awaiting binary replace confirmation".into(),
            ));
        }
        self.spawn_pipeline_with_replace(pipeline, &record, PipelineStep::Install, true)
            .await?;
        Ok(())
    }

    pub async fn rename(
        &self,
        instance_id: &str,
        display_name: &str,
    ) -> Result<(), MachineServiceError> {
        self.require_machine(instance_id).await?;
        self.metadata
            .rename_machine(instance_id, display_name)
            .await?;
        self.reproject().await?;
        Ok(())
    }

    pub async fn set_auto_reconnect(
        &self,
        instance_id: &str,
        enabled: bool,
    ) -> Result<(), MachineServiceError> {
        self.require_ssh_machine(instance_id).await?;
        self.metadata
            .set_auto_reconnect(instance_id, enabled)
            .await?;
        self.reproject().await?;
        Ok(())
    }

    /// 归档机器（`machine/remove`；§9 C / §10 fail-closed）。
    pub async fn remove(&self, instance_id: &str) -> Result<(), MachineServiceError> {
        let record = self.require_ssh_machine(instance_id).await?;
        if record.phase != PHASE_OFFLINE && !is_terminal_failure(&record.phase) {
            return Err(MachineServiceError::InvalidState(
                "stop agents on this computer before removing it from Peri".into(),
            ));
        }
        if let Some(instances) = &self.instances {
            if matches!(
                instances.state(instance_id).await,
                Some(InstanceState::Registered) | Some(InstanceState::Online)
            ) {
                return Err(MachineServiceError::InvalidState(
                    "stop agents on this computer before removing it from Peri".into(),
                ));
            }
        }
        if let Some(chats) = &self.chats {
            let live = chats.chats_for_instance(instance_id).await;
            if live.iter().any(|(_, state)| !state.is_terminal()) {
                return Err(MachineServiceError::InvalidState(
                    "stop agents on this computer before removing it from Peri".into(),
                ));
            }
        }
        self.metadata.archive_machine(instance_id).await?;
        if let Some(auth) = &self.auth {
            if let Err(error) = auth
                .lock()
                .await
                .store_mut()
                .revoke_instance_token(instance_id)
            {
                tracing::warn!(
                    instance_id = %instance_id,
                    ?error,
                    "instance token revoke failed during machine remove"
                );
            }
        }
        self.reproject().await?;
        Ok(())
    }

    /// 恢复墓碑并重启 probe 管道（`machine/restore`）。
    pub async fn restore(&self, instance_id: &str) -> Result<(), MachineServiceError> {
        let pipeline = self.require_pipeline()?;
        let record = self.metadata.restore_machine(instance_id).await?;
        self.reproject().await?;
        self.spawn_pipeline(pipeline, &record, Some(PipelineStep::Probe))
            .await?;
        Ok(())
    }

    /// app 管道事件入口：按步骤边界更新 phase 并投影。
    pub async fn on_pipeline_event(
        &self,
        instance_id: &str,
        generation: u64,
        event: PipelineEvent,
    ) -> Result<(), MachineServiceError> {
        let Some(record) = self.metadata.machine(instance_id).await? else {
            return Ok(());
        };
        if record.pipeline_generation as u64 != generation {
            return Ok(());
        }
        match event {
            PipelineEvent::StepComplete(step) => {
                let phase = step.as_phase();
                self.metadata
                    .update_machine_phase(instance_id, phase, None)
                    .await?;
                if phase == PHASE_ONLINE {
                    self.active_generations.lock().await.remove(instance_id);
                }
                self.reproject().await?;
            }
            PipelineEvent::StepFailed { error_code, .. } => {
                self.metadata
                    .update_machine_phase(instance_id, PHASE_FAILED, Some(&error_code))
                    .await?;
                self.active_generations.lock().await.remove(instance_id);
                self.reproject().await?;
            }
            PipelineEvent::AwaitingTrust {
                fingerprint,
                known_hosts_line,
            } => {
                self.metadata
                    .set_pending_host_key(instance_id, &fingerprint, &known_hosts_line)
                    .await?;
                self.reproject().await?;
            }
            PipelineEvent::AwaitingReplace => {
                self.metadata
                    .update_machine_phase(instance_id, PHASE_AWAITING_REPLACE, None)
                    .await?;
                self.reproject().await?;
            }
            PipelineEvent::TunnelReady { port } => {
                self.metadata
                    .set_remote_forward_port(instance_id, i64::from(port))
                    .await?;
            }
            PipelineEvent::OwnerFingerprint(fingerprint) => {
                self.metadata
                    .set_remote_owner_fingerprint(instance_id, &fingerprint)
                    .await?;
            }
        }
        Ok(())
    }

    /// instance hello 到达时收敛为 online（§6.1 step 8）。
    pub async fn on_instance_hello(&self, instance_id: &str) -> Result<(), MachineServiceError> {
        let Some(record) = self.metadata.machine(instance_id).await? else {
            return Ok(());
        };
        if record.kind != "ssh" {
            return Ok(());
        }
        if record.phase == PHASE_CONNECTING || is_in_progress(&record.phase) {
            self.metadata
                .update_machine_phase(instance_id, PHASE_ONLINE, None)
                .await?;
            self.active_generations.lock().await.remove(instance_id);
            self.reproject().await?;
        }
        if let Some(pipeline) = &self.pipeline {
            pipeline.notify_instance_hello(instance_id).await;
        }
        Ok(())
    }

    /// Healthy 之后对 auto_reconnect 候选发起连接（§2.1 A）。
    pub async fn schedule_auto_reconnect(&self) {
        if self.pipeline.is_none() {
            return;
        }
        let Ok(candidates) = self.metadata.list_auto_reconnect_candidates().await else {
            return;
        };
        for machine in candidates {
            if let Err(error) = self.connect(&machine.instance_id).await {
                tracing::warn!(
                    instance_id = %machine.instance_id,
                    ?error,
                    "auto-reconnect connect failed"
                );
            }
        }
    }

    fn require_pipeline(&self) -> Result<Arc<dyn MachinePipelinePort>, MachineServiceError> {
        self.pipeline
            .clone()
            .ok_or(MachineServiceError::PipelineUnavailable)
    }

    async fn require_machine(
        &self,
        instance_id: &str,
    ) -> Result<MachineRecord, MachineServiceError> {
        self.metadata
            .machine(instance_id)
            .await?
            .filter(|m| m.archived_at.is_none())
            .ok_or_else(|| MachineServiceError::NotFound(instance_id.into()))
    }

    async fn require_ssh_machine(
        &self,
        instance_id: &str,
    ) -> Result<MachineRecord, MachineServiceError> {
        let record = self.require_machine(instance_id).await?;
        if record.kind != "ssh" {
            return Err(MachineServiceError::InvalidState(
                "operation not allowed on local machine".into(),
            ));
        }
        Ok(record)
    }

    async fn spawn_pipeline(
        &self,
        pipeline: Arc<dyn MachinePipelinePort>,
        record: &MachineRecord,
        from_step: Option<PipelineStep>,
    ) -> Result<(), MachineServiceError> {
        self.run_pipeline(pipeline, record, from_step, false).await
    }

    async fn spawn_pipeline_with_replace(
        &self,
        pipeline: Arc<dyn MachinePipelinePort>,
        record: &MachineRecord,
        from_step: PipelineStep,
        replace_confirmed: bool,
    ) -> Result<(), MachineServiceError> {
        self.run_pipeline(pipeline, record, Some(from_step), replace_confirmed)
            .await
    }

    async fn run_pipeline(
        &self,
        pipeline: Arc<dyn MachinePipelinePort>,
        record: &MachineRecord,
        from_step: Option<PipelineStep>,
        replace_confirmed: bool,
    ) -> Result<(), MachineServiceError> {
        let generation = record.pipeline_generation as u64;
        let spec = self.pipeline_spec(record, replace_confirmed)?;
        let (event_tx, mut event_rx) = mpsc::channel(32);
        let service = self.clone();
        let instance_id = record.instance_id.clone();
        tokio::spawn(async move {
            while let Some(event) = event_rx.recv().await {
                if let Err(error) = service
                    .on_pipeline_event(&instance_id, generation, event)
                    .await
                {
                    tracing::warn!(
                        instance_id = %instance_id,
                        ?error,
                        "machine pipeline event handling failed"
                    );
                }
            }
        });
        if let Some(step) = from_step {
            pipeline
                .resume_pipeline(spec, step, generation, event_tx)
                .await?;
        } else {
            pipeline.start_pipeline(spec, generation, event_tx).await?;
        }
        self.active_generations
            .lock()
            .await
            .insert(record.instance_id.clone(), generation);
        Ok(())
    }

    fn pipeline_spec(
        &self,
        record: &MachineRecord,
        replace_confirmed: bool,
    ) -> Result<PipelineSpec, MachineServiceError> {
        let ssh_destination = record
            .ssh_destination
            .clone()
            .ok_or_else(|| MachineServiceError::InvalidState("ssh destination missing".into()))?;
        Ok(PipelineSpec {
            instance_id: record.instance_id.clone(),
            ssh_destination,
            ssh_port: record.ssh_port,
            identity_file: record.identity_file.clone(),
            host_key_sha256: record.host_key_sha256.clone(),
            pending_host_key_line: record.pending_host_key_line.clone(),
            remote_forward_port: record.remote_forward_port,
            listen_port: self.listen_port,
            data_dir: self.data_dir.clone(),
            current_exe: self.current_exe.clone(),
            replace_confirmed,
        })
    }
}

fn machine_summary(m: MachineRecord) -> MachineSummary {
    MachineSummary {
        instance_id: m.instance_id,
        kind: m.kind,
        display_name: m.display_name,
        ssh_destination: m.ssh_destination,
        ssh_port: m.ssh_port.map(|p| p as u32),
        phase: m.phase,
        error_code: m.error_code,
        has_identity_file: m.identity_file.is_some(),
        auto_reconnect: m.auto_reconnect,
        host_key_sha256: m.host_key_sha256,
        updated_at: m.updated_at,
        archived_at: m.archived_at,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use tempfile::tempdir;

    use super::*;
    use crate::control::fake_machine_pipeline::FakeMachinePipeline;
    use crate::control::StoreSink;
    use crate::persist::metadata::MetadataStore;
    use crate::state::doc_manager::{BatchConfig, DocManager};

    #[tokio::test]
    async fn bootstrap_inserts_local_machine_and_projects_registry() {
        let dir = tempdir().unwrap();
        let sink = Arc::new(StoreSink::new());
        let doc = DocManager::new(BatchConfig::default(), sink);
        let metadata = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
        let service = MachineService::new(metadata.clone(), doc.registry());
        service.bootstrap().await.unwrap();
        let rows = metadata.list_machines().await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].instance_id, "local");
        assert_eq!(rows[0].kind, "local");
    }

    #[tokio::test]
    async fn admit_and_start_add_records_pipeline_invocation() {
        let dir = tempdir().unwrap();
        let sink = Arc::new(StoreSink::new());
        let doc = DocManager::new(BatchConfig::default(), sink);
        let metadata = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
        let pipeline = Arc::new(FakeMachinePipeline::default());
        let service = MachineService::new(metadata.clone(), doc.registry())
            .with_pipeline(pipeline.clone())
            .with_runtime_paths(
                8456,
                dir.path().to_path_buf(),
                std::env::current_exe().unwrap(),
            );
        service.bootstrap().await.unwrap();
        let instance_id = service
            .admit_and_start_add(AdmitAddParams {
                destination: "user@gpu.example",
                port: Some(22),
                identity_file: None,
                display_name: "GPU box",
            })
            .await
            .unwrap();
        assert!(instance_id.starts_with("ssh_"));
        let invocations = pipeline.take_invocations();
        assert_eq!(invocations.len(), 1);
        assert_eq!(invocations[0].spec.instance_id, instance_id);
        assert!(invocations[0].from_step.is_none());
    }

    #[tokio::test]
    async fn add_without_pipeline_returns_unavailable() {
        let dir = tempdir().unwrap();
        let sink = Arc::new(StoreSink::new());
        let doc = DocManager::new(BatchConfig::default(), sink);
        let metadata = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
        let service = MachineService::new(metadata, doc.registry());
        assert!(matches!(
            service
                .admit_and_start_add(AdmitAddParams {
                    destination: "user@host",
                    port: None,
                    identity_file: None,
                    display_name: "host",
                })
                .await,
            Err(MachineServiceError::PipelineUnavailable)
        ));
    }
}

//! app 侧 `MachinePipelinePort` 适配器；将 server 元数据命令委托给 `SshBackend`。

use async_trait::async_trait;
use peri_studio_server::control::{
    CancelResult, MachinePipelinePort, PipelineError, PipelineEvent, PipelineSpec, PipelineStep,
    StopResult,
};
use tokio::sync::mpsc;

use crate::ssh_backend::{SshBackend, SshBackendConfig};

/// 把 `SshBackend` 暴露为 server 可注入的供应管道端口（R2 接线）。
pub struct AppMachinePipelinePort {
    backend: SshBackend,
}

impl AppMachinePipelinePort {
    pub fn new(config: SshBackendConfig) -> Self {
        Self {
            backend: SshBackend::new(config),
        }
    }
}

#[async_trait]
impl MachinePipelinePort for AppMachinePipelinePort {
    async fn start_pipeline(
        &self,
        spec: PipelineSpec,
        generation: u64,
        events: mpsc::Sender<PipelineEvent>,
    ) -> Result<(), PipelineError> {
        tracing::info!(
            instance_id = %spec.instance_id,
            generation,
            "machine pipeline start accepted"
        );
        self.backend
            .spawn_pipeline(spec, generation, PipelineStep::HostKeyProbe, events)
            .await
    }

    async fn resume_pipeline(
        &self,
        spec: PipelineSpec,
        from_step: PipelineStep,
        generation: u64,
        events: mpsc::Sender<PipelineEvent>,
    ) -> Result<(), PipelineError> {
        tracing::info!(
            instance_id = %spec.instance_id,
            ?from_step,
            generation,
            "machine pipeline resume accepted"
        );
        self.backend
            .spawn_pipeline(spec, generation, from_step, events)
            .await
    }

    async fn teardown_tunnel(&self, instance_id: &str) -> Result<(), PipelineError> {
        tracing::debug!(instance_id, "machine pipeline teardown tunnel");
        self.backend
            .disconnect_tunnel(instance_id)
            .await
            .map_err(PipelineError::Backend)
    }

    async fn stop_remote(&self, instance_id: &str) -> Result<StopResult, PipelineError> {
        tracing::debug!(instance_id, "machine pipeline stop remote");
        self.backend
            .stop_remote_agents(instance_id)
            .await
            .map_err(PipelineError::Backend)?;
        Ok(StopResult::Committed)
    }

    async fn cancel(
        &self,
        instance_id: &str,
        generation: u64,
    ) -> Result<CancelResult, PipelineError> {
        tracing::debug!(instance_id, generation, "machine pipeline cancel");
        self.backend.cancel_pipeline(instance_id, generation).await
    }

    async fn append_known_hosts_line(
        &self,
        instance_id: &str,
        line: &str,
    ) -> Result<(), PipelineError> {
        self.backend
            .append_known_hosts_line(instance_id, line)
            .await
            .map_err(PipelineError::Backend)
    }

    async fn notify_instance_hello(&self, instance_id: &str) {
        self.backend.notify_instance_hello(instance_id).await;
    }
}

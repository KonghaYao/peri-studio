//! 测试用 `MachinePipelinePort`：记录调用、可注入合成事件，不 spawn OpenSSH。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use tokio::sync::mpsc;

use super::machine_pipeline::{
    CancelResult, MachinePipelinePort, PipelineError, PipelineEvent, PipelineSpec, PipelineStep,
    StopResult,
};

#[derive(Debug, Clone)]
pub struct PipelineInvocation {
    pub spec: PipelineSpec,
    pub generation: u64,
    pub from_step: Option<PipelineStep>,
}

#[derive(Default)]
struct FakeMachinePipelineInner {
    invocations: Vec<PipelineInvocation>,
    torn_down: Vec<String>,
    stopped: Vec<String>,
    canceled: Vec<(String, u64)>,
}

/// 记录管道调用并在测试中手动推送事件的 fake backend。
#[derive(Clone, Default)]
pub struct FakeMachinePipeline {
    inner: Arc<Mutex<FakeMachinePipelineInner>>,
}

impl FakeMachinePipeline {
    pub fn take_invocations(&self) -> Vec<PipelineInvocation> {
        std::mem::take(&mut self.inner.lock().unwrap().invocations)
    }

    pub fn last_spec(&self) -> Option<PipelineSpec> {
        self.inner
            .lock()
            .unwrap()
            .invocations
            .last()
            .map(|inv| inv.spec.clone())
    }

    pub fn torn_down_instances(&self) -> Vec<String> {
        self.inner.lock().unwrap().torn_down.clone()
    }

    pub fn stopped_instances(&self) -> Vec<String> {
        self.inner.lock().unwrap().stopped.clone()
    }

    pub fn canceled_generations(&self) -> Vec<(String, u64)> {
        self.inner.lock().unwrap().canceled.clone()
    }

    /// 测试辅助：向最近一次 `start_pipeline` / `resume_pipeline` 的事件通道发送一步。
    pub async fn emit_to_last(
        &self,
        events: &mut HashMap<String, mpsc::Sender<PipelineEvent>>,
        instance_id: &str,
        event: PipelineEvent,
    ) {
        if let Some(tx) = events.remove(instance_id) {
            let _ = tx.send(event).await;
        }
    }
}

#[async_trait]
impl MachinePipelinePort for FakeMachinePipeline {
    async fn start_pipeline(
        &self,
        spec: PipelineSpec,
        generation: u64,
        _events: mpsc::Sender<PipelineEvent>,
    ) -> Result<(), PipelineError> {
        self.inner
            .lock()
            .unwrap()
            .invocations
            .push(PipelineInvocation {
                spec,
                generation,
                from_step: None,
            });
        Ok(())
    }

    async fn resume_pipeline(
        &self,
        spec: PipelineSpec,
        from_step: PipelineStep,
        generation: u64,
        _events: mpsc::Sender<PipelineEvent>,
    ) -> Result<(), PipelineError> {
        self.inner
            .lock()
            .unwrap()
            .invocations
            .push(PipelineInvocation {
                spec,
                generation,
                from_step: Some(from_step),
            });
        Ok(())
    }

    async fn teardown_tunnel(&self, instance_id: &str) -> Result<(), PipelineError> {
        self.inner
            .lock()
            .unwrap()
            .torn_down
            .push(instance_id.to_string());
        Ok(())
    }

    async fn stop_remote(&self, instance_id: &str) -> Result<StopResult, PipelineError> {
        self.inner
            .lock()
            .unwrap()
            .stopped
            .push(instance_id.to_string());
        Ok(StopResult::Committed)
    }

    async fn cancel(
        &self,
        instance_id: &str,
        generation: u64,
    ) -> Result<CancelResult, PipelineError> {
        self.inner
            .lock()
            .unwrap()
            .canceled
            .push((instance_id.to_string(), generation));
        Ok(CancelResult::Committed)
    }

    async fn append_known_hosts_line(
        &self,
        _instance_id: &str,
        _line: &str,
    ) -> Result<(), PipelineError> {
        Ok(())
    }

    async fn notify_instance_hello(&self, _instance_id: &str) {}
}

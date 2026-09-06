//! SSH 供应管道端口：server 定义契约，app `SshBackend` 实现（§6；server 禁止 spawn ssh）。

use std::path::PathBuf;

use async_trait::async_trait;
use thiserror::Error;
use tokio::sync::mpsc;

/// 管道步骤（§6.1）；`admit` 在 server 元数据层完成，不经由此 trait。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PipelineStep {
    HostKeyProbe,
    AwaitingHostKey,
    SshConnect,
    Probe,
    Install,
    AwaitingReplace,
    Provision,
    Tunnel,
    Start,
    Connecting,
    Online,
}

impl PipelineStep {
    /// 对应 `machines.phase` 字符串。
    pub fn as_phase(self) -> &'static str {
        use crate::persist::metadata::machine_phases::{
            PHASE_AWAITING_HOST_KEY, PHASE_AWAITING_REPLACE, PHASE_CONNECTING,
            PHASE_HOST_KEY_PROBE, PHASE_INSTALL, PHASE_ONLINE, PHASE_PROBE, PHASE_PROVISION,
            PHASE_SSH_CONNECT, PHASE_START, PHASE_TUNNEL,
        };
        match self {
            Self::HostKeyProbe => PHASE_HOST_KEY_PROBE,
            Self::AwaitingHostKey => PHASE_AWAITING_HOST_KEY,
            Self::SshConnect => PHASE_SSH_CONNECT,
            Self::Probe => PHASE_PROBE,
            Self::Install => PHASE_INSTALL,
            Self::AwaitingReplace => PHASE_AWAITING_REPLACE,
            Self::Provision => PHASE_PROVISION,
            Self::Tunnel => PHASE_TUNNEL,
            Self::Start => PHASE_START,
            Self::Connecting => PHASE_CONNECTING,
            Self::Online => PHASE_ONLINE,
        }
    }
}

/// 启动管道所需的不可变快照（不含 token 正文）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PipelineSpec {
    pub instance_id: String,
    pub ssh_destination: String,
    pub ssh_port: Option<i64>,
    pub identity_file: Option<String>,
    pub host_key_sha256: Option<String>,
    /// Trust 前由 server 投影；`ssh_connect` 步骤写入 known_hosts 后消费。
    pub pending_host_key_line: Option<String>,
    pub remote_forward_port: Option<i64>,
    pub listen_port: u16,
    pub data_dir: PathBuf,
    pub current_exe: PathBuf,
    /// `machine/confirm-replace` 后为 true，允许覆盖远端已有二进制。
    pub replace_confirmed: bool,
}

/// app 侧管道进度事件（按步骤边界上报，禁止高频刷 Yjs）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PipelineEvent {
    StepComplete(PipelineStep),
    StepFailed {
        step: PipelineStep,
        error_code: String,
    },
    AwaitingTrust {
        fingerprint: String,
        known_hosts_line: String,
    },
    /// 远端已有 peri-studio 二进制，等待用户确认替换。
    AwaitingReplace,
    TunnelReady {
        port: u16,
    },
    OwnerFingerprint(String),
}

/// `machine/stop` 结果分类（§6.3 / §10）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopResult {
    Committed,
    DeliveryUnknown,
}

/// `machine/cancel` 结果分类（§6.3）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelResult {
    Committed,
    DeliveryUnknown,
}

#[derive(Debug, Error)]
pub enum PipelineError {
    #[error("pipeline busy for instance {instance_id}")]
    Busy { instance_id: String },
    #[error("pipeline not found for instance {instance_id}")]
    NotFound { instance_id: String },
    #[error("pipeline generation stale for instance {instance_id}")]
    StaleGeneration { instance_id: String },
    #[error("pipeline backend error: {0}")]
    Backend(String),
}

/// OpenSSH 执行端口；由 app 注入，server 只消费事件流。
#[async_trait]
pub trait MachinePipelinePort: Send + Sync {
    /// 从 host key 探测起跑完整管道（`machine/add`）。
    async fn start_pipeline(
        &self,
        spec: PipelineSpec,
        generation: u64,
        events: mpsc::Sender<PipelineEvent>,
    ) -> Result<(), PipelineError>;

    /// 从指定步骤续跑（Connect / Retry / Trust 之后）。
    async fn resume_pipeline(
        &self,
        spec: PipelineSpec,
        from_step: PipelineStep,
        generation: u64,
        events: mpsc::Sender<PipelineEvent>,
    ) -> Result<(), PipelineError>;

    /// 只拆本机 `ssh -R` 隧道（`machine/disconnect`）。
    async fn teardown_tunnel(&self, instance_id: &str) -> Result<(), PipelineError>;

    /// 经 ssh exec 关闭远端 connect + ACP（`machine/stop`）。
    async fn stop_remote(&self, instance_id: &str) -> Result<StopResult, PipelineError>;

    /// 取消进行中的管道（`machine/cancel`）。
    async fn cancel(
        &self,
        instance_id: &str,
        generation: u64,
    ) -> Result<CancelResult, PipelineError>;

    /// Trust 后把 pending host key 行写入本机 known_hosts（§8.2）。
    async fn append_known_hosts_line(
        &self,
        instance_id: &str,
        line: &str,
    ) -> Result<(), PipelineError>;

    /// instance hello 到达时唤醒 `connecting` 等待（§6.1 step 7）。
    async fn notify_instance_hello(&self, instance_id: &str);
}

/// 未注入 app 管道时的空实现；`start`/`resume` 返回明确错误，其余为 no-op。
#[derive(Debug, Default)]
pub struct NopMachinePipeline;

#[async_trait]
impl MachinePipelinePort for NopMachinePipeline {
    async fn start_pipeline(
        &self,
        _spec: PipelineSpec,
        _generation: u64,
        _events: mpsc::Sender<PipelineEvent>,
    ) -> Result<(), PipelineError> {
        Err(PipelineError::Backend(
            "machine pipeline not configured".into(),
        ))
    }

    async fn resume_pipeline(
        &self,
        _spec: PipelineSpec,
        _from_step: PipelineStep,
        _generation: u64,
        _events: mpsc::Sender<PipelineEvent>,
    ) -> Result<(), PipelineError> {
        Err(PipelineError::Backend(
            "machine pipeline not configured".into(),
        ))
    }

    async fn teardown_tunnel(&self, _instance_id: &str) -> Result<(), PipelineError> {
        Ok(())
    }

    async fn stop_remote(&self, _instance_id: &str) -> Result<StopResult, PipelineError> {
        Ok(StopResult::Committed)
    }

    async fn cancel(
        &self,
        _instance_id: &str,
        _generation: u64,
    ) -> Result<CancelResult, PipelineError> {
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

//! OpenSSH 子进程监督与 SSH 供应管道执行器（ssh-machine-mount §6）。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use peri_studio_server::control::{
    CancelResult, PipelineError, PipelineEvent, PipelineSpec, PipelineStep,
};
use tokio::process::Child;
use tokio::sync::{mpsc, Mutex, Notify};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tracing::instrument;

use crate::ssh_argv::{known_hosts_path, SshConnectOptions};

/// OpenSSH 可执行文件路径（测试可经环境变量覆盖）。
#[derive(Debug, Clone)]
pub struct SshPrograms {
    pub ssh: PathBuf,
    pub scp: PathBuf,
    pub keyscan: PathBuf,
}

impl SshPrograms {
    /// 解析本机 OpenSSH 路径；`SSH_BACKEND_FAKE=1` 时仍默认系统名，由测试注入路径。
    pub fn resolve() -> Self {
        Self {
            ssh: program_path("SSH_BACKEND_SSH", "ssh"),
            scp: program_path("SSH_BACKEND_SCP", "scp"),
            keyscan: program_path("SSH_BACKEND_KEYSCAN", "ssh-keyscan"),
        }
    }
}

fn program_path(env_key: &str, default: &str) -> PathBuf {
    std::env::var(env_key)
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(default))
}

/// `SshBackend` 运行所需的本机上下文。
#[derive(Debug, Clone)]
pub struct SshBackendConfig {
    pub data_dir: PathBuf,
    pub config_dir: PathBuf,
    #[allow(dead_code)] // install/scp 步骤读取
    pub current_exe: PathBuf,
    #[allow(dead_code)] // tunnel argv 由 pipeline 模块通过 backend.config() 读取
    pub listen_port: u16,
}

struct ActivePipeline {
    generation: u64,
    cancel: CancellationToken,
    task: JoinHandle<()>,
    started: bool,
    #[allow(dead_code)] // 取消/审计路径保留 spec 引用
    spec: PipelineSpec,
}

struct SshBackendState {
    pipelines: HashMap<String, ActivePipeline>,
    tunnels: HashMap<String, Child>,
    specs: HashMap<String, PipelineSpec>,
    hello_gates: HashMap<String, Arc<Notify>>,
    tunnel_ports: HashMap<String, u16>,
}

/// app 侧 OpenSSH 执行后端；server 禁止直接 spawn `ssh`。
pub struct SshBackend {
    config: SshBackendConfig,
    programs: SshPrograms,
    state: Arc<Mutex<SshBackendState>>,
}

impl SshBackend {
    pub fn new(config: SshBackendConfig) -> Self {
        Self {
            config,
            programs: SshPrograms::resolve(),
            state: Arc::new(Mutex::new(SshBackendState {
                pipelines: HashMap::new(),
                tunnels: HashMap::new(),
                specs: HashMap::new(),
                hello_gates: HashMap::new(),
                tunnel_ports: HashMap::new(),
            })),
        }
    }

    #[allow(dead_code)] // 测试注入 fake OpenSSH 路径
    pub fn with_programs(mut self, programs: SshPrograms) -> Self {
        self.programs = programs;
        self
    }

    pub fn config(&self) -> &SshBackendConfig {
        &self.config
    }

    pub fn programs(&self) -> &SshPrograms {
        &self.programs
    }

    pub fn data_dir(&self) -> &Path {
        &self.config.data_dir
    }

    pub fn known_hosts_path(&self) -> PathBuf {
        known_hosts_path(&self.config.data_dir)
    }

    pub(crate) fn connect_options<'a>(&'a self, spec: &'a PipelineSpec) -> SshConnectOptions<'a> {
        SshConnectOptions {
            data_dir: &self.config.data_dir,
            config_dir: &self.config.config_dir,
            destination: &spec.ssh_destination,
            port: spec.ssh_port.map(|p| p as u16),
            identity_file: spec.identity_file.as_deref(),
        }
    }

    /// 启动或续跑供应管道（由 `MachinePipelinePort` 调用）。
    pub async fn spawn_pipeline(
        &self,
        spec: PipelineSpec,
        generation: u64,
        from_step: PipelineStep,
        events: mpsc::Sender<PipelineEvent>,
    ) -> Result<(), PipelineError> {
        let instance_id = spec.instance_id.clone();
        if let Some(active) = self.state.lock().await.pipelines.get(&instance_id) {
            if active.generation == generation {
                if !active.task.is_finished() {
                    return Err(PipelineError::Busy { instance_id });
                }
                self.state.lock().await.pipelines.remove(&instance_id);
            }
        }
        self.cancel_pipeline_inner(&instance_id, generation, false)
            .await?;
        self.state
            .lock()
            .await
            .specs
            .insert(instance_id.clone(), spec.clone());
        let cancel = CancellationToken::new();
        let backend = self.clone_inner();
        let spec_for_task = spec.clone();
        let cancel_child = cancel.child_token();
        let task = tokio::spawn(async move {
            crate::ssh_backend_pipeline::run_pipeline(
                backend,
                spec_for_task,
                generation,
                from_step,
                events,
                cancel_child,
            )
            .await;
        });
        self.state.lock().await.pipelines.insert(
            instance_id,
            ActivePipeline {
                generation,
                cancel,
                task,
                started: false,
                spec,
            },
        );
        Ok(())
    }

    pub async fn set_tunnel_port(&self, instance_id: &str, port: u16) {
        self.state
            .lock()
            .await
            .tunnel_ports
            .insert(instance_id.to_string(), port);
    }

    pub async fn tunnel_port(&self, instance_id: &str) -> Option<u16> {
        self.state
            .lock()
            .await
            .tunnel_ports
            .get(instance_id)
            .copied()
    }

    pub async fn mark_pipeline_started(&self, instance_id: &str) {
        if let Some(pipeline) = self.state.lock().await.pipelines.get_mut(instance_id) {
            pipeline.started = true;
        }
    }

    pub async fn store_spec(&self, spec: PipelineSpec) {
        self.state
            .lock()
            .await
            .specs
            .insert(spec.instance_id.clone(), spec);
    }

    pub async fn spec_for(&self, instance_id: &str) -> Option<PipelineSpec> {
        self.state.lock().await.specs.get(instance_id).cloned()
    }

    pub async fn hello_gate(&self, instance_id: &str) -> Arc<Notify> {
        let mut state = self.state.lock().await;
        state
            .hello_gates
            .entry(instance_id.to_string())
            .or_insert_with(|| Arc::new(Notify::new()))
            .clone()
    }

    pub async fn notify_instance_hello(&self, instance_id: &str) {
        if let Some(gate) = self.state.lock().await.hello_gates.get(instance_id) {
            gate.notify_waiters();
        }
    }

    /// Trust 后追加 known_hosts 行（0600 目录语义由 data_dir 权限承担）。
    pub async fn append_known_hosts_line(
        &self,
        _instance_id: &str,
        line: &str,
    ) -> Result<(), String> {
        let path = self.known_hosts_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt as _;
                std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
                    .map_err(|error| error.to_string())?;
            }
        }
        use std::io::Write as _;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|error| error.to_string())?;
        if file.metadata().map(|m| m.len()).unwrap_or(0) > 0 {
            writeln!(file).map_err(|error| error.to_string())?;
        }
        writeln!(file, "{line}").map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    pub async fn store_tunnel(&self, instance_id: &str, child: Child) {
        let mut state = self.state.lock().await;
        if let Some(mut old) = state.tunnels.remove(instance_id) {
            let _ = old.start_kill();
        }
        state.tunnels.insert(instance_id.to_string(), child);
    }

    pub async fn take_tunnel(&self, instance_id: &str) -> Option<Child> {
        self.state.lock().await.tunnels.remove(instance_id)
    }

    /// 拆本机 `ssh -R` 隧道（Disconnect tunnel）。
    #[instrument(skip(self), fields(instance_id = %instance_id))]
    pub async fn disconnect_tunnel(&self, instance_id: &str) -> Result<(), String> {
        if let Some(mut child) = self.take_tunnel(instance_id).await {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
        Ok(())
    }

    /// 经 ssh exec 请求远端 owner shutdown（Stop agents）。
    #[instrument(skip(self), fields(instance_id = %instance_id))]
    pub async fn stop_remote_agents(&self, instance_id: &str) -> Result<(), String> {
        let spec = self
            .spec_for(instance_id)
            .await
            .ok_or_else(|| format!("no SSH spec cached for instance {instance_id}"))?;
        crate::ssh_backend_pipeline::stop_remote_agents(self, &spec).await
    }

    pub async fn cancel_pipeline(
        &self,
        instance_id: &str,
        generation: u64,
    ) -> Result<CancelResult, PipelineError> {
        self.cancel_pipeline_inner(instance_id, generation, true)
            .await
    }

    async fn cancel_pipeline_inner(
        &self,
        instance_id: &str,
        generation: u64,
        user_cancel: bool,
    ) -> Result<CancelResult, PipelineError> {
        let mut state = self.state.lock().await;
        let Some(active) = state.pipelines.remove(instance_id) else {
            return if user_cancel {
                Err(PipelineError::NotFound {
                    instance_id: instance_id.into(),
                })
            } else {
                Ok(CancelResult::Committed)
            };
        };
        if active.generation != generation {
            return Err(PipelineError::StaleGeneration {
                instance_id: instance_id.into(),
            });
        }
        let delivery_unknown = active.started;
        active.cancel.cancel();
        drop(state);
        let _ = active.task.await;
        self.disconnect_tunnel(instance_id).await.ok();
        if delivery_unknown {
            Ok(CancelResult::DeliveryUnknown)
        } else {
            Ok(CancelResult::Committed)
        }
    }

    fn clone_inner(&self) -> Arc<SshBackend> {
        Arc::new(Self {
            config: self.config.clone(),
            programs: self.programs.clone(),
            state: self.state.clone(),
        })
    }
}

impl Clone for SshBackend {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            programs: self.programs.clone(),
            state: self.state.clone(),
        }
    }
}

//! 可嵌入的 server 运行时入口。
//!
//! 本模块拥有 server 的完整启动装配：目录与本地 instance 凭据、Store、
//! AuthService、Hub，以及监听 socket。信号处理和日志初始化属于最外层应用，
//! 因此调用方通过 future 明确交付 shutdown，库本身不注册进程信号。

use std::future::Future;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;

use tokio::task::JoinHandle;
use url::Url;

use crate::auth::audit::audit;
use crate::auth::{AuthService, TokenStore, BOOTSTRAP_INSTANCE_NAME, TOKENS_FILE};
use crate::config::Config;
use crate::control::Hub;
use crate::persist::{PersistConfig, Store};

/// app 可注入的 server 侧机器相关端口集合。
#[derive(Clone, Default)]
pub struct MachinePorts {
    pipeline: Option<Arc<dyn crate::control::MachinePipelinePort>>,
}

impl MachinePorts {
    /// 不注入 app 管道（SSH 供应操作返回 `PipelineUnavailable`）。
    pub fn none() -> Self {
        Self::default()
    }

    /// 注入 app 侧 `MachinePipelinePort` 实现。
    pub fn with_pipeline(pipeline: Arc<dyn crate::control::MachinePipelinePort>) -> Self {
        Self {
            pipeline: Some(pipeline),
        }
    }

    pub(crate) fn pipeline(&self) -> Option<Arc<dyn crate::control::MachinePipelinePort>> {
        self.pipeline.clone()
    }
}

/// 由 server 管理、可直接交给本地 instance 的凭据定位信息。
///
/// 结构中没有 token 本体，`Debug` 和上层状态输出不会意外泄露 secret。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalInstanceCredential {
    /// 线级 instance id（当前为 `local`）。
    pub instance_id: String,
    /// 受限为 0600 的凭据文件路径。
    pub token_file: PathBuf,
    /// token 记录 id，供吊销与审计引用。
    pub token_id: String,
    /// 本次启动是否创建了新 token 记录。
    pub newly_created: bool,
}

/// 监听已成功绑定且 Hub 已完成装配后的就绪信息。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerReady {
    /// socket 实际绑定地址；配置端口为 0 时这里包含内核分配的端口。
    pub listen_addr: SocketAddr,
    /// 本机进程应使用的可连接地址；unspecified bind 会归一化为 loopback。
    pub local_addr: SocketAddr,
    /// Web/HTTP 根地址。
    pub web_url: Url,
    /// 本地 instance 的 WebSocket endpoint。
    pub instance_url: Url,
    /// server 负责发布的本地 instance 凭据。
    pub local_instance: LocalInstanceCredential,
}

impl ServerReady {
    fn new(listen_addr: SocketAddr, credential: LocalInstanceCredential) -> Self {
        let local_ip = match listen_addr.ip() {
            IpAddr::V4(ip) if ip.is_unspecified() => IpAddr::V4(Ipv4Addr::LOCALHOST),
            IpAddr::V6(ip) if ip.is_unspecified() => IpAddr::V6(Ipv6Addr::LOCALHOST),
            ip => ip,
        };
        let local_addr = SocketAddr::new(local_ip, listen_addr.port());
        let web_url = Url::parse(&format!("http://{local_addr}/"))
            .expect("SocketAddr must produce a valid HTTP URL");
        let instance_url = Url::parse(&format!("ws://{local_addr}/instance"))
            .expect("SocketAddr must produce a valid WebSocket URL");
        Self {
            listen_addr,
            local_addr,
            web_url,
            instance_url,
            local_instance: credential,
        }
    }
}

/// 已启动的 server。
///
/// [`Self::start`] 仅在 Hub 装配完成、监听 socket 成功绑定后返回，因此调用方
/// 可以立即读取 [`Self::ready`] 并启动自连接 instance。等待退出由
/// [`Self::wait`] 完成；若句柄被直接丢弃，后台任务会被中止，避免失去所有权的
/// server 静默留在进程内运行。
pub struct ServerRuntime {
    ready: ServerReady,
    task: Option<JoinHandle<anyhow::Result<()>>>,
}

impl ServerRuntime {
    /// 装配并启动 server。shutdown 完全由调用方拥有，运行时不安装 OS signal。
    pub async fn start<S>(cfg: Config, shutdown: S) -> anyhow::Result<Self>
    where
        S: Future<Output = ()> + Send + 'static,
    {
        Self::start_with_ports(cfg, shutdown, MachinePorts::none()).await
    }

    /// 装配并启动 server，并注入 app 侧机器管道端口。
    pub async fn start_with_ports<S>(
        cfg: Config,
        shutdown: S,
        ports: MachinePorts,
    ) -> anyhow::Result<Self>
    where
        S: Future<Output = ()> + Send + 'static,
    {
        // 先占用监听地址再做任何凭据或状态写入；端口冲突时启动必须无副作用。
        let requested = SocketAddr::new(cfg.listen_addr, cfg.listen_port);
        let listener = tokio::net::TcpListener::bind(requested).await?;
        let listen_addr = listener.local_addr()?;

        cfg.ensure_dirs()?;
        let mut token_store = TokenStore::load(&cfg.config_dir.join(TOKENS_FILE))?;
        let ensured = token_store.ensure_instance_credential_to_file(
            BOOTSTRAP_INSTANCE_NAME,
            &cfg.data_dir.join("instance.token"),
        )?;
        if ensured.newly_created {
            audit(
                "token.generate",
                None,
                Some(&ensured.token_id),
                "ok",
                std::time::Duration::ZERO,
                None,
            );
        }
        let credential = LocalInstanceCredential {
            instance_id: ensured.instance_id,
            token_file: ensured.path,
            token_id: ensured.token_id,
            newly_created: ensured.newly_created,
        };

        // Store/认证/控制面均在监听前完成；start 返回即代表可接受连接。
        let persist_cfg = PersistConfig::from(&cfg);
        let store = Arc::new(Store::open(&persist_cfg)?);
        let auth = Arc::new(tokio::sync::Mutex::new(AuthService::new(token_store)));
        let hub = Hub::assemble_with_ports(&cfg, store, auth, ports, listen_addr.port()).await?;

        let ready = ServerReady::new(listen_addr, credential);
        let task = tokio::spawn(async move { hub.run_server_on(listener, shutdown).await });

        Ok(Self {
            ready,
            task: Some(task),
        })
    }

    /// 已绑定的 endpoint 与本地 instance 凭据路径。
    pub fn ready(&self) -> &ServerReady {
        &self.ready
    }

    /// 等待调用方 shutdown 或 server 运行退出。
    pub async fn wait(mut self) -> anyhow::Result<()> {
        let task = self.task.take().expect("server runtime task missing");
        task.await
            .map_err(|error| anyhow::anyhow!("server runtime task failed: {error}"))?
    }
}

impl Drop for ServerRuntime {
    fn drop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    fn test_config(temp: &tempfile::TempDir) -> Config {
        let mut cfg = Config::defaults();
        cfg.listen_addr = IpAddr::V4(Ipv4Addr::LOCALHOST);
        // 直接构造 Config 时允许内核分配端口；CLI 配置仍维持非 0 校验。
        cfg.listen_port = 0;
        cfg.config_dir = temp.path().join("config");
        cfg.data_dir = temp.path().join("data");
        cfg
    }

    #[tokio::test]
    async fn start_returns_bound_endpoint_and_stops_on_external_shutdown() {
        let temp = tempfile::tempdir().unwrap();
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
        let runtime = ServerRuntime::start(test_config(&temp), async move {
            let _ = shutdown_rx.await;
        })
        .await
        .unwrap();

        let ready = runtime.ready().clone();
        assert_ne!(ready.listen_addr.port(), 0);
        assert_eq!(ready.listen_addr, ready.local_addr);
        assert_eq!(ready.web_url.port(), Some(ready.listen_addr.port()));
        assert_eq!(ready.instance_url.path(), "/instance");
        assert_eq!(ready.local_instance.instance_id, "local");
        assert!(ready.local_instance.newly_created);
        assert!(ready.local_instance.token_file.is_file());
        tokio::net::TcpStream::connect(ready.local_addr)
            .await
            .unwrap();

        shutdown_tx.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(3), runtime.wait())
            .await
            .expect("server ignored caller shutdown")
            .unwrap();
    }

    #[tokio::test]
    async fn occupied_port_fails_before_credentials_are_written() {
        let temp = tempfile::tempdir().unwrap();
        let occupied = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let mut cfg = test_config(&temp);
        cfg.listen_port = occupied.local_addr().unwrap().port();

        assert!(ServerRuntime::start(cfg, std::future::pending())
            .await
            .is_err());
        assert!(!temp.path().join("config").exists());
        assert!(!temp.path().join("data").exists());
        assert!(!temp.path().join("config/tokens.toml").exists());
        assert!(!temp.path().join("data/instance.token").exists());
    }
}

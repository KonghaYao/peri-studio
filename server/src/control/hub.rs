//! 控制面装配（架构 §8.4.1/§8.6/§17.2）。
//!
//! [`Hub`] 是**唯一装配点**：Store 恢复 → StoreSink（UpdateSink 薄 adapter +
//! 内存镜像）→ DocManager → 注册表/协调器/广播器 → Gateway；后台周期任务
//! （instance 离线 sweep + nonce sweep 合并单一 tick，设计稿决策 5）。
//!
//! [`StoreSink`]：F5 提供的 `UpdateSink` 生产实现（无状态投影重构：
//! `docs/design/peri-studio-stateless-projections.md`）：
//!
//! - **纯内存镜像**：chat/control/registry update → 内存 yrs 镜像应用 +
//!   广播（不落盘）——gateway 快照与 broadcaster 增量的**单一真相**；
//! - **启动即空**：视图完全由 ACP 重放提供（live chat 走 `session/resume`，
//!   已结束会话走重启进程 + `session/load`）；registry 从
//!   `metadata.sqlite3` 重建（`ProjectService::reproject`）；
//! - **广播**：镜像更新流（`subscribe()`）供 Broadcaster attach——快照与增量
//!   同源同 clientID，客户端应用无 CRDT 分叉。

use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::Arc;

use tracing::{info, warn};

use crate::channel::Broadcaster;
use crate::channel::ChannelDeps;
use crate::channel::CommandCoordinator;
use crate::channel::ConnectionRegistry;
use crate::channel::Gateway;
use crate::channel::RelayEventHandler;
use crate::config::Config;
use crate::control::ChatRegistry;
use crate::control::InstanceRegistry;
use crate::control::ProjectService;
use crate::control::SessionCatalog;
use crate::persist::metadata::MetadataStore;
use crate::persist::Store;
use crate::state::doc_manager::{BatchConfig, DocManager};
use crate::state::registry::RegistryState;

/// 后台任务所有权护栏：外层运行 future 被取消时同步发出 abort，禁止任务脱离。
struct AbortTaskOnDrop(Option<tokio::task::JoinHandle<()>>);

impl AbortTaskOnDrop {
    fn new(task: tokio::task::JoinHandle<()>) -> Self {
        Self(Some(task))
    }

    async fn stop(mut self) {
        if let Some(task) = self.0.take() {
            task.abort();
            let _ = task.await;
        }
    }
}

impl Drop for AbortTaskOnDrop {
    fn drop(&mut self) {
        if let Some(task) = self.0.take() {
            task.abort();
        }
    }
}

/// hub 装配/运行错误。
#[derive(Debug, thiserror::Error)]
pub enum HubError {
    /// Store 打开失败。
    #[error("store open failed: {0}")]
    Store(String),
    /// 监听绑定失败。
    #[error("bind failed: {0}")]
    Bind(std::io::Error),
    /// 周期任务退出。
    #[error("maintenance task failed")]
    Maintenance,
}

/// 控制面装配：全部组件实例化与接线（§8.6）。
pub struct Hub {
    /// 持久化 Store（metadata.sqlite3 权威；无投影落盘，§无状态投影）。
    pub store: Arc<Store>,
    /// UpdateSink 薄 adapter + 内存镜像（不落盘）。
    pub sink: Arc<StoreSink>,
    /// DocManager（唯一提交边界）。
    pub doc: Arc<DocManager>,
    /// 命令协调器。
    pub coordinator: Arc<CommandCoordinator>,
    /// instance 入站消费。
    pub relay: Arc<RelayEventHandler>,
    /// instance 注册表。
    pub instance: Arc<InstanceRegistry>,
    /// chat 注册表。
    pub chats: Arc<ChatRegistry>,
    /// 连接注册表。
    pub conns: Arc<ConnectionRegistry>,
    /// 广播器。
    pub broadcast: Arc<Broadcaster>,
    /// gateway。
    pub gateway: Gateway,
    /// auth 服务（周期 nonce sweep 共享）。
    pub auth: Arc<tokio::sync::Mutex<crate::auth::AuthService>>,
    /// Registry 状态源（§17.2 degraded 判定 / §8.4.1 恢复门禁）。
    pub registry: RegistryState,
    pub metadata: Arc<MetadataStore>,
    pub projects: ProjectService,
    /// 短租约远程 FS/Git 查询与 Yjs 投影服务。
    pub resources: Arc<crate::control::ResourceService>,
    pub terminals: Arc<crate::control::TerminalService>,
}

impl Hub {
    /// 装配（main `run_with` 调用；store 须已完成 `recover`，§8.4.1）。
    #[allow(clippy::too_many_arguments)]
    pub async fn assemble(
        cfg: &Config,
        store: Arc<Store>,
        auth: Arc<tokio::sync::Mutex<crate::auth::AuthService>>,
    ) -> Result<Hub, HubError> {
        // 1. UpdateSink 薄 adapter（内存镜像 + 广播流，无落盘）。
        let sink = Arc::new(StoreSink::new());
        // 2. DocManager（BatchConfig 从 §16 默认映射）。无恢复注入：registry
        // 与 chat/session 视图均从零重建（SQLite 投影 / ACP 重放，§无状态
        // 投影），不再重放任何日志。
        let batch = BatchConfig {
            batch_window: cfg.microbatch_window,
            batch_bytes: 4096,
            chat_queue: cfg.command_queue_cap,
        };
        let doc = Arc::new(DocManager::new(batch, sink.clone()));
        let registry = doc.registry();
        let metadata = Arc::new(
            MetadataStore::open(store.data_dir())
                .await
                .map_err(|e| HubError::Store(e.to_string()))?,
        );
        // 3. 注册表/协调器/广播器。
        let chats = Arc::new(ChatRegistry::new(registry.clone()));
        let catalog = SessionCatalog::new();
        let instance = Arc::new(InstanceRegistry::new(
            cfg.offline_timeout,
            cfg.spawn_timeout,
            chats.as_ref().clone(),
        ));
        let relay = Arc::new(RelayEventHandler::new(
            doc.clone(),
            chats.as_ref().clone(),
            instance.clone(),
            registry.clone(),
        ));
        let coordinator = Arc::new(CommandCoordinator::new(
            store.clone(),
            doc.clone(),
            instance.clone(),
            chats.as_ref().clone(),
            relay.clone(),
            sink.clone(),
            &batch,
            cfg.acp_cmd.clone(),
            cfg.spawn_timeout,
            cfg.initialize_timeout,
            cfg.binding_timeout,
        ));
        let projects = ProjectService::new(
            metadata.clone(),
            registry.clone(),
            catalog,
            chats.as_ref().clone(),
        );
        coordinator.install_project_service(projects.clone()).await;
        coordinator.install_history_sink(sink.clone()).await;
        coordinator
            .reconcile_prompt_delivery_after_restart()
            .await
            .map_err(HubError::Store)?;
        // §4.4：create 全局去重索引（跨 server 重启有效）——store 已完成
        // recover（main 前置），从 outbox 重建后才接受连接。
        coordinator.rebuild_create_index().await;
        // §6.3 workspace 扩展：工作区内存注册表从 Registry Doc 重建（跨
        // 重启后 create 携带 workspace_id 仍能解析 cwd）。
        coordinator.rebuild_workspaces().await;
        projects
            .import_legacy_workspaces()
            .await
            .map_err(|e| HubError::Store(e.to_string()))?;
        metadata
            .recover_after_restart()
            .await
            .map_err(|e| HubError::Store(e.to_string()))?;
        projects
            .reproject()
            .await
            .map_err(|e| HubError::Store(e.to_string()))?;
        // §6.3：session/list 轮询（10s 全量同步投影；server 侧，见
        // CommandCoordinator::spawn_session_poller 决策注释）。
        coordinator.spawn_session_poller();
        let broadcast = Arc::new(Broadcaster::new(
            cfg.backpressure_soft_bytes,
            cfg.backpressure_hard_bytes,
        ));
        // 广播流 = StoreSink 镜像增量（单一真相，见模块文档）。
        broadcast.attach(sink.subscribe().await);
        let conns = Arc::new(ConnectionRegistry::new(cfg.connection_quota));
        let resource_projection = crate::control::ResourceProjection::new(
            sink.clone(),
            std::time::Duration::from_secs(60),
            32,
        );
        let resources = Arc::new(crate::control::ResourceService::new(
            metadata.clone(),
            instance.clone(),
            resource_projection,
        ));
        let terminals = Arc::new(crate::control::TerminalService::new(
            metadata.clone(),
            instance.clone(),
            cfg.spawn_timeout,
        ));
        let deps = ChannelDeps {
            coordinator: coordinator.clone(),
            broadcast: broadcast.clone(),
            instance: instance.clone(),
            chats: chats.clone(),
            conns: conns.clone(),
        };
        // 恢复门禁必须先于 Gateway 接受连接；重建失败直接阻止启动，不能让
        // 一个不完整 Registry 在 hello 后被误报为 Healthy。
        registry
            .set_restarting()
            .await
            .map_err(|error| HubError::Store(error.to_string()))?;
        let recovery_instances = Self::rebuild_chat_views(&metadata, &chats).await?;
        if recovery_instances.is_empty() {
            registry
                .clear_restarting()
                .await
                .map_err(|error| HubError::Store(error.to_string()))?;
        }
        let gateway = Gateway::new(
            Arc::new(cfg.clone()),
            auth.clone(),
            conns.clone(),
            deps,
            relay.clone(),
            doc.clone(),
            sink.clone(),
            resources.clone(),
            terminals.clone(),
            registry.clone(),
            recovery_instances,
        );
        Ok(Hub {
            store,
            sink,
            doc,
            coordinator,
            relay,
            instance,
            chats,
            conns,
            broadcast,
            gateway,
            auth,
            registry,
            metadata,
            projects,
            resources,
            terminals,
        })
    }

    /// Server restart no longer rebuilds chat views from SQLite (ADR-0003).
    /// ChatRegistry starts empty; live runtimes are recovered via instance
    /// hello reconciliation and explicit `session/open` + `session/load`.
    async fn rebuild_chat_views(
        _metadata: &MetadataStore,
        _chats: &ChatRegistry,
    ) -> Result<HashSet<String>, HubError> {
        Ok(HashSet::new())
    }

    /// 运行入口（main `run_with` 调用）：绑定监听 → 周期任务 + gateway 并发
    /// 运行 → 优雅关闭（§8.6 顺序：停止接收新 Action → 完成在途提交 →
    /// 释放引用 → 关闭连接）。
    ///
    /// `signal` 为 SIGINT/SIGTERM 通知（main 装配）。
    pub async fn run_server(
        self,
        cfg: &Config,
        signal: impl std::future::Future<Output = ()>,
    ) -> anyhow::Result<()> {
        let addr = std::net::SocketAddr::new(cfg.listen_addr, cfg.listen_port);
        let listener = tokio::net::TcpListener::bind(addr)
            .await
            .map_err(HubError::Bind)?;
        self.run_server_on(listener, signal).await
    }

    /// 使用调用方预先绑定的 listener 运行 server。
    ///
    /// 统一应用入口需要在启动本地 instance 前获得端口 0 的实际 endpoint，
    /// 因此 socket 的所有权可以从外层传入；shutdown 仍完全由调用方交付。
    pub async fn run_server_on(
        self,
        listener: tokio::net::TcpListener,
        signal: impl std::future::Future<Output = ()>,
    ) -> anyhow::Result<()> {
        let addr = listener.local_addr().map_err(HubError::Bind)?;
        info!(%addr, "peri-studio server role listening");

        // 周期任务：instance 离线 sweep + nonce sweep（单一 tick，设计稿
        // 决策 5；判定粒度 1s【决策】）。
        let instance = self.instance.clone();
        let relay = self.relay.clone();
        let terminals = self.terminals.clone();
        let auth = self.auth.clone();
        let maintenance = AbortTaskOnDrop::new(tokio::spawn(async move {
            let mut ticker = tokio::time::interval(std::time::Duration::from_secs(1));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                ticker.tick().await;
                let now = std::time::Instant::now();
                for instance_id in instance.sweep_offline(now).await {
                    // §7.1 离线即刻生效（心跳超时路径）。
                    terminals.on_instance_disconnect(&instance_id).await;
                    if let Err(e) = relay.on_instance_disconnect(&instance_id).await {
                        warn!(instance_id, error = ?e, "offline cleanup failed");
                    }
                }
                terminals.sweep_expired_pending(now).await;
                // nonce sweep（§9.2：30s 窗口过期清理）。
                auth.lock().await.nonces_mut().sweep(now);
            }
        }));

        // 优雅关闭：停止 accept + 周期任务 → 连接自然关闭。
        let gateway = self.gateway.clone();
        let sandbox_port = crate::web::sandbox::sandbox_port(addr.port());
        let sandbox_addr = SocketAddr::new(addr.ip(), sandbox_port);
        let sandbox_listener = match tokio::net::TcpListener::bind(sandbox_addr).await {
            Ok(listener) => {
                if let Ok(bound) = listener.local_addr() {
                    crate::web::sandbox::remember_bound_port(bound.port());
                }
                Some(listener)
            }
            Err(error) => {
                warn!(%sandbox_addr, ?error, "MCP Apps sandbox listener failed; inline Apps disabled");
                None
            }
        };
        tokio::select! {
            _ = gateway.run(listener) => {
                warn!("gateway run exited unexpectedly");
            }
            _ = async {
                if let Some(listener) = sandbox_listener {
                    let _ = crate::web::sandbox::serve_sandbox(listener).await;
                } else {
                    std::future::pending::<()>().await;
                }
            } => {
                warn!("sandbox server exited unexpectedly");
            }
            _ = signal => {
                info!("shutdown signal received; closing connections");
            }
        }
        maintenance.stop().await;
        self.terminals.shutdown().await;
        info!("peri-studio server role stopped");
        Ok(())
    }

    /// Degraded 判定入口（§17.2）：非 Healthy → 拒绝新 committed 承诺（新
    /// Action 返回 retryable 错误，§8.4 落盘失败语义同源）。
    pub fn can_accept_committed(&self) -> bool {
        self.gateway.can_accept_committed()
    }
}

// 结构拆分：StoreSink（UpdateSink 薄 adapter + 内存镜像 + 广播）为同目录
// 实现段（hub_sink.rs）。
#[path = "hub_sink.rs"]
mod hub_sink;

pub use hub_sink::StoreSink;

#[cfg(test)]
#[path = "hub_test.rs"]
mod hub_test;

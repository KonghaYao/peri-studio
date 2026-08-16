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
use crate::persist::metadata::MetadataStore;
use crate::persist::Store;
use crate::state::doc_manager::{BatchConfig, DocManager};
use crate::state::registry::RegistryState;

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
            &batch,
            cfg.acp_cmd.clone(),
            cfg.spawn_timeout,
            cfg.initialize_timeout,
            cfg.binding_timeout,
        ));
        let projects = ProjectService::new(metadata.clone(), registry.clone());
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
        projects
            .import_legacy_sessions()
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
        let deps = ChannelDeps {
            coordinator: coordinator.clone(),
            broadcast: broadcast.clone(),
            instance: instance.clone(),
            chats: chats.clone(),
            conns: conns.clone(),
        };
        let gateway = Gateway::new(
            Arc::new(cfg.clone()),
            auth.clone(),
            conns.clone(),
            deps,
            relay.clone(),
            doc.clone(),
            sink.clone(),
            registry.clone(),
        );
        // §8.4.1 不变量 4：恢复期门禁——instance 重连（hello）对账完成前
        // 不开门（gateway 在首次 hello 后 clear_restarting；Restarting 期间
        // 拒绝新 committed 承诺）。
        if let Err(e) = registry.set_restarting().await {
            warn!(error = ?e, "set_restarting failed (registry write)");
        }
        // 启动重建（§无状态投影 恢复路径）：chat 视图从 SQLite
        // `session_runtime_history`（retired_at IS NULL 的活跃 runtime）全量
        // 重建——进程内 ChatRegistry 与 Registry Doc `chats` 段同步恢复，
        // 状态为 accepting（可 resume/load）。live chat 的 ACP 进程在 server
        // 崩溃期间继续运行，instance 重连（hello）后由
        // `resume_instance_chats` 批量恢复视图；终态 chat 不存在于 runtime
        // 历史（retired），不重建，由客户端显式 load 兜底。
        Self::rebuild_chat_views(&metadata, &chats).await;
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
        })
    }

    /// 启动重建（§无状态投影 恢复路径）：chat 视图从 SQLite
    /// `session_runtime_history`（retired_at IS NULL 的活跃 runtime）全量
    /// 重建——进程内 ChatRegistry 与 Registry Doc `chats` 段同步恢复。
    ///
    /// 状态语义：**accepting + 绑定 acp_session_id**——live chat 的 ACP 进程
    /// 在 server 崩溃期间继续运行（§8.3 不变），instance 重连 hello 后
    /// `resume_instance_chats` 只命中非终态 chat，必须保持非终态才能恢复
    /// 视图。终态 chat 不在 runtime 历史（retired）中，不重建；用户显式
    /// 打开时由 spawn + `session/load` 兜底。重建失败仅告警——后续任何
    /// 客户端显式 load/prompt 都会按需补建（chat 存在性由 Store 判定）。
    async fn rebuild_chat_views(metadata: &MetadataStore, chats: &ChatRegistry) {
        let runtimes = match metadata.list_runtime_chats().await {
            Ok(runtimes) => runtimes,
            Err(error) => {
                warn!(
                    error = ?error,
                    "chat view rebuild failed; resume unavailable until explicit load"
                );
                return;
            }
        };
        let mut restored = 0usize;
        for runtime in runtimes {
            if let Err(error) = chats
                .register(
                    &runtime.chat_id,
                    &runtime.instance_id,
                    Some(&runtime.title),
                    &runtime.cwd,
                    runtime.workspace_id.as_deref(),
                )
                .await
            {
                warn!(
                    chat_id = %runtime.chat_id,
                    error = ?error,
                    "chat view rebuild register failed"
                );
                continue;
            }
            if let Some(acp_session_id) = runtime.acp_session_id.as_deref() {
                // 视图重建不构成进程存活证据：恢复的 chat 先按未确认处理，
                // 等 instance hello 对账（alive_sessions）裁决后再复用为
                // live runtime（§8.3）。未确认的 chat 打开时走 spawn +
                // `session/load` 恢复。
                if let Err(error) = chats
                    .bind(&runtime.chat_id, acp_session_id, false)
                    .await
                {
                    warn!(
                        chat_id = %runtime.chat_id,
                        error = ?error,
                        "chat view rebuild bind failed"
                    );
                }
            }
            restored += 1;
        }
        if restored > 0 {
            info!(count = restored, "chat views rebuilt from metadata.sqlite3");
        }
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
        info!(%addr, "peri-studio-server listening");

        // 周期任务：instance 离线 sweep + nonce sweep（单一 tick，设计稿
        // 决策 5；判定粒度 1s【决策】）。
        let instance = self.instance.clone();
        let relay = self.relay.clone();
        let auth = self.auth.clone();
        let maintenance = tokio::spawn(async move {
            let mut ticker = tokio::time::interval(std::time::Duration::from_secs(1));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                ticker.tick().await;
                let now = std::time::Instant::now();
                for instance_id in instance.sweep_offline(now).await {
                    // §7.1 离线即刻生效（心跳超时路径）。
                    if let Err(e) = relay.on_instance_disconnect(&instance_id).await {
                        warn!(instance_id, error = ?e, "offline cleanup failed");
                    }
                }
                // nonce sweep（§9.2：30s 窗口过期清理）。
                auth.lock().await.nonces_mut().sweep(now);
            }
        });

        // 优雅关闭：停止 accept + 周期任务 → 连接自然关闭。
        let gateway = self.gateway.clone();
        tokio::select! {
            _ = gateway.run(listener) => {
                warn!("gateway run exited unexpectedly");
            }
            _ = signal => {
                info!("shutdown signal received; closing connections");
            }
        }
        maintenance.abort();
        info!("peri-studio-server stopped");
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

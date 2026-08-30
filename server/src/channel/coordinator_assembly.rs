//! CommandCoordinator 的装配面（review #3 结构拆分）：`new`/`with_l3_timeout`
//! 构造全部子能力（prompt_delivery/metadata/session/poll/closure/cancel/…）并
//! 组装 `CoordInner`。字段经 `pub(super)` 在 channel 模块内共享（结构拆分，
//! 行为语义不变）。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{Mutex, RwLock};

use crate::channel::command_coordinator::{
    CommandCoordinator, CoordInner, L3_TIMEOUT, SESSION_POLL_INTERVAL, SESSION_POLL_TIMEOUT,
};
use crate::channel::command_outcome_broker::CommandOutcomeBroker;
use crate::channel::elicitation_response::ElicitationResponse;
use crate::channel::mcp_control::McpControl;
use crate::channel::mcp_apps_control::McpAppsControl;
use crate::channel::metadata_command_processor::MetadataCommandProcessor;
use crate::channel::permission_resolution::PermissionResolution;
use crate::channel::prompt_delivery::{PromptDelivery, PromptDeliveryDeps};
use crate::channel::prompt_recovery::PromptRecovery;
use crate::channel::relay_event_handler::RelayEventHandler;
use crate::channel::runtime_closure::RuntimeClosure;
use crate::channel::runtime_creation::{
    RuntimeCreation, RuntimeCreationConfig, RuntimeCreationDeps,
};
use crate::channel::session_catalog_sync::{SessionCatalogConfig, SessionCatalogSync};
use crate::channel::session_configuration::SessionConfiguration;
use crate::channel::session_discovery::{SessionDiscovery, SessionDiscoveryConfig};
use crate::channel::session_rewind::{SessionRewindExecution, SessionRewindQueries};
use crate::channel::session_runtime_operations::{SessionRuntimeConfig, SessionRuntimeOperations};
use crate::channel::turn_cancellation::TurnCancellation;
use crate::channel::workspace_compatibility::WorkspaceCompatibility;
use crate::control::{ChatRegistry, InstanceRegistry, ProjectService, WorkspaceRegistry, StoreSink};
use crate::persist::Store;
use crate::protocol::Translator;
use crate::state::doc_manager::{BatchConfig, DocManager};

impl CommandCoordinator {
    /// 装配（hub 调用；`default_cwd` = 进程工作目录，§4.3 裁决；
    /// `acp_cmd` = ACP 启动命令，默认 `["peri","acp"]`，§11）。
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        store: Arc<Store>,
        doc: Arc<DocManager>,
        instance: Arc<InstanceRegistry>,
        chats: ChatRegistry,
        relay: Arc<RelayEventHandler>,
        sink: Arc<StoreSink>,
        cfg: &BatchConfig,
        acp_cmd: Vec<String>,
        spawn_timeout: Duration,
        initialize_timeout: Duration,
        binding_timeout: Duration,
    ) -> Self {
        Self::with_l3_timeout(
            store,
            doc,
            instance,
            chats,
            relay,
            sink,
            cfg,
            acp_cmd,
            spawn_timeout,
            initialize_timeout,
            binding_timeout,
            L3_TIMEOUT,
        )
    }

    /// 带 L3 超时参数的装配（测试注入短值）。
    #[allow(clippy::too_many_arguments)]
    pub fn with_l3_timeout(
        store: Arc<Store>,
        doc: Arc<DocManager>,
        instance: Arc<InstanceRegistry>,
        chats: ChatRegistry,
        relay: Arc<RelayEventHandler>,
        sink: Arc<StoreSink>,
        cfg: &BatchConfig,
        acp_cmd: Vec<String>,
        spawn_timeout: Duration,
        initialize_timeout: Duration,
        binding_timeout: Duration,
        l3_timeout: Duration,
    ) -> Self {
        let default_cwd = std::env::current_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| "/".to_string());
        let translator = Arc::new(Translator::new());
        let projects = Arc::new(RwLock::new(None));
        let prompt_delivery = PromptDelivery::new(
            PromptDeliveryDeps {
                store: store.clone(),
                doc: doc.clone(),
                instance: instance.clone(),
                chats: chats.clone(),
                relay: relay.clone(),
                translator: translator.clone(),
                projects: projects.clone(),
            },
            l3_timeout,
        );
        let metadata_commands = MetadataCommandProcessor::new(projects.clone(), chats.clone());
        let workspaces = WorkspaceRegistry::new(chats.registry());
        let workspace_compatibility =
            WorkspaceCompatibility::new(projects.clone(), workspaces.clone());
        let session_discovery = SessionDiscovery::new(
            chats.clone(),
            instance.clone(),
            relay.clone(),
            translator.clone(),
            projects.clone(),
            SessionDiscoveryConfig {
                acp_cmd: acp_cmd.clone(),
                spawn_timeout,
                initialize_timeout,
                list_timeout: SESSION_POLL_TIMEOUT,
            },
        );
        let session_catalog = SessionCatalogSync::new(
            chats.clone(),
            instance.clone(),
            relay.clone(),
            translator.clone(),
            projects.clone(),
            SessionCatalogConfig {
                poll_interval: SESSION_POLL_INTERVAL,
                request_timeout: SESSION_POLL_TIMEOUT,
            },
        );
        let mcp_control = McpControl::new(
            chats.clone(),
            instance.clone(),
            relay.clone(),
            translator.clone(),
            SESSION_POLL_TIMEOUT,
        );
        let mcp_apps_control = McpAppsControl::new(
            chats.clone(),
            instance.clone(),
            relay.clone(),
            translator.clone(),
            sink.clone(),
            SESSION_POLL_TIMEOUT,
        );
        let session_configuration = SessionConfiguration::new(
            chats.clone(),
            doc.clone(),
            instance.clone(),
            relay.clone(),
            translator.clone(),
            SESSION_POLL_TIMEOUT,
        );
        let session_rewind = SessionRewindQueries::new(
            chats.clone(),
            instance.clone(),
            relay.clone(),
            translator.clone(),
            SESSION_POLL_TIMEOUT,
        );
        let session_operations = SessionRuntimeOperations::new(
            chats.clone(),
            doc.clone(),
            instance.clone(),
            relay.clone(),
            translator.clone(),
            SessionRuntimeConfig {
                load_timeout: SESSION_POLL_TIMEOUT,
                new_timeout: binding_timeout,
            },
        );
        let rewind_execution =
            SessionRewindExecution::new(session_rewind.clone(), session_operations.clone());
        let permission_resolution = PermissionResolution::new(
            store.clone(),
            doc.clone(),
            chats.clone(),
            relay.clone(),
            instance.clone(),
            translator.clone(),
            l3_timeout,
        );
        let elicitation_response = ElicitationResponse::new(
            store.clone(),
            doc.clone(),
            chats.clone(),
            relay.clone(),
            instance.clone(),
        );
        let runtime_closure =
            RuntimeClosure::new(store.clone(), doc.clone(), instance.clone(), chats.clone());
        let turn_cancellation = TurnCancellation::new(
            store.clone(),
            doc.clone(),
            instance.clone(),
            chats.clone(),
            translator.clone(),
        );
        let runtime_creation = RuntimeCreation::new(
            RuntimeCreationDeps {
                store: store.clone(),
                doc: doc.clone(),
                instance: instance.clone(),
                chats: chats.clone(),
                workspaces: workspaces.clone(),
                relay: relay.clone(),
                translator: translator.clone(),
            },
            RuntimeCreationConfig {
                default_cwd: default_cwd.clone(),
                queue_cap: cfg.chat_queue,
                acp_cmd: acp_cmd.clone(),
                spawn_timeout,
                initialize_timeout,
                binding_timeout,
            },
        );
        let outcome_broker = CommandOutcomeBroker::new(store.clone(), chats.clone());
        CommandCoordinator {
            inner: Arc::new(CoordInner {
                gate: Mutex::new(()),
                store,
                doc,
                // Hub startup and legacy mutations rebuild through the same
                // compatibility owner, while RuntimeCreation uses a clone of
                // the underlying process-local workspace index.
                workspace_compatibility,
                queue_cap: cfg.chat_queue,
                executors: RwLock::new(HashMap::new()),
                session_operations,
                permission_resolution,
                elicitation_response,
                runtime_closure,
                turn_cancellation,
                prompt_delivery,
                runtime_creation,
                metadata_commands,
                session_discovery,
                session_catalog,
                session_configuration,
                session_rewind,
                rewind_execution,
                mcp_control,
                mcp_apps_control,
                projects,
                history_sink: RwLock::new(None),
                outcome_broker,
            }),
        }
    }

    pub async fn install_project_service(&self, projects: ProjectService) {
        self.inner
            .mcp_control
            .install_metadata(projects.metadata().clone())
            .await;
        self.inner
            .session_configuration
            .install_metadata(projects.metadata().clone())
            .await;
        self.inner
            .rewind_execution
            .install_metadata(projects.metadata().clone())
            .await;
        *self.inner.projects.write().await = Some(projects);
    }

    pub async fn install_history_sink(&self, sink: Arc<crate::control::StoreSink>) {
        *self.inner.history_sink.write().await = Some(sink);
    }

    /// 工作区注册表（hub 装配：启动恢复重建）。
    pub async fn rebuild_workspaces(&self) {
        self.inner.workspace_compatibility.rebuild().await;
    }

    /// create 全局去重索引重建（§4.4：跨 server 重启有效——启动时从 outbox
    /// 重放重建）。hub 装配时（store.recover 完成后）调用一次。
    pub async fn rebuild_create_index(&self) {
        self.inner.runtime_creation.rebuild_index().await;
    }

    /// Reconcile prompt outbox and exact v2 chat projection evidence before
    /// the gateway accepts clients. This is the only startup point where both
    /// durable stores are available; process-local watchers/executors do not
    /// participate in the decision.
    pub async fn reconcile_prompt_delivery_after_restart(&self) -> Result<(), String> {
        let Some(projects) = self.inner.projects.read().await.clone() else {
            return Err("project catalog unavailable during prompt reconciliation".into());
        };
        PromptRecovery::new(
            self.inner.store.clone(),
            projects,
            self.inner.history_sink.read().await.clone(),
        )
        .reconcile_after_restart()
        .await
        .map_err(|error| error.to_string())
    }

    pub fn spawn_session_poller(&self) {
        self.inner.session_catalog.spawn_poller();
    }
}

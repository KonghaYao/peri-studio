//! Complete lifecycle owner for ACP runtime creation.
//!
//! A create spans Hub files, an instance child and (for `session/new`) a
//! durable ACP thread. This module serializes the operation, prepares local
//! state, crosses each durable delivery barrier, binds the resulting ACP
//! session, and publishes exactly one terminal verdict through a narrow port.
//! It also owns the only decision that may clear a create no-redelivery
//! barrier: cleanup must be proven, otherwise the result fails closed.
//!
//! # 拆分说明（结构拆分，行为不变）
//!
//! 本文件原超过 500 行，按主题拆为四个文件（同一 `impl RuntimeCreation`
//! 分散定义，均注册于 `channel/mod.rs`）：
//!
//! - 本文件：类型定义、装配入口（`new`/`enqueue`/索引）与 `prepare`/`execute`
//!   公共面；
//! - `runtime_creation_exec.rs`：`execute_inner` 串行执行主路径 + `fail` 出口；
//! - `runtime_creation_bind.rs`：`bind_session`（session/load 与 session/new
//!   双路径的 ACP 会话绑定与投影提交）；
//! - `runtime_creation_cleanup.rs`：`adjudicate` 失败裁决、本地回滚原语与
//!   纯辅助函数。
//!
//! 对外 pub 面（`coordinator_assembly` 等调用方）保持不变。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use peri_studio_proto::ack::ErrorCode;
use peri_studio_proto::action::CreateChatPayload;
use tokio::sync::{mpsc, RwLock};
use tracing::{debug, warn};
use uuid::Uuid;

use crate::channel::command_coordinator::{extract_command_id, ExecCmd};
use crate::channel::relay_event_handler::RelayEventHandler;
use crate::channel::DEFAULT_INSTANCE_ID;
use crate::control::{ChatRegistry, InstanceRegistry, WorkspaceRegistry};
use crate::persist::{ChatStore, Store};
use crate::protocol::{validate_cwd, Translator};
use crate::state::doc_manager::DocManager;

#[derive(Clone)]
pub(super) struct RuntimeCreation {
    // 字段 `pub(super)`：拆分子模块（exec/bind/cleanup）的同一 impl 块
    // 需要访问（crate 外 pub 面不变）。
    pub(super) store: Arc<Store>,
    pub(super) doc: Arc<DocManager>,
    pub(super) instance: Arc<InstanceRegistry>,
    pub(super) chats: ChatRegistry,
    pub(super) workspaces: WorkspaceRegistry,
    pub(super) default_cwd: String,
    pub(super) command_index: Arc<RwLock<HashMap<Uuid, Uuid>>>,
    pub(super) queue_cap: usize,
    pub(super) queue_tx: Arc<RwLock<Option<mpsc::Sender<ExecCmd>>>>,
    pub(super) relay: Arc<RelayEventHandler>,
    pub(super) translator: Arc<Translator>,
    pub(super) acp_cmd: Vec<String>,
    pub(super) spawn_timeout: Duration,
    pub(super) initialize_timeout: Duration,
    pub(super) binding_timeout: Duration,
}

pub(super) struct RuntimeCreationDeps {
    pub store: Arc<Store>,
    pub doc: Arc<DocManager>,
    pub instance: Arc<InstanceRegistry>,
    pub chats: ChatRegistry,
    pub workspaces: WorkspaceRegistry,
    pub relay: Arc<RelayEventHandler>,
    pub translator: Arc<Translator>,
}

pub(super) struct RuntimeCreationConfig {
    pub default_cwd: String,
    pub queue_cap: usize,
    pub acp_cmd: Vec<String>,
    pub spawn_timeout: Duration,
    pub initialize_timeout: Duration,
    pub binding_timeout: Duration,
}

#[derive(Clone, Copy)]
pub(super) enum CreateFailureBoundary {
    /// No external runtime can exist.
    LocalOnly,
    /// A runtime may exist, but no non-idempotent ACP session operation began.
    RuntimeCleanupRequired,
    /// `session/new` may have entered ACP. Killing the child cannot erase the
    /// durable thread and therefore can never authorize automatic retry.
    DurableSessionUnknown,
}

pub(super) struct CreateFailureRequest<'a> {
    pub(super) chat_id: &'a str,
    pub(super) instance_id: &'a str,
    pub(super) command_id: Uuid,
    pub(super) code: ErrorCode,
    pub(super) message: &'a str,
    pub(super) boundary: CreateFailureBoundary,
}

#[derive(Debug)]
pub(super) struct CreateTerminal {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
}

#[async_trait]
pub(super) trait RuntimeCreationTerminalPort: Send + Sync {
    async fn error(&self, command: &ExecCmd, terminal: CreateTerminal);
    async fn committed(&self, command: &ExecCmd, chat_id: &str);
}

pub(super) struct SessionBindingRun<'a> {
    pub(super) command: &'a ExecCmd,
    pub(super) command_id: Uuid,
    pub(super) command_id_text: &'a str,
    pub(super) chat_id: &'a str,
    pub(super) instance_id: &'a str,
    pub(super) cwd: &'a str,
    pub(super) payload: &'a CreateChatPayload,
    pub(super) store: Arc<ChatStore>,
}

impl RuntimeCreation {
    pub fn new(deps: RuntimeCreationDeps, config: RuntimeCreationConfig) -> Self {
        Self {
            store: deps.store,
            doc: deps.doc,
            instance: deps.instance,
            chats: deps.chats,
            workspaces: deps.workspaces,
            default_cwd: config.default_cwd,
            command_index: Arc::new(RwLock::new(HashMap::new())),
            queue_cap: config.queue_cap,
            queue_tx: Arc::new(RwLock::new(None)),
            relay: deps.relay,
            translator: deps.translator,
            acp_cmd: config.acp_cmd,
            spawn_timeout: config.spawn_timeout,
            initialize_timeout: config.initialize_timeout,
            binding_timeout: config.binding_timeout,
        }
    }

    pub async fn enqueue(
        &self,
        command: ExecCmd,
        terminal: Arc<dyn RuntimeCreationTerminalPort>,
    ) -> bool {
        // Installation is protected by one write guard. Concurrent first
        // submissions therefore cannot create independent serial workers.
        let tx = {
            let mut queue = self.queue_tx.write().await;
            match queue.as_ref() {
                Some(tx) => tx.clone(),
                None => {
                    let (tx, mut rx) = mpsc::channel(self.queue_cap);
                    let runtime = self.clone();
                    tokio::spawn(async move {
                        while let Some(command) = rx.recv().await {
                            runtime.execute(command, terminal.as_ref()).await;
                        }
                    });
                    *queue = Some(tx.clone());
                    tx
                }
            }
        };
        tx.send(command).await.is_ok()
    }

    pub async fn rebuild_index(&self) {
        let mut recovered = HashMap::new();
        for (chat_id, store) in self.store.chats_snapshot() {
            for record in store.outbox_records().await {
                if record.command_type == crate::persist::outbox::CommandType::Create {
                    recovered.insert(record.command_id, chat_id);
                }
            }
        }
        let mut index = self.command_index.write().await;
        for (command_id, chat_id) in recovered {
            index.entry(command_id).or_insert(chat_id);
        }
    }

    pub async fn chat_for_command(&self, command_id: Uuid) -> Option<Uuid> {
        self.command_index.read().await.get(&command_id).copied()
    }

    pub async fn register_command(&self, command_id: Uuid, chat_id: Uuid) {
        self.command_index.write().await.insert(command_id, chat_id);
    }

    /// Prepare one Hub chat before any instance side effect. Every partial
    /// local allocation is rolled back in reverse ownership order.
    pub async fn prepare(&self, payload: &CreateChatPayload) -> Result<Uuid, CreateTerminal> {
        let chat_id = Uuid::new_v4();
        let instance_id = payload
            .instance_id
            .clone()
            .unwrap_or_else(|| DEFAULT_INSTANCE_ID.to_string());
        let cwd = match &payload.workspace_id {
            Some(workspace_id) => self
                .workspaces
                .get(workspace_id)
                .await
                .map(|workspace| workspace.cwd)
                .ok_or_else(|| CreateTerminal {
                    code: ErrorCode::InvalidState,
                    message: format!("workspace not found: {workspace_id}"),
                    retryable: false,
                })?,
            None => match &payload.cwd {
                Some(cwd) if !cwd.trim().is_empty() => {
                    validate_cwd(cwd).map_err(|error| CreateTerminal {
                        code: ErrorCode::InvalidState,
                        message: format!("invalid cwd: {error}"),
                        retryable: false,
                    })?;
                    cwd.clone()
                }
                _ => self.default_cwd.clone(),
            },
        };
        let title = payload
            .title
            .clone()
            .filter(|title| !title.trim().is_empty())
            .unwrap_or_else(|| format!("会话 {}", &chat_id.to_string()[..8]));

        self.store.create_chat(chat_id).map_err(|error| {
            warn!(?error, "create chat store failed");
            CreateTerminal {
                code: ErrorCode::AgentUnavailable,
                message: "chat store create failed".into(),
                retryable: true,
            }
        })?;
        if let Err(error) = self
            .doc
            .open_chat(
                &chat_id.to_string(),
                &instance_id,
                Some(&title),
                Some(&cwd),
                payload.workspace_id.as_deref(),
            )
            .await
        {
            warn!(%chat_id, ?error, "open chat failed");
            let _ = self.store.remove_chat(chat_id);
            return Err(CreateTerminal {
                code: ErrorCode::AgentUnavailable,
                message: "chat doc open failed".into(),
                retryable: true,
            });
        }
        if let Err(error) = self
            .chats
            .register(
                &chat_id.to_string(),
                &instance_id,
                Some(&title),
                &cwd,
                payload.workspace_id.as_deref(),
            )
            .await
        {
            warn!(%chat_id, ?error, "chat register failed");
            self.rollback_prepared(&chat_id.to_string()).await;
            return Err(CreateTerminal {
                code: ErrorCode::AgentUnavailable,
                message: "chat register failed".into(),
                retryable: true,
            });
        }
        Ok(chat_id)
    }

    pub async fn execute(&self, command: ExecCmd, terminal: &dyn RuntimeCreationTerminalPort) {
        let started = std::time::Instant::now();
        self.execute_inner(&command, terminal).await;
        self.doc.release_reserve(&command.chat_id).await;
        debug!(
            chat_id = command.chat_id,
            command_id = extract_command_id(&command.action).unwrap_or_default(),
            elapsed_ms = started.elapsed().as_millis() as u64,
            "create command executed"
        );
    }
}

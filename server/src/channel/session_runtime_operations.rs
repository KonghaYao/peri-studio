//! Live ACP session operations for an existing runtime chat.
//!
//! This module owns the shared per-chat lease, replay-before-response ordering,
//! binding rollback and the non-idempotent `session/new` delivery boundary.
//!
//! 结构拆分（review #2/#5）：租赁与准备（本文件）与 RPC 执行段
//! （`session_runtime_execution.rs`：execute_load/execute_new）及重启恢复
//! （`session_resume.rs`）分离；字段经 `pub(super)` 在 channel 模块内共享。

use std::collections::HashSet;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use tokio::sync::OwnedMutexGuard;

use peri_studio_proto::ack::ErrorCode;

use crate::channel::relay_event_handler::RelayEventHandler;
use crate::control::{ChatRegistry, InstanceRegistry};
use crate::protocol::Translator;
use crate::state::doc_manager::DocManager;

#[derive(Clone)]
pub(super) struct SessionRuntimeOperations {
    pub(super) chats: ChatRegistry,
    pub(super) doc: Arc<DocManager>,
    pub(super) instance: Arc<InstanceRegistry>,
    pub(super) relay: Arc<RelayEventHandler>,
    pub(super) translator: Arc<Translator>,
    pub(super) load_timeout: Duration,
    pub(super) new_timeout: Duration,
    flights: Arc<StdMutex<HashSet<String>>>,
}

pub(super) struct SessionRuntimeConfig {
    pub load_timeout: Duration,
    pub new_timeout: Duration,
}

pub(super) struct SessionOperationRun {
    operations: SessionRuntimeOperations,
    chat_id: String,
    instance_id: String,
    cwd: String,
    kind: OperationKind,
    _lease: SessionOperationLease,
    /// P0（review #1）：与 prompt dispatch（prompt_delivery）共享的
    /// `runtime_transition_guard` 互斥域——load/new 从 `prepare` 起全程持有，
    /// 覆盖「active_turn 检查 → switch_session → session/load RPC → 回放窗口」
    /// 全程；prompt 在 load 在途时无法读取/翻译 binding，反之亦然（杜绝
    /// 用户消息在会话切换窗口内投递到错误 ACP 会话）。
    _runtime_guard: OwnedMutexGuard<()>,
}

enum OperationKind {
    Load {
        command_id: String,
        target_session_id: String,
        previous_session_id: String,
    },
    New {
        command_id: String,
    },
}

pub(super) enum SessionOperationOutcome {
    Loaded {
        chat_id: String,
    },
    Created {
        chat_id: String,
        acp_session_id: String,
    },
}

#[derive(Debug)]
pub(super) struct SessionOperationFailure {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    pub audit_outcome: &'static str,
}

#[derive(Clone, Copy)]
enum OperationName {
    Load,
    New,
}

struct SessionOperationLease {
    flights: Arc<StdMutex<HashSet<String>>>,
    chat_id: String,
}

impl Drop for SessionOperationLease {
    fn drop(&mut self) {
        self.flights
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&self.chat_id);
    }
}

impl SessionRuntimeOperations {
    pub fn new(
        chats: ChatRegistry,
        doc: Arc<DocManager>,
        instance: Arc<InstanceRegistry>,
        relay: Arc<RelayEventHandler>,
        translator: Arc<Translator>,
        config: SessionRuntimeConfig,
    ) -> Self {
        Self {
            chats,
            doc,
            instance,
            relay,
            translator,
            load_timeout: config.load_timeout,
            new_timeout: config.new_timeout,
            flights: Arc::new(StdMutex::new(HashSet::new())),
        }
    }

    pub async fn start_load(
        &self,
        command_id: &str,
        chat_id: &str,
        target_session_id: &str,
    ) -> Result<SessionOperationRun, SessionOperationFailure> {
        let (record, lease, runtime_guard) = self.prepare(chat_id, OperationName::Load).await?;
        Ok(SessionOperationRun {
            operations: self.clone(),
            chat_id: chat_id.to_string(),
            instance_id: record.instance_id,
            cwd: record.cwd,
            kind: OperationKind::Load {
                command_id: command_id.to_string(),
                target_session_id: target_session_id.to_string(),
                previous_session_id: record
                    .session_id
                    .expect("prepare requires an active ACP session"),
            },
            _lease: lease,
            _runtime_guard: runtime_guard,
        })
    }

    pub async fn start_new(
        &self,
        command_id: &str,
        chat_id: &str,
    ) -> Result<SessionOperationRun, SessionOperationFailure> {
        let (record, lease, runtime_guard) = self.prepare(chat_id, OperationName::New).await?;
        Ok(SessionOperationRun {
            operations: self.clone(),
            chat_id: chat_id.to_string(),
            instance_id: record.instance_id,
            cwd: record.cwd,
            kind: OperationKind::New {
                command_id: command_id.to_string(),
            },
            _lease: lease,
            _runtime_guard: runtime_guard,
        })
    }

    async fn prepare(
        &self,
        chat_id: &str,
        operation: OperationName,
    ) -> Result<
        (
            crate::control::ChatRecord,
            SessionOperationLease,
            OwnedMutexGuard<()>,
        ),
        SessionOperationFailure,
    > {
        let Some(record) = self.chats.entry(chat_id).await else {
            return Err(failure(
                ErrorCode::ChatNotFound,
                "chat not found",
                false,
                "chat_not_found",
            ));
        };
        if record.state.is_terminal() {
            return Err(failure(
                ErrorCode::InvalidState,
                match operation {
                    OperationName::Load => "chat terminal; cannot load session",
                    OperationName::New => "chat terminal; cannot create session",
                },
                false,
                "terminal_chat",
            ));
        }
        if record.session_id.is_none() {
            return Err(failure(
                ErrorCode::InvalidState,
                "chat has no active ACP process",
                false,
                "missing_runtime",
            ));
        }
        // 本操作域的串行化（flights lease，同步检查）：同 chat 并发
        // load/new 立即 RateLimited，不等前一个操作完成（既有语义——
        // 两个 ACP 会话变更不得交错改写 binding 与 replay 投影）。
        // 块作用域：StdMutexGuard 非 Send，须在首个 await 前释放。
        {
            let mut flights = self
                .flights
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if !flights.insert(chat_id.to_string()) {
                return Err(failure(
                    ErrorCode::RateLimited,
                    match operation {
                        OperationName::Load => "session load already in progress",
                        OperationName::New => "session operation already in progress",
                    },
                    true,
                    "already_in_progress",
                ));
            }
        }
        // P0（review #1）：与 prompt dispatch / session_configuration 同一互斥
        // 域——guard 获取后持有到 SessionOperationRun 结束，顺序与
        // prompt_delivery 一致（先 guard 后 active_turn，避免死锁）。
        let runtime_guard = self.chats.runtime_transition_guard(chat_id).await;
        if self.chats.active_turn(chat_id).await.is_some() {
            // 失败路径须释放已插入的 flights 条目（与 lease Drop 对称）。
            self.flights
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .remove(chat_id);
            return Err(failure(
                ErrorCode::InvalidState,
                match operation {
                    OperationName::Load => "chat has an active turn; cannot switch session",
                    OperationName::New => "chat has an active turn; cannot create session",
                },
                false,
                "active_turn",
            ));
        }
        Ok((
            record,
            SessionOperationLease {
                flights: self.flights.clone(),
                chat_id: chat_id.to_string(),
            },
            runtime_guard,
        ))
    }
}

impl SessionOperationRun {
    pub async fn execute(self) -> Result<SessionOperationOutcome, SessionOperationFailure> {
        match &self.kind {
            OperationKind::Load {
                command_id,
                target_session_id,
                previous_session_id,
            } => {
                self.operations
                    .execute_load(
                        command_id,
                        &self.chat_id,
                        &self.instance_id,
                        &self.cwd,
                        target_session_id,
                        previous_session_id,
                    )
                    .await
            }
            OperationKind::New { command_id } => {
                self.operations
                    .execute_new(command_id, &self.chat_id, &self.instance_id, &self.cwd)
                    .await
            }
        }
    }
}

fn failure(
    code: ErrorCode,
    message: impl Into<String>,
    retryable: bool,
    audit_outcome: &'static str,
) -> SessionOperationFailure {
    SessionOperationFailure {
        code,
        message: message.into(),
        retryable,
        audit_outcome,
    }
}

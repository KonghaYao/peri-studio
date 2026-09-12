//! CommandCoordinator 的队列面提交（review #3 结构拆分）：submit 双入口之
//! 二——「gate 锁内去重 → try_reserve → outbox.insert → mark_accepted →
//! 入队执行器」同临界区（§7.4 规则 6，**核心纪律，不得拆锁**）；含
//! per-chat 有界执行器（lazy spawn；普通 FIFO，active prompt 期间优先消费
//! cancel）与入队 closed-tx 一次重试（review #20）。

use std::sync::Arc;

use tokio::sync::mpsc;
use tracing::warn;

use peri_studio_proto::ack::ErrorCode;
use peri_studio_proto::action::{ActionEnvelope, CreateChatPayload};
use peri_studio_proto::frame::Frame;

use crate::auth::audit::audit;
use crate::auth::ConnectionCtx;
use crate::channel::broadcaster::OutboundMsg;
use crate::channel::command_coordinator::{CommandCoordinator, ExecCmd, SubmitAck};
use crate::channel::command_identity::prompt_payload_fingerprint;
use crate::channel::command_outcome_broker::{ExistingCommandDisposition, ExistingCommandRequest};
use crate::channel::coordinator_helpers::{
    action_error, command_type_of, extract_chat_id, extract_command_id,
    preempts_active_prompt_delivery, submit_ack_from_existing,
};
use crate::persist::outbox::{CommandType, LastError, NewOutboxRecord};
use crate::state::doc_manager::DocManager;

impl CommandCoordinator {
    /// 队列面提交（§7.4 规则 6）：临界区内 去重判定 → try_reserve → 入队。
    /// `command_id_str` 已由 submit 入口校验（uuid 形态）。
    pub(super) async fn submit_queued_action(
        &self,
        ctx: &ConnectionCtx,
        action: ActionEnvelope,
        tx: mpsc::Sender<OutboundMsg>,
        command_id_str: &str,
    ) -> SubmitAck {
        let command_id =
            uuid::Uuid::parse_str(command_id_str).expect("submit entry validated commandId shape");
        let _guard = self.inner.gate.lock().await;

        // ---- 1. chat_id 解析 / create 前置（§6.2）----
        let chat_id: uuid::Uuid = match &action {
            ActionEnvelope::Create { payload, .. } => {
                // create：server 生成新 chat_id（§6.2 server 生成 id 的
                // 唯一告知路径）。客户端重发同 commandId 时无法指定
                // chat_id——先按 commandId 全局去重（§4.4：committed →
                // duplicate，不重复调用 Agent；索引启动时从 outbox 重建，
                // 跨 server 重启有效）。
                if let Some(sid) = self
                    .inner
                    .runtime_creation
                    .chat_for_command(command_id)
                    .await
                {
                    let sid_text = sid.to_string();
                    match self
                        .inner
                        .outcome_broker
                        .adjudicate_existing(ExistingCommandRequest {
                            chat_id: sid,
                            command_id,
                            command_id_text: command_id_str,
                            action: &action,
                            observer: tx.clone(),
                            duplicate_chat_id: Some(&sid_text),
                        })
                        .await
                    {
                        ExistingCommandDisposition::Missing
                        | ExistingCommandDisposition::ProceedNew => {}
                        ExistingCommandDisposition::ResumePermission => {
                            unreachable!("create commands cannot resume permission recovery")
                        }
                        ExistingCommandDisposition::ResumeElicitation => {
                            unreachable!("create commands cannot resume elicitation recovery")
                        }
                        ExistingCommandDisposition::Respond(response) => {
                            return submit_ack_from_existing(response)
                        }
                    }
                }
                match self.prepare_create(payload, command_id_str).await {
                    Ok(sid) => {
                        // 登记全局 create 索引（重发去重，§4.4）。
                        self.inner
                            .runtime_creation
                            .register_command(command_id, sid)
                            .await;
                        sid
                    }
                    Err(ack) => return ack,
                }
            }
            other => match extract_chat_id(other) {
                Some(sid) => match uuid::Uuid::parse_str(&sid) {
                    Ok(id) => id,
                    Err(_) => {
                        return SubmitAck::Failed(action_error(
                            command_id_str.to_string(),
                            ErrorCode::InvalidState,
                            "invalid chatId (uuid expected)",
                            false,
                        ))
                    }
                },
                None => {
                    return SubmitAck::Failed(action_error(
                        command_id_str.to_string(),
                        ErrorCode::InvalidState,
                        "missing chatId",
                        false,
                    ))
                }
            },
        };

        let chat_id_str = chat_id.to_string();
        let store = match self.inner.store.chat(chat_id) {
            Some(s) => s,
            None => {
                return SubmitAck::Failed(action_error(
                    command_id_str.to_string(),
                    ErrorCode::ChatNotFound,
                    "chat not found",
                    false,
                ))
            }
        };

        // ---- 2. 去重判定（outbox 记录，§4.4）----
        let resume_recovery = match self
            .inner
            .outcome_broker
            .adjudicate_existing(ExistingCommandRequest {
                chat_id,
                command_id,
                command_id_text: command_id_str,
                action: &action,
                observer: tx.clone(),
                duplicate_chat_id: None,
            })
            .await
        {
            ExistingCommandDisposition::Missing | ExistingCommandDisposition::ProceedNew => false,
            ExistingCommandDisposition::ResumePermission
            | ExistingCommandDisposition::ResumeElicitation => true,
            ExistingCommandDisposition::Respond(response) => {
                return submit_ack_from_existing(response)
            }
        };

        // ---- 3. 入队上限（§7.4 规则 6：同一临界区）----
        if !self.inner.doc.try_reserve(&chat_id_str).await {
            if matches!(action, ActionEnvelope::Create { .. }) {
                self.inner
                    .runtime_creation
                    .rollback_prepared(&chat_id_str)
                    .await;
            }
            return SubmitAck::Failed(action_error(
                command_id_str.to_string(),
                ErrorCode::RateLimited,
                "command queue full",
                false,
            ));
        }

        // ---- 4. outbox 记录（去重记录写入内存索引，§4.4）----
        let turn_id = match &action {
            ActionEnvelope::Prompt { .. } => Some(uuid::Uuid::new_v4()),
            _ => None,
        };
        let command_type = command_type_of(&action);
        let retryable_class = command_type.default_retryable_class();
        if !resume_recovery {
            if let Err(e) = store.outbox().lock().await.insert(NewOutboxRecord {
                command_id,
                chat_id,
                command_type,
                turn_id,
                retryable_class,
            }) {
                warn!(chat_id = %chat_id, command_id = %command_id, error = ?e, "outbox insert failed");
                self.inner.doc.release_reserve(&chat_id_str).await;
                if command_type == CommandType::Create {
                    self.inner
                        .runtime_creation
                        .rollback_prepared(&chat_id_str)
                        .await;
                }
                return SubmitAck::Failed(action_error(
                    command_id_str.to_string(),
                    ErrorCode::AgentUnavailable,
                    "outbox insert failed",
                    true,
                ));
            }
            // insert(received) → mark_accepted（同一临界区）：accepted Ack 语义
            // 与 outbox 状态机对齐（Received → Accepted → IntentDurable，§4.4；
            // 执行器 mark_intent_durable 要求前置 Accepted）。
            if let Err(e) = store.outbox().lock().await.mark_accepted(command_id) {
                warn!(chat_id = %chat_id, command_id = %command_id, error = ?e, "outbox mark_accepted failed");
                let _ = store.outbox().lock().await.mark_failed(
                    command_id,
                    LastError::from_error_code(ErrorCode::AgentUnavailable),
                );
                self.inner.doc.release_reserve(&chat_id_str).await;
                if command_type == CommandType::Create {
                    self.inner
                        .runtime_creation
                        .rollback_prepared(&chat_id_str)
                        .await;
                }
                return SubmitAck::Failed(action_error(
                    command_id_str.to_string(),
                    ErrorCode::AgentUnavailable,
                    "outbox mark_accepted failed",
                    false,
                ));
            }
            if let ActionEnvelope::Prompt { payload, .. } = &action {
                let fingerprint = match prompt_payload_fingerprint(payload) {
                    Ok(value) => value,
                    Err(error) => {
                        let _ = store.outbox().lock().await.mark_failed(
                            command_id,
                            LastError::from_error_code(ErrorCode::InvalidState),
                        );
                        self.inner.doc.release_reserve(&chat_id_str).await;
                        return SubmitAck::Failed(action_error(
                            command_id_str.to_string(),
                            ErrorCode::InvalidState,
                            &format!("prompt fingerprint failed: {error}"),
                            false,
                        ));
                    }
                };
                if let Err(error) = store
                    .outbox()
                    .lock()
                    .await
                    .set_prompt_payload_fingerprint(command_id, fingerprint)
                {
                    warn!(chat_id = %chat_id, command_id = %command_id, error = ?error, "prompt fingerprint record failed");
                    let terminal_persisted = store
                        .outbox()
                        .lock()
                        .await
                        .mark_failed(
                            command_id,
                            LastError::from_error_code(ErrorCode::AgentUnavailable),
                        )
                        .is_ok();
                    if !terminal_persisted {
                        self.inner
                            .outcome_broker
                            .mark_terminal_state_unavailable()
                            .await;
                    }
                    self.inner.doc.release_reserve(&chat_id_str).await;
                    return SubmitAck::Failed(action_error(
                        command_id_str.to_string(),
                        if terminal_persisted {
                            ErrorCode::AgentUnavailable
                        } else {
                            ErrorCode::DeliveryUnknown
                        },
                        "prompt identity could not be durably established",
                        false,
                    ));
                }
            }
        }

        // ---- 5. 入队执行器（accepted 立即返回，§4.4）----
        let cmd = ExecCmd {
            ctx: ctx.clone(),
            chat_id: chat_id_str.clone(),
            action,
            tx,
        };
        let queued = if command_type == CommandType::Create {
            self.inner
                .runtime_creation
                .enqueue(cmd, Arc::new(self.clone()))
                .await
        } else {
            self.enqueue(chat_id_str.clone(), cmd).await
        };
        if !queued {
            // 入队失败（执行器已退出）：补偿释放名额（§7.4 reserve/release 配对）。
            let _ = store.outbox().lock().await.mark_failed(
                command_id,
                LastError::from_error_code(ErrorCode::RateLimited),
            );
            self.inner.doc.release_reserve(&chat_id_str).await;
            if command_type == CommandType::Create {
                self.inner
                    .runtime_creation
                    .rollback_prepared(&chat_id_str)
                    .await;
            }
            return SubmitAck::Failed(action_error(
                command_id_str.to_string(),
                ErrorCode::RateLimited,
                "executor queue full",
                false,
            ));
        }
        audit(
            "command.submit",
            Some(command_id_str),
            Some(&ctx.token_id),
            "ok",
            std::time::Duration::ZERO,
            None,
        );
        SubmitAck::Accepted {
            command_id: command_id_str.to_string(),
        }
    }

    /// Create preparation is owned by RuntimeCreation; this adapter only maps
    /// its terminal verdict into the coordinator submit contract.
    #[allow(clippy::result_large_err)]
    async fn prepare_create(
        &self,
        payload: &CreateChatPayload,
        command_id: &str,
    ) -> Result<uuid::Uuid, SubmitAck> {
        self.inner
            .runtime_creation
            .prepare(payload)
            .await
            .map_err(|terminal| {
                SubmitAck::Failed(action_error(
                    command_id.to_string(),
                    terminal.code,
                    &terminal.message,
                    terminal.retryable,
                ))
            })
    }

    /// 入队到 per-chat 执行器（lazy spawn，§7.4 规则 1 有界 FIFO）。
    async fn enqueue(&self, chat_id: String, cmd: ExecCmd) -> bool {
        if self.try_enqueue(&chat_id, cmd.clone()).await {
            return true;
        }
        // 一次重试（review #20）：executor 正常退出后至表项清理（executor_
        // loop 末尾 is_closed 检查）之间存在窗口，期间表项残留已关闭 tx——
        // 移除表项重建 channel 后重投一次；仍失败才返回 false（调用方
        // 补偿 mark_failed + release_reserve，无数据丢失）。
        self.inner.executors.write().await.remove(&chat_id);
        self.try_enqueue(&chat_id, cmd).await
    }

    async fn try_enqueue(&self, chat_id: &str, cmd: ExecCmd) -> bool {
        let tx = {
            let executors = self.inner.executors.read().await;
            executors.get(chat_id).cloned()
        };
        let tx = match tx {
            Some(tx) => tx,
            None => {
                let (tx, rx) = mpsc::channel(self.inner.queue_cap);
                let me = self.clone();
                let sid = chat_id.to_string();
                tokio::spawn(async move {
                    me.executor_loop(sid, rx).await;
                });
                self.inner
                    .executors
                    .write()
                    .await
                    .insert(chat_id.to_string(), tx.clone());
                tx
            }
        };
        tx.send(cmd).await.is_ok()
    }

    /// 执行器循环：普通命令按 chat FIFO；prompt 已登记 active turn 后，等待
    /// L3 期间继续读取同一有界队列，优先执行 cancel 与交互控制应答
    ///（question/elicitation/permission），其余命令保持原顺序延后。
    async fn executor_loop(&self, chat_id: String, mut rx: mpsc::Receiver<ExecCmd>) {
        let mut deferred = std::collections::VecDeque::new();
        loop {
            let cmd = match deferred.pop_front() {
                Some(cmd) => cmd,
                None => match rx.recv().await {
                    Some(cmd) => cmd,
                    None => break,
                },
            };
            let started = std::time::Instant::now();
            if matches!(cmd.action, ActionEnvelope::Prompt { .. }) {
                let (active_tx, mut active_rx) = tokio::sync::oneshot::channel();
                let prompt =
                    self.run_prompt_delivery_with_active_signal(&chat_id, &cmd, Some(active_tx));
                tokio::pin!(prompt);

                let active = tokio::select! {
                    _ = &mut prompt => None,
                    result = &mut active_rx => Some(result.is_ok()),
                };
                match active {
                    None => {}
                    Some(true) => {
                        if let Some(prompt_turn) =
                            self.inner.prompt_delivery.active_turn(&chat_id).await
                        {
                            loop {
                                tokio::select! {
                                    _ = &mut prompt => break,
                                    next = rx.recv() => match next {
                                        Some(cancel) if matches!(cancel.action, ActionEnvelope::Cancel { .. }) => {
                                            if self.inner.prompt_delivery.active_turn(&chat_id).await.as_deref()
                                                != Some(prompt_turn.as_str())
                                            {
                                                deferred.push_back(cancel);
                                                (&mut prompt).await;
                                                break;
                                            }
                                            let cancel_started = std::time::Instant::now();
                                            self.exec_cancel(&chat_id, &cancel).await;
                                            self.finish_execution(&chat_id, &cancel, cancel_started).await;
                                            if self.inner.prompt_delivery.active_turn(&chat_id).await.as_deref()
                                                != Some(prompt_turn.as_str())
                                            {
                                                (&mut prompt).await;
                                                break;
                                            }
                                        }
                                        Some(control) if preempts_active_prompt_delivery(&control.action) => {
                                            let control_started = std::time::Instant::now();
                                            self.exec_command(&chat_id, &control).await;
                                            self.finish_execution(&chat_id, &control, control_started).await;
                                        }
                                        Some(other) => deferred.push_back(other),
                                        None => {
                                            (&mut prompt).await;
                                            break;
                                        }
                                    },
                                }
                            }
                        } else {
                            prompt.await;
                        }
                    }
                    Some(false) => {
                        // Prompt 在 active-turn 注册前失败时 sender 随 request 被
                        // 丢弃；等待 lifecycle 完成后再释放 reserve。
                        prompt.await;
                    }
                }
            } else {
                self.exec_command(&chat_id, &cmd).await;
            }
            self.finish_execution(&chat_id, &cmd, started).await;
        }
        // 通道关闭：清理表项（防御；正常关闭路径由 hub 统一清理）。
        let mut executors = self.inner.executors.write().await;
        if let Some(tx) = executors.get(&chat_id) {
            if tx.is_closed() {
                executors.remove(&chat_id);
            }
        }
    }

    async fn finish_execution(&self, chat_id: &str, cmd: &ExecCmd, started: std::time::Instant) {
        self.inner.doc.release_reserve(&cmd.chat_id).await;
        tracing::debug!(
            chat_id,
            command_id = extract_command_id(&cmd.action).unwrap_or_default(),
            elapsed_ms = started.elapsed().as_millis() as u64,
            "command executed"
        );
    }
}

/// 依赖句柄引用（submit 入口与 executor 共享；DocManager 类型别名保持）。
#[allow(unused)]
fn _doc_anchor(_doc: &DocManager) {}

/// 队列面执行族入口（exec_command 在 queued_actions.rs 定义）。
#[allow(unused)]
fn _frame_anchor(_frame: &Frame) {}

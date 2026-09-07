//! 写者循环与 persist/广播提交（`doc_manager.rs` 拆分，§5.6/§7.4/§8.3）。
//!
//! 职责边界：每 chat 写者循环（[`chat_writer_loop`]，§7.4 单写者）与微批次
//! flush（[`flush_batch`]）、persist 落盘与广播（[`persist_and_broadcast`]/
//! [`broadcast_send`]）、gap 上报（[`report_gap`]）、全局 registry 写者
//! （[`registry_writer_loop`]）及其持久化（[`persist_registry_updates`]）。
//!
//! 拆分动机（结构拆分，行为不变）：原 `doc_manager.rs` 2014 行超限，按主题
//! 拆分——本文件承载「提交边界执行面」（唯一提交边界 §5.6 的落盘/广播侧）。

use std::sync::Arc;

use tokio::sync::{mpsc, oneshot, RwLock};
use tracing::{debug, trace, warn};

use peri_studio_proto::conn::DocId;
use yrs::{ReadTxn, StateVector, Transact};

use crate::state::aggregator::Aggregator;
use crate::state::doc_manager::{
    BatchConfig, ChatMsg, DocUpdate, SendSubscription, SubmitResult, UpdateSink, PERSIST_RETRY_MAX,
};
use crate::state::doc_manager_apply_event::read_session_active_turn;
use crate::state::doc_pair::DocPair;
use crate::state::normalized::{EventBody, NormalizedEvent};
use crate::state::registry::{DegradeCause, RegistryApplier, RegistryMsg, RegistryState};

use super::doc_manager_apply_command::apply_command;
use super::doc_manager_apply_event::{apply_event, report_projection_failure};

/// 每 chat 写者循环（§7.4 单写者：`&mut DocPair` 独占；§8.3 微批次）。
pub(crate) async fn chat_writer_loop(
    chat_id: String,
    mut rx: mpsc::Receiver<ChatMsg>,
    mut pair: DocPair,
    cfg: BatchConfig,
    sink: Arc<dyn UpdateSink>,
    broadcast: Arc<RwLock<Vec<mpsc::UnboundedSender<DocUpdate>>>>,
    registry: RegistryState,
) {
    // 观察回调：update 经 unbounded channel 送出（§6.4 同步回调不能 await）。
    let (chat_update_tx, mut chat_updates) = mpsc::unbounded_channel::<Vec<u8>>();
    let (control_update_tx, mut control_updates) = mpsc::unbounded_channel::<Vec<u8>>();
    // observe 注册失败 → 先上报 ProjectionError degraded（§17.2：writer
    // 无法观察 doc 即镜像必然失步），再 panic 终止 writer（防止误以为
    // 提交成功）。上报经 spawn 异步执行——panic 前调用方拿不到 await。
    let _sub_chat = SendSubscription(Some(
        pair.chat
            .observe_update_v1(move |_, e| {
                let _ = chat_update_tx.send(e.update.clone());
            })
            .unwrap_or_else(|e| {
                report_projection_failure(&registry);
                panic!("chat observe_update failed: {e}")
            }),
    ));
    let _sub_control = SendSubscription(Some(
        pair.session
            .observe_update_v1(move |_, e| {
                let _ = control_update_tx.send(e.update.clone());
            })
            .unwrap_or_else(|e| {
                report_projection_failure(&registry);
                panic!("control observe_update failed: {e}")
            }),
    ));

    let mut agg = Aggregator;
    // 微批次缓冲：仅 delta 类事件（§8.3）。
    let mut batch: Vec<(NormalizedEvent, Option<oneshot::Sender<SubmitResult>>)> = Vec::new();
    let mut batch_bytes = 0usize;
    // persist 失败重试缓冲（§8.4）：失败 update 不广播不丢弃，随下次
    // flush/apply 重投；成功才广播（客户端不得先于镜像看到状态）。
    let mut persist_retry: Vec<DocUpdate> = Vec::new();

    // 初始化全量基线投递（chat → session 顺序，§6.4）：Factory 结构初始化
    // 发生在 observe 订阅之前（open_chat），其 update 不会经回调产生——
    // 不下发则镜像（StoreSink）缺少 doc 基线，后续增量（pv
    // 覆盖写等带 origin 的更新）无法应用。全量基线 + 增量幂等（重复应用
    // 无害）。基线投递失败与增量同语义：进重试缓冲（§8.4），否则镜像
    // 缺依赖进 pending 永不满足。
    {
        let init_chat = pair
            .chat
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        if let Err(e) = sink
            .persist_update(DocId::chat(&chat_id), init_chat.clone())
            .await
        {
            warn!(chat_id, error = ?e, "chat init baseline sink failed; queued for retry");
            persist_retry.push(DocUpdate {
                doc: DocId::chat(&chat_id),
                update: init_chat,
            });
        }
        let init_session = pair
            .session
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        if let Err(e) = sink
            .persist_update(DocId::session(&chat_id), init_session.clone())
            .await
        {
            warn!(chat_id, error = ?e, "session init baseline sink failed; queued for retry");
            persist_retry.push(DocUpdate {
                doc: DocId::session(&chat_id),
                update: init_session,
            });
        }
    }

    let mut interval = tokio::time::interval(cfg.batch_window);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    // interval 第一次 tick 立即就绪；消费掉以让窗口从此刻开始计时（§8.3）。
    interval.tick().await;

    loop {
        tokio::select! {
            _ = interval.tick() => {
                flush_batch(&chat_id, &mut pair, &mut agg, &mut batch, &mut batch_bytes,
                    &mut chat_updates, &mut control_updates, &sink, &broadcast, &registry,
                    &mut persist_retry).await;
            }
            msg = rx.recv() => match msg {
                Some(ChatMsg::Event(ev, reply)) => {
                    if is_batchable(&ev.body) {
                        batch_bytes += estimate_bytes(&ev);
                        batch.push((*ev, reply));
                        if batch_bytes >= cfg.batch_bytes {
                            flush_batch(&chat_id, &mut pair, &mut agg, &mut batch, &mut batch_bytes,
                                &mut chat_updates, &mut control_updates, &sink, &broadcast, &registry,
                                &mut persist_retry).await;
                        }
                    } else {
                        // 控制类先 flush（§6.4：状态不倒退）。
                        flush_batch(&chat_id, &mut pair, &mut agg, &mut batch, &mut batch_bytes,
                            &mut chat_updates, &mut control_updates, &sink, &broadcast, &registry,
                            &mut persist_retry).await;
                        let result = apply_event(&chat_id, &mut pair, &mut agg, &ev,
                            &mut chat_updates, &mut control_updates, &sink, &broadcast, &registry,
                            &mut persist_retry).await;
                        if let Some(r) = reply {
                            let _ = r.send(result);
                        }
                    }
                }
                Some(ChatMsg::ReadSessionActiveTurn(reply)) => {
                    let _ = reply.send(read_session_active_turn(&pair));
                }
                Some(ChatMsg::Command(cmd, reply)) => {
                    // 控制类先 flush（§6.4）。
                    flush_batch(&chat_id, &mut pair, &mut agg, &mut batch, &mut batch_bytes,
                        &mut chat_updates, &mut control_updates, &sink, &broadcast, &registry,
                        &mut persist_retry).await;
                    let result = apply_command(&chat_id, &mut pair, &mut agg, cmd,
                        &mut chat_updates, &mut control_updates, &sink, &broadcast, &registry,
                        &mut persist_retry).await;
                    if let Some(r) = reply {
                        let _ = r.send(result);
                    }
                }
                Some(ChatMsg::Shutdown(reply)) => {
                    flush_batch(&chat_id, &mut pair, &mut agg, &mut batch, &mut batch_bytes,
                        &mut chat_updates, &mut control_updates, &sink, &broadcast, &registry,
                        &mut persist_retry).await;
                    let _ = reply.send(());
                    break;
                }
                None => break,
            }
        }
    }
    debug!(chat_id, "chat writer exited");
}

pub(crate) fn is_batchable(body: &EventBody) -> bool {
    matches!(
        body,
        EventBody::MessageDelta { .. } | EventBody::ReasoningDelta { .. }
    )
}

pub(crate) fn estimate_bytes(ev: &NormalizedEvent) -> usize {
    match &ev.body {
        EventBody::MessageDelta { text, .. } | EventBody::ReasoningDelta { text, .. } => {
            64 + text.len()
        }
        _ => 128,
    }
}

/// 批次 flush（§8.3）：delta 合并为一次 chat 事务；gap 上报；回填应答。
#[allow(clippy::too_many_arguments)]
pub(crate) async fn flush_batch(
    chat_id: &str,
    pair: &mut DocPair,
    agg: &mut Aggregator,
    batch: &mut Vec<(NormalizedEvent, Option<oneshot::Sender<SubmitResult>>)>,
    batch_bytes: &mut usize,
    chat_updates: &mut mpsc::UnboundedReceiver<Vec<u8>>,
    control_updates: &mut mpsc::UnboundedReceiver<Vec<u8>>,
    sink: &Arc<dyn UpdateSink>,
    broadcast: &Arc<RwLock<Vec<mpsc::UnboundedSender<DocUpdate>>>>,
    registry: &RegistryState,
    persist_retry: &mut Vec<DocUpdate>,
) {
    if batch.is_empty() {
        return;
    }
    // drain 一次取出所有权：事件移入 evs（零 clone），reply 同序移入 replies；
    // batch 变空但保留容量（Vec::drain 语义），后续批次 push 复用缓冲。
    let mut replies: Vec<Option<oneshot::Sender<SubmitResult>>> = Vec::with_capacity(batch.len());
    let evs: Vec<NormalizedEvent> = batch
        .drain(..)
        .map(|(ev, reply)| {
            replies.push(reply);
            ev
        })
        .collect();
    let results = agg.apply_batch(pair, &evs);
    let persisted = persist_and_broadcast(
        chat_id,
        chat_updates,
        control_updates,
        sink,
        broadcast,
        registry,
        persist_retry,
    )
    .await;
    // gap 上报（§9.4/§12.4）。
    report_gap(chat_id, pair, registry).await;
    // applied 统计取 apply_batch 实际结果（§9.3 观测不失真：events 是提交
    // 数，applied 是幂等/守卫判定后的真实应用数）。
    let applied_count = results.iter().filter(|r| r.applied).count();
    for (reply, result) in replies.into_iter().zip(results) {
        if let Some(r) = reply {
            let _ = r.send(if persisted {
                SubmitResult::Applied(result)
            } else {
                SubmitResult::PersistFailed
            });
        }
    }
    *batch_bytes = 0;
    debug!(
        chat_id,
        events = evs.len(),
        applied = applied_count,
        "batch flushed"
    );
}

/// 投递 + 广播当前事务产生的增量 update（顺序 chat → control，§6.4）。
/// 返回是否全部投递成功。
///
/// 【故障面 §8.4】persist 失败的 update **不广播、不丢弃**：进入 `persist_retry`
/// 缓冲，随下次 flush/apply 重投（yrs 增量幂等，重投无害）；重投成功才广播——
/// 客户端不得先于镜像看到未持久化状态。缓冲超过 [`PERSIST_RETRY_MAX`] 时丢弃
/// 最旧（已报 PersistFailure degraded，防无界内存）。
#[allow(clippy::too_many_arguments)]
pub(crate) async fn persist_and_broadcast(
    chat_id: &str,
    chat_updates: &mut mpsc::UnboundedReceiver<Vec<u8>>,
    control_updates: &mut mpsc::UnboundedReceiver<Vec<u8>>,
    sink: &Arc<dyn UpdateSink>,
    broadcast: &Arc<RwLock<Vec<mpsc::UnboundedSender<DocUpdate>>>>,
    registry: &RegistryState,
    persist_retry: &mut Vec<DocUpdate>,
) -> bool {
    let mut all_ok = true;
    // 先重投上一批次失败的 update（FIFO；成功才广播）。
    for update in std::mem::take(persist_retry) {
        if sink
            .persist_update(update.doc.clone(), update.update.clone())
            .await
            .is_ok()
        {
            broadcast_send(broadcast, update).await;
        } else {
            all_ok = false;
            persist_retry.push(update);
        }
    }
    // chat 事务先提交 → update 先到（§6.4 固定顺序）。
    while let Ok(update) = chat_updates.try_recv() {
        let doc = DocId::chat(chat_id);
        if sink
            .persist_update(doc.clone(), update.clone())
            .await
            .is_err()
        {
            all_ok = false;
            let _ = registry
                .report_condition(DegradeCause::PersistFailure)
                .await;
            warn!(chat_id, "chat update sink failed; queued for retry");
            persist_retry.push(DocUpdate { doc, update });
        } else {
            broadcast_send(broadcast, DocUpdate { doc, update }).await;
        }
    }
    while let Ok(update) = control_updates.try_recv() {
        let doc = DocId::session(chat_id);
        if sink
            .persist_update(doc.clone(), update.clone())
            .await
            .is_err()
        {
            all_ok = false;
            let _ = registry
                .report_condition(DegradeCause::PersistFailure)
                .await;
            warn!(chat_id, "control update sink failed; queued for retry");
            persist_retry.push(DocUpdate { doc, update });
        } else {
            broadcast_send(broadcast, DocUpdate { doc, update }).await;
        }
    }
    // 上限保护：磁盘长时不可用时不无界增长；丢弃最旧（镜像缺口由
    // degraded + 后续快照/重放路径暴露，不在本路径自愈）。
    while persist_retry.len() > PERSIST_RETRY_MAX {
        persist_retry.remove(0);
        warn!(
            chat_id,
            "persist retry buffer overflow; dropped oldest update"
        );
    }
    all_ok
}

pub(crate) async fn broadcast_send(
    broadcast: &Arc<RwLock<Vec<mpsc::UnboundedSender<DocUpdate>>>>,
    update: DocUpdate,
) {
    let mut dead = false;
    {
        let senders = broadcast.read().await;
        for tx in senders.iter() {
            // unbounded：send 不阻塞（背压在下游 broadcaster，§6.4）。
            if tx.send(update.clone()).is_err() {
                dead = true;
            }
        }
    }
    if dead {
        // 对端已断的 sender 一次性清除（§8.6 订阅回收）：broadcaster 每次
        // 连接订阅一次，连接断开后 sender 若滞留则长跑后广播路径线性退化
        // + 内存增长。写锁竞争频率低（仅失败时获取），可接受。
        broadcast.write().await.retain(|tx| !tx.is_closed());
    }
}

/// gap 上报：stream.gap_dirty → Registry chats[].gap 写回（§9.4/§12.4）。
pub(crate) async fn report_gap(chat_id: &str, pair: &mut DocPair, registry: &RegistryState) {
    if !pair.stream.gap_dirty {
        return;
    }
    pair.stream.gap_dirty = false;
    let gap = if pair.stream.gap_count > 0 || pair.stream.uncalibratable {
        Some(pair.stream.gap_count)
    } else {
        None
    };
    trace!(
        chat_id,
        gap_count = pair.stream.gap_count,
        uncalibratable = pair.stream.uncalibratable,
        "gap report"
    );
    if let Err(e) = registry.set_chat_gap(chat_id, gap).await {
        // 上报失败不阻塞主流程；Registry 状态源会在下次机会补报。
        warn!(chat_id, error = ?e, "gap report to registry failed");
    }
    // gap 存在 → ChatGap degraded 条件（§17.2）；追平 → 清除。
    if gap.is_some() {
        let _ = registry.report_condition(DegradeCause::ChatGap).await;
    } else {
        let _ = registry.clear_condition(DegradeCause::ChatGap).await;
    }
}

/// 单事件应用（控制类路径）：apply → 持久化 → 广播。
#[allow(clippy::too_many_arguments)]
/// Registry 写者循环（§8.5：即到即写，无微批次；Registry Doc 唯一写者）。
pub(crate) async fn registry_writer_loop(
    doc: yrs::Doc,
    mut rx: mpsc::Receiver<RegistryMsg>,
    sink: Arc<dyn UpdateSink>,
    broadcast: Arc<RwLock<Vec<mpsc::UnboundedSender<DocUpdate>>>>,
    registry: RegistryState,
) {
    let mut applier = RegistryApplier::new(doc.clone());
    // Registry update 观察：经 channel 送出（§6.4 回调不能 await）。
    let (update_tx, mut update_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    // persist 失败重试缓冲（§8.4 故障面，与 chat 写者同语义：失败不广播、
    // 不丢弃，随下次命令重投）。
    let mut persist_retry: Vec<DocUpdate> = Vec::new();
    let _sub = SendSubscription(Some(
        doc.observe_update_v1(move |_, e| {
            let _ = update_tx.send(e.update.clone());
        })
        .unwrap_or_else(|e| {
            report_projection_failure(&registry);
            panic!("registry observe_update failed: {e}")
        }),
    ));

    // 初始化全量基线投递（§8.4.1 Doc 补齐/§5.6）：Factory 结构初始化发生在
    // observe 订阅之前，其 update 不会经回调产生——若不下发，镜像（StoreSink）
    // 将缺少 doc 基线，后续增量（pv 覆盖写等带 origin 的更新）
    // 无法应用（yrs 缺依赖进 pending，永不满足）。下发的全量作为基线，后续
    // 增量即可完整应用（yrs 幂等，重复应用无害）。
    {
        let init = doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        if let Err(e) = sink.persist_update(DocId::REGISTRY, init.clone()).await {
            warn!(error = ?e, "registry init baseline sink failed; queued for retry");
            persist_retry.push(DocUpdate {
                doc: DocId::REGISTRY,
                update: init,
            });
        }
    }

    while let Some(msg) = rx.recv().await {
        match msg {
            RegistryMsg::Command(cmd, reply) => {
                let r = applier.apply(&cmd);
                persist_registry_updates(&mut update_rx, &sink, &broadcast, &mut persist_retry)
                    .await;
                let _ = reply.send(r);
            }
            RegistryMsg::SetChatGap {
                chat_id,
                gap,
                reply,
            } => {
                let r = applier.set_chat_gap(&chat_id, gap);
                persist_registry_updates(&mut update_rx, &sink, &broadcast, &mut persist_retry)
                    .await;
                let _ = reply.send(r);
            }
            RegistryMsg::SetChatStatus {
                chat_id,
                status,
                reply,
            } => {
                let r = applier.set_chat_status(&chat_id, &status);
                persist_registry_updates(&mut update_rx, &sink, &broadcast, &mut persist_retry)
                    .await;
                let _ = reply.send(r);
            }
            RegistryMsg::ListWorkspaces(reply) => {
                let _ = reply.send(applier.list_workspaces());
            }
            RegistryMsg::ListLegacySessions(reply) => {
                let _ = reply.send(applier.list_legacy_sessions());
            }
            RegistryMsg::ListHealthMachines(reply) => {
                let _ = reply.send(applier.list_health_machines());
            }
        }
    }
}

pub(crate) async fn persist_registry_updates(
    update_rx: &mut mpsc::UnboundedReceiver<Vec<u8>>,
    sink: &Arc<dyn UpdateSink>,
    broadcast: &Arc<RwLock<Vec<mpsc::UnboundedSender<DocUpdate>>>>,
    persist_retry: &mut Vec<DocUpdate>,
) {
    // 先重投上一轮失败的 update（成功才广播）。
    for update in std::mem::take(persist_retry) {
        if sink
            .persist_update(update.doc.clone(), update.update.clone())
            .await
            .is_ok()
        {
            broadcast_send(broadcast, update).await;
        } else {
            persist_retry.push(update);
        }
    }
    while let Ok(update) = update_rx.try_recv() {
        let doc = DocId::REGISTRY;
        if sink
            .persist_update(doc.clone(), update.clone())
            .await
            .is_err()
        {
            warn!("registry update sink failed; queued for retry");
            persist_retry.push(DocUpdate { doc, update });
        } else {
            broadcast_send(broadcast, DocUpdate { doc, update }).await;
        }
    }
    // 上限保护（同 chat 路径 §8.4）。
    while persist_retry.len() > PERSIST_RETRY_MAX {
        persist_retry.remove(0);
        warn!("registry persist retry buffer overflow; dropped oldest update");
    }
}

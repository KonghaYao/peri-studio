//! 全局 Registry writer 与持久化（§5.6/§8.4/§8.5）。
//!
//! Registry Doc 与 per-chat Doc 一样遵循唯一提交边界，但不参与 chat 微批次；
//! 本模块负责命令应用、镜像投递、广播及失败 update 的有界重试。

use std::sync::Arc;

use tokio::sync::{mpsc, RwLock};
use tracing::warn;
use yrs::{ReadTxn, StateVector, Transact};

use peri_studio_proto::conn::DocId;

use crate::state::doc_manager::{DocUpdate, SendSubscription, UpdateSink, PERSIST_RETRY_MAX};
use crate::state::doc_manager_apply_event::report_projection_failure;
use crate::state::doc_manager_persist::broadcast_send;
use crate::state::registry::{RegistryApplier, RegistryMsg, RegistryState};

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

async fn persist_registry_updates(
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

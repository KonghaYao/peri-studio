//! UpdateSink 生产实现（F5 薄 adapter）：内存镜像 + 广播流（无落盘）。
//!
//! 纯内存镜像：chat/control/registry update → 内存 yrs 镜像应用 + 广播——
//! gateway 快照与 broadcaster 增量的**单一真相**；启动即空，视图完全由
//! ACP 重放 / SQLite 投影提供（§无状态投影）。
//!
//! 本文件是 [`Hub`](super::Hub) 装配面的实现段（结构拆分，行为语义不变）。

use std::collections::HashMap;

use async_trait::async_trait;
use chrono::Utc;
use tokio::sync::{mpsc, RwLock};
use tracing::warn;

use peri_studio_proto::conn::DocId;
use yrs::{Map, ReadTxn, Transact};

use crate::control::HubError;
use crate::state::doc_manager::{DocUpdate, PersistError, UpdateSink};
use crate::state::factory::{DocKind, Factory};
use crate::state::view_store::encode_state_as_update;
use peri_studio_proto::version::{
    CHAT_DOC_SCHEMA_VERSION, REGISTRY_DOC_SCHEMA_VERSION, SESSION_DOC_SCHEMA_VERSION,
};

/// UpdateSink 生产实现（F5 薄 adapter）：内存镜像 + 广播流（无落盘）。
///
/// 并发模型：chat/control/registry 镜像按 DocId 索引（`RwLock<HashMap>`，
/// 每次 `persist_update` 写锁；镜像 doc 为 yrs 句柄，`apply_update_v1` 需要
/// 独占事务——DocManager writer 是每 chat 单写者，天然串行）。
pub struct StoreSink {
    factory: Factory,
    /// 镜像 doc（chat:{cid} / control:{cid} / hub:registry）。
    /// `pub(super)`：hub 测试（`hub_test`）直接检查镜像内容。
    pub(super) docs: RwLock<HashMap<DocId, yrs::Doc>>,
    /// 镜像更新广播（broadcaster attach 消费）。
    broadcast: RwLock<Vec<mpsc::UnboundedSender<DocUpdate>>>,
}

impl StoreSink {
    /// 空镜像启动：不读任何日志/快照（视图由 ACP 重放与 SQLite 投影重建）。
    pub fn new() -> Self {
        StoreSink {
            factory: Factory::new(),
            docs: RwLock::new(HashMap::new()),
            broadcast: RwLock::new(Vec::new()),
        }
    }
}

impl Default for StoreSink {
    fn default() -> Self {
        Self::new()
    }
}

impl StoreSink {
    /// 全量快照（gateway 订阅推送；§4.6 步骤 3）。
    ///
    /// 返回 `(state_update, projection_version)`；doc 未打开 → None（空会话
    /// 视图由客户端按空 doc 处理）。
    pub async fn snapshot(&self, doc: &DocId) -> Option<(Vec<u8>, u32)> {
        let docs = self.docs.read().await;
        let d = docs.get(doc)?;
        let state = encode_state_as_update(d);
        let version = projection_version(d);
        Some((state, version))
    }

    /// Startup-only cross-store repair for a Hub-owned v2 prompt entry. The
    /// mirror is already reconstructed at this point; the generated delta is
    /// appended through the normal UpdateSink durability path before the
    /// gateway can accept clients.
    pub async fn reconcile_prompt_entry_delivery(
        &self,
        chat_id: &str,
        entry_id: &str,
        delivery_state: &str,
        delivery_error_code: Option<&str>,
    ) -> Result<bool, HubError> {
        let mut repairs = Vec::<(DocId, Vec<u8>)>::new();
        let changed = {
            let mut docs = self.docs.write().await;
            let chat_doc_id = DocId::chat(chat_id);
            let Some(chat_doc) = docs.get_mut(&chat_doc_id) else {
                return Ok(false);
            };
            let chat_before = chat_doc.transact().state_vector();
            let (chat_changed, entry_turn_id) = {
                let mut txn = chat_doc.transact_mut();
                let Some(root) = txn.get_map(crate::state::factory::ROOT) else {
                    return Ok(false);
                };
                let turn_id =
                    crate::state::chat_writer::prompt_entry_turn_id(&txn, &root, entry_id);
                let changed = crate::state::chat_writer::set_prompt_entry_delivery(
                    &mut txn,
                    &root,
                    entry_id,
                    delivery_state,
                    delivery_error_code,
                    None,
                );
                if changed {
                    crate::state::chat_writer::bump_projection_version(&mut txn, &root);
                }
                (changed, turn_id)
            };
            if chat_changed {
                repairs.push((
                    chat_doc_id,
                    chat_doc.transact().encode_state_as_update_v1(&chat_before),
                ));
            }

            let mut session_changed = false;
            if delivery_state == "failed_not_delivered" {
                if let Some(turn_id) = entry_turn_id {
                    let session_doc_id = DocId::session(chat_id);
                    let session_doc = docs.get_mut(&session_doc_id).ok_or_else(|| {
                        HubError::Store(format!(
                            "session mirror unavailable during prompt repair: {chat_id}"
                        ))
                    })?;
                    let session_before = session_doc.transact().state_vector();
                    {
                        let mut txn = session_doc.transact_mut();
                        let Some(root) = txn.get_map(crate::state::factory::ROOT) else {
                            return Err(HubError::Store(format!(
                                "session root unavailable during prompt repair: {chat_id}"
                            )));
                        };
                        let active = root
                            .get(&txn, "session")
                            .and_then(|value| value.cast::<yrs::MapRef>().ok());
                        let active_id = active.as_ref().and_then(|session| {
                            session
                                .get(&txn, "active_turn_id")
                                .and_then(|value| value.cast::<String>().ok())
                        });
                        let active_status = active.as_ref().and_then(|session| {
                            session
                                .get(&txn, "active_turn_status")
                                .and_then(|value| value.cast::<String>().ok())
                        });
                        let terminal = active_status.as_deref().is_some_and(|status| {
                            matches!(status, "completed" | "failed" | "cancelled" | "interrupted")
                        });
                        if active_id.as_deref() == Some(turn_id.as_str()) && !terminal {
                            crate::state::chat_writer::set_active_turn(
                                &mut txn,
                                &root,
                                Some(&peri_studio_proto::schema::ActiveTurnProjection {
                                    turn_id,
                                    turn_status: peri_studio_proto::schema::TurnStatus::Failed,
                                    updated_at: Utc::now().to_rfc3339(),
                                }),
                            );
                            crate::state::chat_writer::bump_projection_version(&mut txn, &root);
                            session_changed = true;
                        }
                    }
                    if session_changed {
                        repairs.push((
                            session_doc_id,
                            session_doc
                                .transact()
                                .encode_state_as_update_v1(&session_before),
                        ));
                    }
                }
            }
            chat_changed || session_changed
        };
        for (doc_id, update) in repairs {
            self.persist_update(doc_id, update)
                .await
                .map_err(|error| HubError::Store(error.to_string()))?;
        }
        Ok(changed)
    }

    /// 镜像更新广播订阅（hub 装配时 broadcaster attach）。
    pub async fn subscribe(&self) -> mpsc::UnboundedReceiver<DocUpdate> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.broadcast.write().await.push(tx);
        rx
    }
}

#[async_trait]
impl UpdateSink for StoreSink {
    async fn persist_update(&self, doc: DocId, update: Vec<u8>) -> Result<(), PersistError> {
        // 内存镜像应用 + 广播（无落盘；视图重建由 ACP 重放 / SQLite 投影
        // 提供，§无状态投影）。镜像与广播同源，客户端应用无 CRDT 分叉。
        let mut docs = self.docs.write().await;
        if docs.get(&doc).is_none() {
            // doc 未打开（新 chat 首写/Registry 首写）：惰性创建（先应用
            // 业务 update、后幂等补结构——见 [`create_mirror_doc`]）。
            let kind = match doc.as_str() {
                s if s.starts_with("chat:") || s.starts_with("session:") => {
                    // 防御：chat/session doc 的 sid 必须是 UUID（DocManager
                    // 只对合法 chat_id 调 persist_update；镜像键与 Store 判定
                    // 同形）。
                    let sid = s.split_once(':').map(|(_, s)| s).unwrap_or_default();
                    if uuid::Uuid::parse_str(sid).is_err() {
                        return Err(PersistError(format!("unknown doc: {doc}")));
                    }
                    Some(if s.starts_with("chat:") {
                        DocKind::Chat
                    } else {
                        DocKind::Session
                    })
                }
                "hub:registry" => Some(DocKind::Registry),
                _ => None,
            };
            match kind {
                Some(kind) => {
                    let d = create_mirror_doc(&self.factory, kind, std::slice::from_ref(&update));
                    docs.insert(doc.clone(), d);
                }
                None => return Err(PersistError(format!("unknown doc: {doc}"))),
            }
        } else if let Some(target) = docs.get_mut(&doc) {
            apply_update(target, &update);
        }
        // 镜像更新广播：单订阅者（生产形态，装配仅 attach 一个 broadcaster，
        // 见 `subscribe` 调用点）move 直发零复制——镜像已应用，update 不再
        // 需要；多订阅者回退逐份 clone（广播语义要求每订阅者独立 DocUpdate）。
        // 锁内仅 clone 发送器集合（UnboundedSender 克隆为指针级廉价操作）、
        // 锁外逐个 send：避免锁窗口跨 await 持有——读锁期间 `subscribe`/
        // `unsubscribe` 的写锁会被阻塞；若未来将有界通道化（unbounded 是历史
        // 热点源头），持锁 await 会挂起（原实现 clone 后锁外 send 无此问题）。
        let senders = self.broadcast.read().await.clone();
        if let [tx] = senders.as_slice() {
            let _ = tx.send(DocUpdate { doc, update });
        } else {
            for tx in senders.iter() {
                let _ = tx.send(DocUpdate {
                    doc: doc.clone(),
                    update: update.clone(),
                });
            }
        }
        Ok(())
    }
}

/// 镜像 doc 创建与结构补齐（§5.6/§8.4.1「Doc 补齐」）。
///
/// **顺序纪律**：先应用业务 update、后幂等补结构。预初始化（`Factory`
/// 建全结构）再应用业务 update 会引入 CRDT LWW 冲突——镜像 doc 的
/// `projection_version=0`/`schema_version` 初始化写入与业务写入不同 client，
/// 同键合并以 client id 排序，**初始化值可能覆盖业务值**（快照
/// `projection_version` 恒 0）。先应用业务 update 后，以 `schema_version`
/// 占位使 [`Factory::ensure_schema`] 走「已有版本」分支（`patch_missing`
/// 只补缺失键、不覆盖已有业务值）。
fn create_mirror_doc(factory: &Factory, kind: DocKind, updates: &[Vec<u8>]) -> yrs::Doc {
    let mut doc = yrs::Doc::new();
    for update in updates {
        apply_update(&doc, update);
    }
    let version = match kind {
        DocKind::Chat => CHAT_DOC_SCHEMA_VERSION,
        DocKind::Session => SESSION_DOC_SCHEMA_VERSION,
        DocKind::Registry => REGISTRY_DOC_SCHEMA_VERSION,
    };
    {
        use yrs::{Transact, WriteTxn};
        let mut txn = doc.transact_mut();
        let root = txn.get_or_insert_map(crate::state::factory::ROOT);
        if root.get(&txn, "schema_version").is_none() {
            root.insert(&mut txn, "schema_version", version);
        }
    }
    factory
        .ensure_schema(&mut doc, kind)
        .expect("mirror doc schema");
    doc
}

/// 读取镜像 doc 的 projection_version（§5.3 只读）。
fn projection_version(doc: &yrs::Doc) -> u32 {
    let txn = doc.transact();
    let Some(root) = crate::state::chat_writer::root_map_read(&txn) else {
        return 0;
    };
    root.get(&txn, "projection_version")
        .and_then(|v| v.cast::<u32>().ok())
        .unwrap_or(0)
}

/// apply update（yrs 编码版本 v1，§4.1）。
fn apply_update(doc: &yrs::Doc, update: &[u8]) {
    use yrs::updates::decoder::Decode as _;
    match yrs::Update::decode_v1(update) {
        Ok(parsed) => {
            let mut txn = doc.transact_mut();
            if let Err(e) = txn.apply_update(parsed) {
                warn!(error = ?e, "mirror update apply failed; skipped");
            }
        }
        Err(e) => {
            warn!(error = ?e, "mirror update decode failed; skipped");
        }
    }
}

#[cfg(test)]
#[path = "hub_sink_test.rs"]
mod hub_sink_test;

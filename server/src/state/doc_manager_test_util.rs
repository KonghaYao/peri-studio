//! DocManager 测试共享辅助（`doc_manager_test.rs` 拆分）：内存 sink
//! 替身（`MemSink`/`PersistedUpdate`）、paused clock 抑制
//! （`ClockBlocker`，tokio 1.53 auto-advance）、事件/命令构造与
//! 落盘投影查询。各主题测试文件经 `use super::util::*;` 复用
//! （helper 与替身字段声明为 `pub(crate)`，规避兄弟模块 glob 导入
//! 的可见性限制）。

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::Mutex;
use yrs::{Map, ReadTxn, Transact};

use peri_studio_proto::conn::DocId;

use crate::state::doc_manager::{
    BatchConfig, DocCommand, DocManager, PersistError, SubmitResult, UpdateSink,
};
use crate::state::normalized::{EventBody, NormalizedEvent};

/// 抑制 paused clock 的 auto-advance（tokio 1.53：runtime 无 ready 任务时自动
/// 推进虚拟时钟到下一 timer，导致「窗口未到不 flush」断言失效）。
///
/// `spawn_blocking` 阻塞期间 auto-advance 被抑制（tokio 文档）；Drop 释放。
/// 每个 `#[tokio::test]` 是独立 runtime，clock 互不影响。
pub(crate) struct ClockBlocker {
    tx: std::sync::mpsc::Sender<()>,
}

impl ClockBlocker {
    pub(crate) fn hold() -> Self {
        let (tx, rx) = std::sync::mpsc::channel();
        tokio::task::spawn_blocking(move || {
            let _ = rx.recv();
        });
        ClockBlocker { tx }
    }
}

impl Drop for ClockBlocker {
    fn drop(&mut self) {
        let _ = self.tx.send(());
    }
}

/// 内存测试替身 sink（记录落盘 update；可选择失败）。
pub(crate) type PersistedUpdate = (DocId, Vec<u8>);

#[derive(Clone, Default)]
pub(crate) struct MemSink {
    pub(crate) updates: Arc<Mutex<Vec<PersistedUpdate>>>,
    pub(crate) fail: Arc<std::sync::atomic::AtomicBool>,
}

#[async_trait]
impl UpdateSink for MemSink {
    async fn persist_update(&self, doc: DocId, update: Vec<u8>) -> Result<(), PersistError> {
        if self.fail.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(PersistError("disk full".into()));
        }
        self.updates.lock().await.push((doc, update));
        Ok(())
    }
}

pub(crate) fn cfg() -> BatchConfig {
    BatchConfig {
        batch_window: Duration::from_millis(16),
        batch_bytes: 4096,
        chat_queue: 64,
    }
}

pub(crate) fn delta(chat: &str, seq: u64, turn: &str, text: &str) -> NormalizedEvent {
    NormalizedEvent {
        chat_id: chat.to_string(),
        seq,
        epoch: 0,
        ts: "2026-08-07T00:00:00Z".to_string(),
        provenance: Default::default(),
        body: EventBody::MessageDelta {
            turn_id: turn.to_string(),
            entry_id: format!("{turn}:assistant"),
            block_id: "b1".to_string(),
            text: text.to_string(),
        },
    }
}

pub(crate) fn user_msg(chat: &str, seq: u64, turn: &str) -> NormalizedEvent {
    NormalizedEvent {
        chat_id: chat.to_string(),
        seq,
        epoch: 0,
        ts: "2026-08-07T00:00:00Z".to_string(),
        provenance: Default::default(),
        body: EventBody::UserMessage {
            turn_id: turn.to_string(),
            entry_id: format!("{turn}:user"),
            text: "hi".to_string(),
            author_user_id: None,
            created_at: "2026-08-07T00:00:00Z".to_string(),
        },
    }
}

/// `session/load` 回放事件（§8.5）：历史 chunk 无 turn_id（真实 peri 重放）。
pub(crate) fn replay_user(chat: &str, seq: u64, text: &str) -> NormalizedEvent {
    NormalizedEvent {
        chat_id: chat.to_string(),
        seq,
        epoch: 0,
        ts: "2026-08-07T00:00:00Z".to_string(),
        provenance: Default::default(),
        body: EventBody::UserMessage {
            turn_id: String::new(),
            entry_id: String::new(),
            text: text.to_string(),
            author_user_id: None,
            created_at: "2026-08-07T00:00:00Z".to_string(),
        },
    }
}

pub(crate) fn replay_delta(chat: &str, seq: u64, text: &str) -> NormalizedEvent {
    NormalizedEvent {
        chat_id: chat.to_string(),
        seq,
        epoch: 0,
        ts: "2026-08-07T00:00:00Z".to_string(),
        provenance: Default::default(),
        body: EventBody::MessageDelta {
            turn_id: String::new(),
            entry_id: String::new(),
            block_id: String::new(),
            text: text.to_string(),
        },
    }
}

/// §6.5 服务端单写注入：RegisterUserEntry 命令写 user entry + active_turn
/// (accepting)。聚合器已拒绝非回放 UserMessage 事件（回声），user 消息铺设
/// 一律走注入命令路径（doc_manager_test 的 seed 等价物）。
pub(crate) async fn seed_user_entry(mgr: &DocManager, chat: &str) {
    let r = mgr
        .submit_command(
            chat,
            DocCommand::RegisterUserEntry {
                turn_id: "t1".into(),
                entry_id: "t1:user".into(),
                text: "hi".into(),
                author_user_id: None,
                source_command_id: "test-command".into(),
                created_at: "2026-08-07T00:00:00Z".into(),
            },
        )
        .await;
    assert!(matches!(r, SubmitResult::Applied(a) if a.applied));
}

pub(crate) async fn open(mgr: &DocManager, chat: &str) {
    mgr.open_chat(chat, "m1", Some("t"), None, None)
        .await
        .unwrap();
}

pub(crate) async fn projected_active_turn(sink: &MemSink, chat: &str) -> Option<(String, String)> {
    use yrs::updates::decoder::Decode as _;

    let mirror = yrs::Doc::new();
    for (doc, update) in sink.updates.lock().await.iter() {
        if *doc != DocId::session(chat) {
            continue;
        }
        mirror
            .transact_mut()
            .apply_update(yrs::Update::decode_v1(update).unwrap())
            .unwrap();
    }
    let txn = mirror.transact();
    let session = txn
        .get_map("root")
        .and_then(|root| root.get(&txn, "session"))
        .and_then(|value| value.cast::<yrs::MapRef>().ok())?;
    Some((
        session
            .get(&txn, "active_turn_id")
            .and_then(|value| value.cast::<String>().ok())?,
        session
            .get(&txn, "active_turn_status")
            .and_then(|value| value.cast::<String>().ok())?,
    ))
}

pub(crate) async fn projected_active_turn_status(sink: &MemSink, chat: &str) -> Option<String> {
    projected_active_turn(sink, chat)
        .await
        .map(|(_, status)| status)
}

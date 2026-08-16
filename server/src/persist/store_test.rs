//! Store 测试（§无状态投影）：内存 chat 索引 + outbox 句柄。落盘/恢复/
//! 归档/预算测试已随 updates.log/outbox.log/watermark/closed_at 一并删除。

use std::path::PathBuf;

use uuid::Uuid;

use crate::persist::outbox::{CommandType, NewOutboxRecord, RetryableClass};
use crate::persist::store::Store;
use crate::persist::PersistConfig;

/// 测试配置：tempdir 数据目录（唯一产物 metadata.sqlite3 定位）。
fn test_config(data_dir: PathBuf) -> PersistConfig {
    PersistConfig { data_dir }
}

#[test]
fn open_is_pure_memory_and_registers_chats() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&test_config(dir.path().to_path_buf())).unwrap();
    assert!(store.chats_snapshot().is_empty());
    assert_eq!(store.data_dir(), dir.path());

    let sid = Uuid::new_v4();
    store.create_chat(sid).unwrap();
    let chat = store.chat(sid).expect("chat registered");
    assert_eq!(chat.chat_id(), sid);
    assert_eq!(store.chats_snapshot().len(), 1);
    assert!(store.chat(Uuid::new_v4()).is_none());
}

#[tokio::test]
async fn chat_outbox_roundtrip_and_removal() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&test_config(dir.path().to_path_buf())).unwrap();
    let sid = Uuid::new_v4();
    store.create_chat(sid).unwrap();
    let chat = store.chat(sid).unwrap();

    let command_id = Uuid::new_v4();
    chat.outbox()
        .lock()
        .await
        .insert(NewOutboxRecord {
            command_id,
            chat_id: sid,
            command_type: CommandType::Prompt,
            turn_id: None,
            retryable_class: RetryableClass::NoAutoRedeliver,
        })
        .unwrap();
    assert_eq!(
        chat.outbox_get(command_id).await.unwrap().command_id,
        command_id
    );
    assert_eq!(chat.outbox_records().await.len(), 1);

    store.remove_chat(sid).unwrap();
    assert!(store.chat(sid).is_none());
    assert!(store.chats_snapshot().is_empty());
}

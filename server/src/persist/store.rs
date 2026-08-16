//! 内存 Store（§无状态投影）：chat 索引 + command outbox 状态机。
//!
//! 无任何落盘：updates.log/outbox.log/watermark/closed_at/归档已全部删除，
//! 持久化收敛到唯一产物 `metadata.sqlite3`
//! （`docs/design/peri-studio-stateless-projections.md`）。`data_dir` 仅用于
//! 定位 `metadata.sqlite3`。chat 视图的跨重启恢复由
//! `Hub::rebuild_chat_views`（SQLite `session_runtime_history`）承担。

use std::collections::HashMap;
use std::path::Path;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use tokio::sync::Mutex;
use tracing::info;

use uuid::Uuid;

use crate::persist::outbox::{OutboxRecord, OutboxStore};
use crate::persist::{PersistConfig, StoreError};

/// 单 chat 的内存状态（outbox 状态机；无落盘）。
pub struct ChatStore {
    chat_id: Uuid,
    outbox: Mutex<OutboxStore>,
}

impl ChatStore {
    /// chat id。
    pub fn chat_id(&self) -> Uuid {
        self.chat_id
    }

    /// outbox 句柄（调用方持锁后调用 [`OutboxStore`] 方法）。
    pub fn outbox(&self) -> &Mutex<OutboxStore> {
        &self.outbox
    }

    /// 便捷查询：outbox 去重索引（重发判定，§4.4）。
    pub async fn outbox_get(&self, command_id: Uuid) -> Option<OutboxRecord> {
        self.outbox.lock().await.get(command_id).cloned()
    }

    /// outbox 全量记录（prompt 恢复审计查询）。
    pub async fn outbox_records(&self) -> Vec<OutboxRecord> {
        self.outbox.lock().await.records().cloned().collect()
    }
}

/// 内存 Store：chat 索引（chat_id → outbox 句柄）。
pub struct Store {
    data_dir: PathBuf,
    chats: RwLock<HashMap<Uuid, Arc<ChatStore>>>,
}

impl Store {
    /// 纯内存构造（不再创建/校验任何目录；`data_dir` 供 `metadata.sqlite3`
    /// 定位，§无状态投影）。
    pub fn open(config: &PersistConfig) -> Result<Self, StoreError> {
        Ok(Store {
            data_dir: config.data_dir.clone(),
            chats: RwLock::new(HashMap::new()),
        })
    }

    /// 获取 chat 句柄（未注册 → None；视图由 SQLite 重建 / 显式 load 补建）。
    pub fn chat(&self, chat_id: Uuid) -> Option<Arc<ChatStore>> {
        self.chats
            .read()
            .expect("chats lock poisoned")
            .get(&chat_id)
            .cloned()
    }

    /// 全部 chat 快照（`(chat_id, 句柄)`；create 去重索引查询用，§4.4）。
    pub fn chats_snapshot(&self) -> Vec<(Uuid, Arc<ChatStore>)> {
        self.chats
            .read()
            .expect("chats lock poisoned")
            .iter()
            .map(|(id, s)| (*id, s.clone()))
            .collect()
    }

    /// 新建 chat（内存注册；`metadata.sqlite3` 关联由调用方负责）。
    pub fn create_chat(&self, chat_id: Uuid) -> Result<Arc<ChatStore>, StoreError> {
        let chat = Arc::new(ChatStore {
            chat_id,
            outbox: Mutex::new(OutboxStore::new()),
        });
        self.chats
            .write()
            .expect("chats lock poisoned")
            .insert(chat_id, chat.clone());
        info!(chat_id = %chat_id, "chat store registered (memory)");
        Ok(chat)
    }

    /// 移除 chat（close 后的最终清理）。调用方保证无在途写入。
    pub fn remove_chat(&self, chat_id: Uuid) -> Result<(), StoreError> {
        self.chats
            .write()
            .expect("chats lock poisoned")
            .remove(&chat_id);
        info!(chat_id = %chat_id, "chat store removed (memory)");
        Ok(())
    }

    /// 数据目录（`metadata.sqlite3` 定位，§无状态投影）。
    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }
}

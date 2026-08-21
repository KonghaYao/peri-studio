//! 持久化层：唯一产物 `metadata.sqlite3`（导航目录，§无状态投影）。
//!
//! 无状态投影重构（`docs/design/peri-studio-stateless-projections.md`）后，
//! yrs CRDT docs 与 command outbox 均**不落盘**：
//!
//! - `metadata`：SQLite 导航目录——projects/sessions/chats 关联的**唯一权威**；
//! - `outbox`：**内存** command 状态机（去重账本 + 迁移 API；重启即空，
//!   命令从不重新发送，"以 ACP 现场为准"）；
//! - `store`：**内存** chat 索引（chat_id → outbox 句柄）。
//!
//! 已删除：updates.log/snapshot、outbox.log、watermark、registry
//! log/snapshot、compact machinery、closed_at 归档标记。边界声明：reconcile
//! 语义属 `channel/command-coordinator`；degraded 的对外呈现（Registry Doc
//! `global.status`）属 `state`；本层只提供内存数据源。

pub mod metadata;
pub mod outbox;
pub mod store;

#[cfg(test)]
#[path = "metadata_catalog_test.rs"]
mod metadata_catalog_test;
#[cfg(test)]
#[path = "metadata_commands_test.rs"]
mod metadata_commands_test;
#[cfg(test)]
#[path = "metadata_migrate_test.rs"]
mod metadata_migrate_test;
#[cfg(test)]
#[path = "metadata_recovery_test.rs"]
mod metadata_recovery_test;
#[cfg(test)]
#[path = "outbox_barrier_test.rs"]
mod outbox_barrier_test;
#[cfg(test)]
#[path = "outbox_commands_test.rs"]
mod outbox_commands_test;
#[cfg(test)]
#[path = "outbox_reconcile_test.rs"]
mod outbox_reconcile_test;
#[cfg(test)]
mod store_test;

use std::path::PathBuf;

/// 数据目录默认位置（`~/.local/share/peri-studio/`）。
pub fn default_data_dir() -> PathBuf {
    dirs_next::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("peri-studio")
}

/// 持久化配置（§无状态投影）：唯一产物 `metadata.sqlite3` 的定位。
#[derive(Debug, Clone)]
pub struct PersistConfig {
    /// 数据目录（默认 [`default_data_dir`]）。
    pub data_dir: PathBuf,
}

impl Default for PersistConfig {
    fn default() -> Self {
        Self {
            data_dir: default_data_dir(),
        }
    }
}

impl From<&crate::config::Config> for PersistConfig {
    fn from(cfg: &crate::config::Config) -> Self {
        PersistConfig {
            data_dir: cfg.data_dir.clone(),
        }
    }
}

/// 持久化层错误（outbox 状态机与 chat 索引；无 I/O 路径）。
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// 数据一致性错误（防御调用方 bug；无 I/O 路径）。
    #[error("store invariant violation: {detail}")]
    Corrupt {
        /// 细节（脱敏，无正文）。
        detail: String,
    },
    /// outbox 非法状态迁移（设计稿 §5.2 迁移表之外）。
    #[error("invalid outbox transition {from} -> {to} for command {command_id}")]
    InvalidTransition {
        /// 命令 id。
        command_id: uuid::Uuid,
        /// 迁移前状态。
        from: outbox::OutboxStatus,
        /// 迁移目标状态。
        to: outbox::OutboxStatus,
    },
    /// 重发穿透防护：同 commandId 已存在（§4.4 去重表）。
    #[error("duplicate command {command_id} already in state {state}")]
    DuplicateCommand {
        /// 命令 id。
        command_id: uuid::Uuid,
        /// 已存在记录的状态。
        state: outbox::OutboxStatus,
    },
    /// chat 不存在。
    #[error("chat {chat_id} not found")]
    ChatNotFound {
        /// chat id。
        chat_id: uuid::Uuid,
    },
    /// outbox 记录不存在（迁移/查询目标 commandId 无记录）。
    #[error("command {command_id} not found in outbox")]
    CommandNotFound {
        /// 命令 id。
        command_id: uuid::Uuid,
    },
}

pub use store::{ChatStore, Store};

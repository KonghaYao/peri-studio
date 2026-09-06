//! SQLite navigation catalog for project metadata.
//!
//! This store is deliberately separate from the existing Yjs/outbox file logs.
//! SQLite is authoritative for project navigation metadata; session catalog facts
//! come from ACP `session/list` (ADR-0003). Registry Doc maps are a rebuildable
//! projection owned by `ProjectService`.

use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Row, SqlitePool};
use thiserror::Error;
use uuid::Uuid;
// 结构拆分：schema 迁移 / 命令账本 / 项目会话 CRUD / 重启恢复为同目录
// 实现段（`metadata_migrations.rs` / `metadata_commands.rs` /
// `metadata_catalog.rs` / `metadata_sessions.rs` / `metadata_recovery.rs`）。
#[path = "metadata_catalog.rs"]
mod metadata_catalog;
#[path = "metadata_commands.rs"]
mod metadata_commands;
#[path = "metadata_migrations.rs"]
mod metadata_migrations;
#[path = "metadata_recovery.rs"]
mod metadata_recovery;
#[path = "metadata_sessions.rs"]
mod metadata_sessions;
#[path = "metadata_catalog_sessions.rs"]
mod metadata_catalog_sessions;
#[path = "machine_phases.rs"]
pub mod machine_phases;
#[path = "metadata_machines.rs"]
mod metadata_machines;

pub use machine_phases::{
    connect_entry_phase, is_in_progress, is_terminal_failure, normalize_ssh_hostname,
    normalize_ssh_destination,
    PHASE_AWAITING_HOST_KEY, PHASE_AWAITING_REPLACE, PHASE_CONNECTING, PHASE_FAILED, PHASE_HOST_KEY_PROBE, PHASE_INSTALL,
    PHASE_OFFLINE, PHASE_ONLINE, PHASE_PENDING, PHASE_PROBE, PHASE_PROVISION, PHASE_SSH_CONNECT,
    PHASE_START, PHASE_TUNNEL,
};
pub use metadata_catalog_sessions::{CatalogSessionPref, CatalogSessionPrefMap, catalog_session_pref_map};
pub use metadata_machines::{AdmitSshMachineParams, MachineRecord, new_ssh_instance_id};

pub const METADATA_DB_FILE: &str = "metadata.sqlite3";
#[derive(Debug, Error)]
pub enum MetadataError {
    #[error("metadata database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("metadata schema version {found} is newer than supported {supported}")]
    NewerSchema { found: i64, supported: i64 },
    #[error("metadata conflict: {0}")]
    Conflict(String),
    #[error("metadata not found: {0}")]
    NotFound(String),
    #[error("metadata invalid state: {0}")]
    InvalidState(String),
}

pub type Result<T> = std::result::Result<T, MetadataError>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub cwd: String,
    pub instance_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
}

/// In-memory Registry projection carrier; not persisted after schema v7.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectSessionRecord {
    pub id: String,
    pub project_id: String,
    pub acp_session_id: Option<String>,
    pub acp_title: Option<String>,
    pub custom_name: Option<String>,
    /// Hub-derived fallback from the first safely-dispatched user prompt.
    /// This is presentation metadata, not an ACP title mutation.
    pub hub_title: Option<String>,
    pub lifecycle: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: Option<String>,
    pub last_chat_id: Option<String>,
    pub failure_code: Option<String>,
    pub origin: String,
    /// Navigation-only soft archive marker. The runtime lifecycle remains
    /// untouched so restore never invents a prior state.
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MetadataSnapshot {
    pub generation: i64,
    pub projects: Vec<ProjectRecord>,
    pub sessions: Vec<ProjectSessionRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionRuntimeRecord {
    pub session_id: String,
    pub chat_id: String,
    pub activated_at: String,
    pub retired_at: Option<String>,
}

/// 活跃 runtime chat 的视图重建投影（内存态；server 重启后由 ChatRegistry 与
/// ACP `session/list` 重建，不再从 SQLite 恢复）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeChatView {
    pub chat_id: String,
    pub instance_id: String,
    pub acp_session_id: Option<String>,
    pub title: String,
    pub cwd: String,
    pub workspace_id: Option<String>,
}

impl ProjectSessionRecord {
    pub fn display_title(&self) -> String {
        self.custom_name
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| self.acp_title.as_deref().filter(|s| meaningful_title(s)))
            .or_else(|| self.hub_title.as_deref().filter(|s| !s.trim().is_empty()))
            .or_else(|| self.acp_title.as_deref().filter(|s| !s.trim().is_empty()))
            .unwrap_or("新对话")
            .to_string()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MetadataCommand {
    pub command_id: String,
    pub command_type: String,
    pub payload_hash: String,
    pub phase: String,
    pub project_id: Option<String>,
    pub session_id: Option<String>,
    pub chat_id: Option<String>,
    pub acp_session_id: Option<String>,
    pub instance_id: Option<String>,
    pub error_code: Option<String>,
}

/// Body-free durable outcome for an OAuth mutation. The record deliberately
/// cannot carry authorization URLs, callback material, provider responses, or
/// raw errors; action payloads enter this store only as a one-way fingerprint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OAuthCommandRecord {
    pub command_id: String,
    pub command_type: String,
    pub chat_id: String,
    pub payload_fingerprint: String,
    pub phase: String,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BeginOAuthCommand {
    New,
    Existing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BeginCommand {
    New,
    Existing,
}

pub struct NewSession<'a> {
    pub id: &'a str,
    pub project_id: &'a str,
    pub title: Option<&'a str>,
}

#[derive(Clone)]
pub struct MetadataStore {
    pool: SqlitePool,
    path: PathBuf,
    _owner_lock: std::sync::Arc<File>,
}

impl MetadataStore {
    pub async fn open(data_dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(data_dir).map_err(sqlx::Error::Io)?;
        let lock_path = data_dir.join("metadata.owner.lock");
        let owner_lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&lock_path)
            .map_err(sqlx::Error::Io)?;
        set_private_permissions(&lock_path)?;
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            let rc = unsafe { libc::flock(owner_lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
            if rc != 0 {
                return Err(MetadataError::Conflict(
                    "metadata database is owned by another server process".into(),
                ));
            }
        }
        let path = data_dir.join(METADATA_DB_FILE);
        let opts = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Full)
            .busy_timeout(Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await?;
        let store = Self {
            pool,
            path,
            _owner_lock: std::sync::Arc::new(owner_lock),
        };
        // 先收紧已存在的 sidecar 权限再 migrate：migrate 写事务可能创建
        // `-wal`/`-shm`，若先 migrate 后收紧存在理论暴露窗口（进程内
        // 实际不可观测，但顺序颠倒零成本，§4 最小暴露窗口）。
        store.secure_sidecars()?;
        store.migrate().await?;
        store.verify_pragmas().await?;
        set_private_permissions(&store.path)?;
        // migrate 新建的 `-wal`/`-shm` 默认 0644：创建后再收紧一次，
        // 维持「全部 db 相关文件 0600」纪律（owner_lock 测试断言）。
        store.secure_sidecars()?;
        Ok(store)
    }

    fn secure_sidecars(&self) -> Result<()> {
        for suffix in ["-wal", "-shm"] {
            let path = PathBuf::from(format!("{}{}", self.path.display(), suffix));
            if path.exists() {
                set_private_permissions(&path)?;
            }
        }
        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

async fn bump_generation_tx(tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>) -> Result<()> {
    sqlx::query(
        "UPDATE projection_state SET generation=generation+1,updated_at=? WHERE singleton=1",
    )
    .bind(now())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn project_from_row(r: sqlx::sqlite::SqliteRow) -> ProjectRecord {
    ProjectRecord {
        id: r.get(0),
        name: r.get(1),
        cwd: r.get(2),
        instance_id: r.get(3),
        created_at: r.get(4),
        updated_at: r.get(5),
        archived_at: r.get(6),
    }
}

fn oauth_command_from_row(r: sqlx::sqlite::SqliteRow) -> OAuthCommandRecord {
    OAuthCommandRecord {
        command_id: r.get(0),
        command_type: r.get(1),
        chat_id: r.get(2),
        payload_fingerprint: r.get(3),
        phase: r.get(4),
        error_code: r.get(5),
    }
}

fn meaningful_title(title: &str) -> bool {
    let normalized = title.trim().to_lowercase();
    !normalized.is_empty()
        && !matches!(
            normalized.as_str(),
            "新对话" | "未命名会话" | "untitled" | "new conversation" | "new chat"
        )
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn set_private_permissions(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(path)
            .map_err(sqlx::Error::Io)?
            .permissions();
        permissions.set_mode(0o600);
        std::fs::set_permissions(path, permissions).map_err(sqlx::Error::Io)?;
    }
    Ok(())
}

pub fn payload_hash(value: &impl Serialize) -> Result<String> {
    use sha2::{Digest, Sha256};
    let bytes =
        serde_json::to_vec(value).map_err(|e| MetadataError::InvalidState(e.to_string()))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}

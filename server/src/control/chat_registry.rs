//! chat 注册表（架构 §7.3/§7.6/§8.3）。
//!
//! chat 生命周期（§7.3）+ 可信 binding（§6.1：`session_id → chat_id`）+
//! pending_close（§7.6：offline 时 close 补发）+ 重连对账（§8.3 步骤 5：
//! alive_sessions 与 Registry 比对）。
//!
//! Registry Doc `chats.status` 的进程内镜像（状态写回经 `RegistryState`，
//! server 状态源单写，§5.2）。

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};

use peri_studio_proto::schema::SessionConfigOptionProjection;
use chrono::{DateTime, Utc};
use tokio::sync::{Mutex, OwnedMutexGuard, RwLock};
use tracing::{debug, info, warn};

use peri_studio_proto::schema::ChatSummary;

use crate::state::registry::{RegistryError, RegistryState};

/// chat 级状态（§7.3/§7.6；`chats.status` 字符串映射）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatState {
    /// create 后、binding 前。
    Accepting,
    /// ACP 进程退出（终态，视图保留）。
    Ended,
    /// 用户关闭（终态）。
    Closed,
    /// 进程崩溃（终态）。
    Crashed,
    /// instance 分区（可恢复；补推追平后清除，§7.3）。
    Gap,
    /// close 遇 offline（§7.6；instance 重连后补发 kill）。
    PendingClose,
}

impl ChatState {
    /// Registry `chats.status` 字符串（§5.5 M1 透传）。
    pub fn as_str(self) -> &'static str {
        match self {
            ChatState::Accepting => "accepting",
            ChatState::Ended => "ended",
            ChatState::Closed => "closed",
            ChatState::Crashed => "crashed",
            ChatState::Gap => "gap",
            ChatState::PendingClose => "pending_close",
        }
    }

    /// 是否终态（ended/closed/crashed；§8.2「不再接受该 chat 的新事件」）。
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            ChatState::Ended | ChatState::Closed | ChatState::Crashed
        )
    }
}

/// chat 条目（进程内镜像）。
#[derive(Debug, Clone, PartialEq)]
pub struct ChatRecord {
    /// chat 状态。
    pub state: ChatState,
    /// 归属 instance。
    pub instance_id: String,
    /// 标题。
    pub title: String,
    /// binding 建立后的 session_id（ACP 会话，§6.2）。
    pub session_id: Option<String>,
    /// ACP 进程工作目录（继承自 workspace 或 server 默认目录，§6.3
    /// workspace 扩展；session/list 轮询查询面）。
    pub cwd: String,
    /// 归属工作区（无 → None；工作区删除后已建对话保留此引用）。
    pub workspace_id: Option<String>,
    /// 创建时刻（server 权威时钟，§4.7）。
    pub created_at: DateTime<Utc>,
    /// 最近变更时刻。
    pub updated_at: DateTime<Utc>,
    /// 该 chat 的 ACP 进程是否存在**存活证据**（spawn 成功、instance
    /// 心跳上报 alive、ACP 帧到达）。server 重启重建视图时无任何证据
    /// 默认为 false，等待 instance hello 对账裁决；未确认的 chat 不作为
    /// live runtime 复用（session/open 走 spawn + `session/load`），
    /// 也不参与 session/list 轮询通道选择。
    pub runtime_confirmed: bool,
}

/// chat 操作错误。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ChatError {
    /// chat 未登记。
    #[error("chat not found: {0}")]
    NotFound(String),
    /// binding 冲突（session_id 已绑定到另一 chat；参数 = 已绑定的 chat_id）。
    #[error("binding conflict: session already bound to chat {0}")]
    BindingConflict(String),
    /// Registry 状态写回失败。
    #[error("registry write failed: {0}")]
    Registry(#[from] RegistryError),
}

// 结构拆分：binding 生命周期 / restart 对账 / 活动 turn 为同目录实现段。
#[path = "chat_binding.rs"]
mod chat_binding;
#[path = "chat_reconcile.rs"]
mod chat_reconcile;
#[path = "chat_turns.rs"]
mod chat_turns;

pub use chat_reconcile::ReconciliationReport;

/// 活动 turn 表条目（#3 增量窗口计时：turn 活跃期间的 last_activity 由
/// relay 事件投递成功（[`ChatRegistry::touch_active_turn`]）续命；
/// exec_prompt L3 窗口据此判定——仅对「无增量窗口」计时，§4.4 路径 B 变体）。
#[derive(Debug, Clone)]
struct ActiveTurnEntry {
    turn_id: String,
    /// 最近一次该 chat 事件投递时刻（单调时钟；relay touch 更新）。
    last_activity: Instant,
}

/// chat 注册表（§7.3 状态机 + binding + pending_close + 对账）。
#[derive(Clone)]
pub struct ChatRegistry {
    inner: Arc<ChatInner>,
}

struct ChatInner {
    chats: RwLock<HashMap<String, ChatRecord>>,
    /// 可信 binding：session_id（ACP 会话）→ chat_id（§6.1 规则 5）。
    bindings: RwLock<HashMap<String, String>>,
    /// pending_close 补发集合（§7.6）。
    pending_close: RwLock<HashSet<String>>,
    /// 活动 turn 登记（chat → turn 条目；断链清理输入，§7.1「活动 turn →
    /// interrupted」。coordinator 登记、relay touch 续命、断链清理消费；
    /// #3 last_activity 增量窗口计时）。
    active_turns: RwLock<HashMap<String, ActiveTurnEntry>>,
    /// 不投影到 Registry 的短生命周期 ACP 进程。仅用于 project 级
    /// session discovery；心跳对账必须把它们视为受 server 管理，避免当作
    /// 孤儿提前 kill。
    ephemeral_chats: RwLock<HashSet<String>>,
    /// Initialize-time Peri extensions echoed by this exact runtime. This is a
    /// process-local authorization fact; the Control Doc projection is only a view.
    extensions: RwLock<HashMap<String, HashSet<String>>>,
    /// Latest Agent-authoritative ACP session config catalog for each live
    /// runtime. This is the validation source; Yjs is its browser projection.
    config_catalogs: RwLock<HashMap<String, Vec<SessionConfigOptionProjection>>>,
    /// Serializes the short boundary where a prompt becomes active against a
    /// full config mutation. Weak entries avoid permanent per-chat growth.
    runtime_transition_gates: Mutex<HashMap<String, Weak<Mutex<()>>>>,
    registry: RegistryState,
}

impl ChatRegistry {
    /// 以 Registry 状态源句柄构建。
    pub fn new(registry: RegistryState) -> Self {
        ChatRegistry {
            inner: Arc::new(ChatInner {
                chats: RwLock::new(HashMap::new()),
                bindings: RwLock::new(HashMap::new()),
                pending_close: RwLock::new(HashSet::new()),
                active_turns: RwLock::new(HashMap::new()),
                ephemeral_chats: RwLock::new(HashSet::new()),
                extensions: RwLock::new(HashMap::new()),
                config_catalogs: RwLock::new(HashMap::new()),
                runtime_transition_gates: Mutex::new(HashMap::new()),
                registry,
            }),
        }
    }

    pub async fn set_extensions(&self, chat_id: &str, extensions: &[String]) {
        self.inner
            .extensions
            .write()
            .await
            .insert(chat_id.to_string(), extensions.iter().cloned().collect());
    }

    pub async fn supports_extension(&self, chat_id: &str, extension: &str) -> bool {
        self.inner
            .extensions
            .read()
            .await
            .get(chat_id)
            .is_some_and(|extensions| extensions.contains(extension))
    }

    pub async fn set_config_catalog(
        &self,
        chat_id: &str,
        options: Vec<SessionConfigOptionProjection>,
    ) {
        self.inner
            .config_catalogs
            .write()
            .await
            .insert(chat_id.to_string(), options);
    }

    pub async fn config_catalog(
        &self,
        chat_id: &str,
    ) -> Option<Vec<SessionConfigOptionProjection>> {
        self.inner
            .config_catalogs
            .read()
            .await
            .get(chat_id)
            .cloned()
    }

    pub async fn clear_config_catalog(&self, chat_id: &str) {
        self.inner.config_catalogs.write().await.remove(chat_id);
    }

    pub async fn runtime_transition_guard(&self, chat_id: &str) -> OwnedMutexGuard<()> {
        let gate = {
            let mut gates = self.inner.runtime_transition_gates.lock().await;
            gates.retain(|_, gate| gate.strong_count() > 0);
            if let Some(gate) = gates.get(chat_id).and_then(Weak::upgrade) {
                gate
            } else {
                let gate = Arc::new(Mutex::new(()));
                gates.insert(chat_id.to_string(), Arc::downgrade(&gate));
                gate
            }
        };
        gate.lock_owned().await
    }

    /// Registry 状态源句柄（session/list 轮询投影等全局写入用）。
    pub fn registry(&self) -> RegistryState {
        self.inner.registry.clone()
    }

    /// create 登记（coordinator create 流程调用；状态 = Accepting）。
    ///
    /// Registry Doc 写回顺序（§5.2 单写）：先 `upsert_chat` 建立条目
    /// （Registry 读侧/TUI 对话列表的权威源），再 `set_chat_status` 迁移
    /// 状态——`set_chat_status` 要求条目已存在（state 层 applier 契约）。
    ///
    /// `cwd`：ACP 进程工作目录（继承自 workspace 或 server 默认目录，
    /// §6.3 workspace 扩展）；`workspace_id`：归属工作区（无 → None）。
    pub async fn register(
        &self,
        chat_id: &str,
        instance_id: &str,
        title: Option<&str>,
        cwd: &str,
        workspace_id: Option<&str>,
    ) -> Result<(), ChatError> {
        let now = Utc::now();
        let title = title.unwrap_or_default();
        let entry = ChatRecord {
            state: ChatState::Accepting,
            instance_id: instance_id.to_string(),
            title: title.to_string(),
            session_id: None,
            cwd: cwd.to_string(),
            workspace_id: workspace_id.map(str::to_string),
            created_at: now,
            updated_at: now,
            runtime_confirmed: false,
        };
        self.inner
            .chats
            .write()
            .await
            .insert(chat_id.to_string(), entry);
        // Registry 条目建立（upsert 幂等；chat_id 由 server 生成，无冲突）。
        self.inner
            .registry
            .upsert_chat(ChatSummary {
                id: chat_id.to_string(),
                instance_id: instance_id.to_string(),
                title: title.to_string(),
                status: ChatState::Accepting.as_str().to_string(),
                gap: None,
                updated_at: now.to_rfc3339(),
                cwd: cwd.to_string(),
                workspace_id: workspace_id.map(str::to_string),
            })
            .await?;
        self.inner
            .registry
            .set_chat_status(chat_id, ChatState::Accepting.as_str())
            .await?;
        debug!(chat_id, instance_id, "chat registered");
        Ok(())
    }
    pub async fn entry(&self, chat_id: &str) -> Option<ChatRecord> {
        self.inner.chats.read().await.get(chat_id).cloned()
    }

    /// Whether a project/workspace still owns any non-terminal runtime.
    /// Project archival uses this in-memory runtime authority rather than the
    /// persisted `last_chat_id` hint, which can be stale after close/restart.
    pub async fn has_live_workspace(&self, workspace_id: &str) -> bool {
        self.inner.chats.read().await.values().any(|chat| {
            chat.workspace_id.as_deref() == Some(workspace_id) && !chat.state.is_terminal()
        })
    }

    /// Runtime authority for a durable ACP session. Persisted last_chat_id is
    /// only a hint; archival must inspect the in-memory binding and chat state.
    pub async fn has_live_acp_session(&self, session_id: &str) -> bool {
        let Some(chat_id) = self.inner.bindings.read().await.get(session_id).cloned() else {
            return false;
        };
        self.inner
            .chats
            .read()
            .await
            .get(&chat_id)
            .is_some_and(|chat| !chat.state.is_terminal())
    }

    /// instance offline 时的 close（§7.6）：返回 pending_close 标记（Registry
    /// 状态写回）；kill 补发由重连对账完成。
    pub async fn request_close_offline(&self, chat_id: &str) -> Result<(), ChatError> {
        let mut chats = self.inner.chats.write().await;
        let Some(entry) = chats.get_mut(chat_id) else {
            return Err(ChatError::NotFound(chat_id.to_string()));
        };
        entry.state = ChatState::PendingClose;
        entry.updated_at = Utc::now();
        self.inner
            .pending_close
            .write()
            .await
            .insert(chat_id.to_string());
        drop(chats);
        self.inner
            .registry
            .set_chat_status(chat_id, ChatState::PendingClose.as_str())
            .await?;
        warn!(
            chat_id,
            "chat close deferred: instance offline (pending_close)"
        );
        Ok(())
    }

    /// 状态迁移 + Registry 写回（§7.3/§7.6；终态不可逆，防御性检查）。
    pub async fn transition(&self, chat_id: &str, state: ChatState) -> Result<(), ChatError> {
        let mut chats = self.inner.chats.write().await;
        let Some(entry) = chats.get_mut(chat_id) else {
            return Err(ChatError::NotFound(chat_id.to_string()));
        };
        if entry.state.is_terminal() && entry.state != state {
            warn!(
                chat_id,
                from = entry.state.as_str(),
                to = state.as_str(),
                "chat terminal state transition rejected (防御)"
            );
            return Ok(());
        }
        entry.state = state;
        entry.updated_at = Utc::now();
        if state == ChatState::Closed {
            // pending_close 完成：补发集合清除（§7.6）。
            self.inner.pending_close.write().await.remove(chat_id);
        }
        // 终态前取走 session_id（drop 后不可用；仅终态需要）。
        let bound_session = if state.is_terminal() {
            entry.session_id.clone()
        } else {
            None
        };
        drop(chats);
        // 终态：释放 binding（§8.5 激活语义）——对话关闭/崩溃后其 ACP
        // 会话不再被占用，可被再次激活/加载（否则 bindings 永不清理，
        // 会话重启前永远冲突）。
        if let Some(sid) = bound_session {
            let mut bindings = self.inner.bindings.write().await;
            if bindings.get(&sid).map(String::as_str) == Some(chat_id) {
                bindings.remove(&sid);
                debug!(chat_id, session_id = %sid, "binding released (terminal)");
            }
        }
        if state.is_terminal() {
            self.inner.extensions.write().await.remove(chat_id);
            self.inner.config_catalogs.write().await.remove(chat_id);
        }
        self.inner
            .registry
            .set_chat_status(chat_id, state.as_str())
            .await?;
        debug!(chat_id, state = state.as_str(), "chat state transitioned");
        Ok(())
    }

    /// 该 instance 的全部活 chat（断链清理输入，§8.2 matrix instance 行）。
    pub async fn chats_for_instance(&self, instance_id: &str) -> Vec<(String, ChatState)> {
        self.inner
            .chats
            .read()
            .await
            .iter()
            .filter(|(_, e)| e.instance_id == instance_id)
            .map(|(id, e)| (id.clone(), e.state))
            .collect()
    }

    /// 全部 chat 条目快照（session 轮询输入，§6.3；含终态，筛选由调用方）。
    pub async fn all_chats(&self) -> Vec<(String, ChatRecord)> {
        self.inner
            .chats
            .read()
            .await
            .iter()
            .map(|(id, e)| (id.clone(), e.clone()))
            .collect()
    }

    pub async fn register_ephemeral(&self, chat_id: &str) {
        self.inner
            .ephemeral_chats
            .write()
            .await
            .insert(chat_id.to_string());
    }

    pub async fn unregister_ephemeral(&self, chat_id: &str) {
        self.inner.ephemeral_chats.write().await.remove(chat_id);
    }

    /// pending_close 集合快照（诊断/测试）。
    pub async fn pending_close_chats(&self) -> Vec<String> {
        self.inner
            .pending_close
            .read()
            .await
            .iter()
            .cloned()
            .collect()
    }

}

#[cfg(test)]
#[path = "chat_registry_test.rs"]
mod chat_registry_test;

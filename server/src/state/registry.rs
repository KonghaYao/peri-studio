//! Registry Doc 写入者（server 状态源单写接口，§5.2/§5.5/§17.2）。
//!
//! Registry Doc（`hub:registry`）是 TUI 会话列表与机器列表的**唯一权威源**：
//! 活跃 chat 摘要由 server 状态源单写（chat 生命周期事件驱动：
//! create/binding/终态/close 时更新），**不从 chat Doc 聚合**（§5.2 裁决）。
//! 聚合器不直写 Registry Doc（gap 经上报路径，§9.4）。
//!
//! 拆分说明（结构拆分，行为不变）：本文件仅保留命令类型（[`RegistryMsg`]）、
//! 错误（[`RegistryError`]）、Degraded 判定（[`DegradeCause`]）与客户端句柄
//! （[`RegistryState`]）；Registry Doc 写入执行体（[`RegistryApplier`]）与
//! `write_*` 写辅助函数位于 `registry_write.rs`（同主题职责），经
//! `pub(crate) use` 在此 re-export，调用方 import 路径不变。

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tokio::sync::{mpsc, oneshot};

use peri_studio_proto::schema::{
    ChatSummary, GlobalStatus, InstanceStatus, InstanceView, ProjectSessionSummary, ProjectSummary,
    SessionSummaryProjection, WorkspaceSummary,
};

use crate::state::doc_manager::DocCommand;

pub(crate) use super::registry_write::RegistryApplier;

/// Registry 写者命令（Registry Doc 无 chat 维度：低频、无微批次、即到即写，
/// §8.5【决策】路由到全局 registry 写者）。
pub(crate) enum RegistryMsg {
    /// 通用命令（§8.5 Registry 系）。
    Command(DocCommand, oneshot::Sender<Result<(), RegistryError>>),
    /// gap 写回（§9.4/§12.4）：`Some(count)` 置缺口、`None` 追平清除。
    SetChatGap {
        chat_id: String,
        gap: Option<u64>,
        reply: oneshot::Sender<Result<(), RegistryError>>,
    },
    /// chat 状态迁移写回（§7.3/§7.6）。
    SetChatStatus {
        chat_id: String,
        status: String,
        reply: oneshot::Sender<Result<(), RegistryError>>,
    },
    /// workspace 全量查询（启动恢复：内存注册表从 Registry Doc 重建）。
    ListWorkspaces(oneshot::Sender<Vec<WorkspaceSummary>>),
    ListLegacySessions(oneshot::Sender<Vec<SessionSummaryProjection>>),
}

/// Registry 操作错误。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RegistryError {
    /// 写者已退出（channel closed）。
    #[error("registry writer closed")]
    ChannelClosed,
    /// 目标条目不存在（如 set_instance_status 的 instance 未注册）。
    #[error("registry entry not found: {0}")]
    NotFound(String),
}

/// Degraded 判定输入（§17.2：任一触发 Degraded）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DegradeCause {
    /// 落盘失败（F6 上报）。
    PersistFailure,
    /// 缓冲溢出丢弃（channel 层上报，§8.5）。
    BufferDropped,
    /// 任一存活 chat 存在 gap（聚合器上报，§9.4）。
    ChatGap,
    /// 镜像失败（聚合器/writer task 异常，§17.2）。
    ProjectionError,
    /// 启动恢复不变量失败（§8.4.1，F6/恢复流程上报）。
    RestoreInvariant,
}

impl DegradeCause {
    fn label(self) -> &'static str {
        match self {
            DegradeCause::PersistFailure => "persist_failure",
            DegradeCause::BufferDropped => "buffer_dropped",
            DegradeCause::ChatGap => "chat_gap",
            DegradeCause::ProjectionError => "projection_error",
            DegradeCause::RestoreInvariant => "restore_invariant",
        }
    }
}

/// Registry Doc 写入者（server 状态源单写接口，§5.2）。
///
/// 内部经 DocManager 全局 registry 写者执行（§8.5 命令路由）；调用方为
/// channel 层（instance 生命周期，F7/F8）与恢复流程（F6）。
#[derive(Clone)]
pub struct RegistryState {
    inner: Arc<RegistryInner>,
}

struct RegistryInner {
    tx: mpsc::Sender<RegistryMsg>,
    /// 活跃 degraded 条件集合（§12.3 判定集中）。
    ///
    /// 锁 poison 恢复（`unwrap_or_else(|e| e.into_inner())`，§5 并发故障面）：
    /// 持锁期间 panic（如 DegradeCause 处理逻辑异常）后，判定路径不得再
    /// panic——单点 panic 即全局 degraded 判定中断，恢复后集合内容仍可信
    /// （panic 前已 insert/remove 的数据保留）。
    conditions: Mutex<HashSet<DegradeCause>>,
    /// server 启动回放期标志（§8.4.1）。
    restarting: AtomicBool,
}

impl RegistryState {
    pub(crate) fn new(tx: mpsc::Sender<RegistryMsg>) -> Self {
        RegistryState {
            inner: Arc::new(RegistryInner {
                tx,
                conditions: Mutex::new(HashSet::new()),
                restarting: AtomicBool::new(false),
            }),
        }
    }

    /// instance 视图 upsert（hello 注册/心跳/offline；§7.1）。
    pub async fn upsert_instance(&self, m: InstanceView) -> Result<(), RegistryError> {
        self.send(DocCommand::RegistryUpsertInstance(m)).await
    }

    /// instance 状态更新（online/offline/unknown；心跳超时驱动）。
    pub async fn set_instance_status(
        &self,
        instance_id: &str,
        status: InstanceStatus,
    ) -> Result<(), RegistryError> {
        self.send(DocCommand::RegistrySetInstanceState {
            instance_id: instance_id.to_string(),
            status,
        })
        .await
    }

    /// 活跃 chat 摘要 upsert（create/binding 建立/标题/终态/gap 同步）。
    pub async fn upsert_chat(&self, s: ChatSummary) -> Result<(), RegistryError> {
        self.send(DocCommand::RegistryUpsertChat(s)).await
    }

    /// 移除（chat close 清理）。
    pub async fn remove_chat(&self, chat_id: &str) -> Result<(), RegistryError> {
        self.send(DocCommand::RegistryRemoveChat {
            chat_id: chat_id.to_string(),
        })
        .await
    }

    /// gap 写回（聚合器上报，§9.4）：`Some(count)` 置缺口、`None` 追平清除。
    pub async fn set_chat_gap(&self, chat_id: &str, gap: Option<u64>) -> Result<(), RegistryError> {
        let (reply, rx) = oneshot::channel();
        self.inner
            .tx
            .send(RegistryMsg::SetChatGap {
                chat_id: chat_id.to_string(),
                gap,
                reply,
            })
            .await
            .map_err(|_| RegistryError::ChannelClosed)?;
        rx.await.map_err(|_| RegistryError::ChannelClosed)?
    }

    /// chat 状态迁移（accepting/active/ended/closed/crashed + pending_close，
    /// §7.3/§7.6）。
    pub async fn set_chat_status(&self, chat_id: &str, status: &str) -> Result<(), RegistryError> {
        let (reply, rx) = oneshot::channel();
        self.inner
            .tx
            .send(RegistryMsg::SetChatStatus {
                chat_id: chat_id.to_string(),
                status: status.to_string(),
                reply,
            })
            .await
            .map_err(|_| RegistryError::ChannelClosed)?;
        rx.await.map_err(|_| RegistryError::ChannelClosed)?
    }

    /// 全局状态（§17.2）：条件上报，任一 cause 活跃 → Degraded。
    pub async fn report_condition(&self, cause: DegradeCause) -> Result<(), RegistryError> {
        let was_empty = {
            let mut conditions = self.inner.conditions.lock().unwrap_or_else(|e| e.into_inner());
            let was_empty = conditions.is_empty();
            conditions.insert(cause);
            was_empty
        };
        if was_empty && !self.inner.restarting.load(Ordering::SeqCst) {
            self.set_global(GlobalStatus::Degraded).await?;
        }
        tracing::warn!(
            cause = cause.label(),
            degraded = true,
            "degraded condition reported"
        );
        Ok(())
    }

    /// 全局状态（§17.2）：条件清除；全部清除 → Healthy。
    pub async fn clear_condition(&self, cause: DegradeCause) -> Result<(), RegistryError> {
        let empty = {
            let mut conditions = self.inner.conditions.lock().unwrap_or_else(|e| e.into_inner());
            conditions.remove(&cause);
            conditions.is_empty()
        };
        if empty && !self.inner.restarting.load(Ordering::SeqCst) {
            self.set_global(GlobalStatus::Healthy).await?;
        }
        tracing::info!(cause = cause.label(), "degraded condition cleared");
        Ok(())
    }

    /// 启动回放期置 Restarting（§8.4.1；恢复流程显式调用）。
    pub async fn set_restarting(&self) -> Result<(), RegistryError> {
        self.inner.restarting.store(true, Ordering::SeqCst);
        self.set_global(GlobalStatus::Restarting).await
    }

    /// 恢复完成置出 Restarting（§8.4.1【决策】补充：设计稿 §12.2 仅有置入，
    /// 「恢复不变量完成置 Healthy」需要置出接口）。
    pub async fn clear_restarting(&self) -> Result<(), RegistryError> {
        self.inner.restarting.store(false, Ordering::SeqCst);
        let degraded = !self.inner.conditions.lock().unwrap_or_else(|e| e.into_inner()).is_empty();
        let status = if degraded {
            GlobalStatus::Degraded
        } else {
            GlobalStatus::Healthy
        };
        self.set_global(status).await
    }

    /// 当前判定状态（读 Registry Doc global.status 的镜像；条件集合为空且非
    /// restarting → Healthy，否则 Degraded）。供 F7 消费（拒绝新 committed）。
    pub fn global_status(&self) -> GlobalStatus {
        if self.inner.restarting.load(Ordering::SeqCst) {
            return GlobalStatus::Restarting;
        }
        if self.inner.conditions.lock().unwrap_or_else(|e| e.into_inner()).is_empty() {
            GlobalStatus::Healthy
        } else {
            GlobalStatus::Degraded
        }
    }

    /// ACP `session/list` 全量同步投影（§6.3，instance 级数据 → Registry
    /// Doc `sessions` map；幂等 + 自愈删除）。轮询器每 instance 一轮调一次。
    pub async fn apply_sessions(
        &self,
        entries: Vec<SessionSummaryProjection>,
    ) -> Result<(), RegistryError> {
        self.send(DocCommand::RegistryApplySessions { entries })
            .await
    }

    /// 工作区摘要 upsert（create/rename；Registry Doc `workspaces` map）。
    pub async fn upsert_workspace(&self, w: WorkspaceSummary) -> Result<(), RegistryError> {
        self.send(DocCommand::RegistryUpsertWorkspace(w)).await
    }

    /// 工作区移除（Registry Doc `workspaces` map 删键；已建对话不受影响）。
    pub async fn remove_workspace(&self, workspace_id: &str) -> Result<(), RegistryError> {
        self.send(DocCommand::RegistryRemoveWorkspace {
            workspace_id: workspace_id.to_string(),
        })
        .await
    }

    /// 工作区全量查询（启动恢复用：workspace 内存注册表从 Registry Doc 重建，
    /// 保证重启后 create 继承 cwd 仍可用）。
    pub async fn list_workspaces(&self) -> Result<Vec<WorkspaceSummary>, RegistryError> {
        let (reply, rx) = oneshot::channel();
        self.inner
            .tx
            .send(RegistryMsg::ListWorkspaces(reply))
            .await
            .map_err(|_| RegistryError::ChannelClosed)?;
        rx.await.map_err(|_| RegistryError::ChannelClosed)
    }

    pub async fn list_legacy_sessions(
        &self,
    ) -> Result<Vec<SessionSummaryProjection>, RegistryError> {
        let (reply, rx) = oneshot::channel();
        self.inner
            .tx
            .send(RegistryMsg::ListLegacySessions(reply))
            .await
            .map_err(|_| RegistryError::ChannelClosed)?;
        rx.await.map_err(|_| RegistryError::ChannelClosed)
    }

    pub async fn replace_projects(
        &self,
        projects: Vec<ProjectSummary>,
        sessions: Vec<ProjectSessionSummary>,
    ) -> Result<(), RegistryError> {
        self.send(DocCommand::RegistryReplaceProjects { projects, sessions })
            .await
    }

    async fn set_global(&self, status: GlobalStatus) -> Result<(), RegistryError> {
        self.send(DocCommand::RegistrySetGlobal { status }).await
    }

    async fn send(&self, cmd: DocCommand) -> Result<(), RegistryError> {
        let (reply, rx) = oneshot::channel();
        self.inner
            .tx
            .send(RegistryMsg::Command(cmd, reply))
            .await
            .map_err(|_| RegistryError::ChannelClosed)?;
        rx.await.map_err(|_| RegistryError::ChannelClosed)?
    }
}

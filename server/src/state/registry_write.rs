//! Registry Doc 写入执行体（`registry.rs` 的写侧拆分，§5.2/§5.5/§17.2）。
//!
//! 职责边界：本文件承载 Registry Doc 的**写入执行**——[`RegistryApplier`]
//! （DocManager spawn 的全局 registry 写者执行体，唯一提交边界内的
//! 命令应用）与 `write_*` 写辅助函数（instance/chat/workspace 摘要的
//! Y.Map 字段序列化，含重启不覆盖语义 §5.5）及状态字符串映射。
//!
//! 拆分动机（结构拆分，行为不变）：原 `registry.rs` 超过 500 行，按主题
//! 一分为二——命令面（类型/错误/句柄）留在 `registry.rs`，执行面在此；
//! [`RegistryApplier`] 经 `registry.rs` 的 `pub(crate) use` re-export，
//! 调用方（doc_manager/测试）import 路径不变。

use yrs::{Map, ReadTxn, Transact, WriteTxn};

use peri_studio_proto::schema::{
    ChatSummary, GlobalStatus, InstanceStatus, InstanceView, SessionSummaryProjection,
    WorkspaceSummary,
};

use crate::state::doc_manager::DocCommand;
use crate::state::factory::ROOT;
use crate::state::registry::RegistryError;
use crate::state::session_list;

/// Registry Doc 写者执行体：应用命令到 Registry Doc。
pub(crate) struct RegistryApplier {
    pub(crate) doc: yrs::Doc,
}

impl RegistryApplier {
    pub(crate) fn new(doc: yrs::Doc) -> Self {
        RegistryApplier { doc }
    }

    /// 执行一条 registry 命令。
    pub(crate) fn apply(&mut self, cmd: &DocCommand) -> Result<(), RegistryError> {
        let mut txn = self.doc.transact_mut();
        let root = txn.get_or_insert_map(ROOT);
        match cmd {
            DocCommand::RegistryUpsertInstance(m) => {
                write_instance(&mut txn, &root, m);
                Ok(())
            }
            DocCommand::RegistrySetInstanceState {
                instance_id,
                status,
            } => {
                let instances = root.get_or_init::<_, yrs::MapRef>(&mut txn, "instances");
                let Some(mm) = instances
                    .get(&txn, instance_id)
                    .and_then(|v| v.cast::<yrs::MapRef>().ok())
                else {
                    return Err(RegistryError::NotFound(instance_id.clone()));
                };
                mm.insert(&mut txn, "status", instance_status_str(*status));
                Ok(())
            }
            DocCommand::RegistryUpsertChat(s) => {
                write_chat_summary(&mut txn, &root, s);
                Ok(())
            }
            DocCommand::RegistryRemoveChat { chat_id } => {
                let chats = root.get_or_init::<_, yrs::MapRef>(&mut txn, "chats");
                chats.remove(&mut txn, chat_id);
                Ok(())
            }
            DocCommand::RegistrySetGlobal { status } => {
                let global = root.get_or_init::<_, yrs::MapRef>(&mut txn, "global");
                global.insert(&mut txn, "status", global_status_str(*status));
                Ok(())
            }
            DocCommand::RegistryApplySessions { entries } => {
                // 与 chat 控制面 SessionListResponse 同构（§6.3）：预读当前
                // 投影 → diff → 有变化或首次 loaded 确认才写（幂等轮询零 update）。
                // sessions 是 instance 级数据，投影到 Registry Doc `sessions` map。
                let loaded = session_list::read_loaded(&txn, &root);
                let current = session_list::read_current(&txn, &root);
                let d = session_list::diff(&current, entries);
                if session_list::should_write_after_list_response(loaded, &d) {
                    if session_list::diff_has_map_changes(&d) {
                        session_list::apply_diff(&mut txn, &root, &d);
                    }
                    if !loaded {
                        session_list::mark_loaded(&mut txn, &root);
                    }
                }
                Ok(())
            }
            DocCommand::RegistryUpsertWorkspace(w) => {
                write_workspace(&mut txn, &root, w);
                Ok(())
            }
            DocCommand::RegistryRemoveWorkspace { workspace_id } => {
                let workspaces = root.get_or_init::<_, yrs::MapRef>(&mut txn, "workspaces");
                workspaces.remove(&mut txn, workspace_id);
                Ok(())
            }
            DocCommand::RegistryReplaceProjects { projects, sessions } => {
                let pm = root.get_or_init::<_, yrs::MapRef>(&mut txn, "projects");
                pm.clear(&mut txn);
                for p in projects {
                    let m = pm.get_or_init::<_, yrs::MapRef>(&mut txn, p.id.as_str());
                    m.insert(&mut txn, "id", p.id.clone());
                    m.insert(&mut txn, "name", p.name.clone());
                    m.insert(&mut txn, "cwd", p.cwd.clone());
                    m.insert(&mut txn, "instance_id", p.instance_id.clone());
                    m.insert(&mut txn, "created_at", p.created_at.clone());
                    m.insert(&mut txn, "updated_at", p.updated_at.clone());
                    match &p.archived_at {
                        Some(v) => m.insert(&mut txn, "archived_at", v.clone()),
                        None => m.insert(&mut txn, "archived_at", yrs::Any::Null),
                    };
                }
                let sm = root.get_or_init::<_, yrs::MapRef>(&mut txn, "project_sessions");
                sm.clear(&mut txn);
                for s in sessions {
                    let m = sm.get_or_init::<_, yrs::MapRef>(&mut txn, s.id.as_str());
                    m.insert(&mut txn, "id", s.id.clone());
                    m.insert(&mut txn, "project_id", s.project_id.clone());
                    match &s.acp_session_id {
                        Some(v) => m.insert(&mut txn, "acp_session_id", v.clone()),
                        None => m.insert(&mut txn, "acp_session_id", yrs::Any::Null),
                    };
                    m.insert(&mut txn, "title", s.title.clone());
                    m.insert(&mut txn, "lifecycle", s.lifecycle.clone());
                    m.insert(&mut txn, "updated_at", s.updated_at.clone());
                    match &s.last_opened_at {
                        Some(v) => m.insert(&mut txn, "last_opened_at", v.clone()),
                        None => m.insert(&mut txn, "last_opened_at", yrs::Any::Null),
                    };
                    match &s.active_chat_id {
                        Some(v) => m.insert(&mut txn, "active_chat_id", v.clone()),
                        None => m.insert(&mut txn, "active_chat_id", yrs::Any::Null),
                    };
                    match &s.archived_at {
                        Some(v) => m.insert(&mut txn, "archived_at", v.clone()),
                        None => m.insert(&mut txn, "archived_at", yrs::Any::Null),
                    };
                }
                Ok(())
            }
            DocCommand::RegistryReplaceMachines { machines } => {
                let mm = root.get_or_init::<_, yrs::MapRef>(&mut txn, "machines");
                mm.clear(&mut txn);
                for m in machines {
                    let entry = mm.get_or_init::<_, yrs::MapRef>(&mut txn, m.instance_id.as_str());
                    entry.insert(&mut txn, "instance_id", m.instance_id.clone());
                    entry.insert(&mut txn, "kind", m.kind.clone());
                    entry.insert(&mut txn, "display_name", m.display_name.clone());
                    match &m.ssh_destination {
                        Some(v) => entry.insert(&mut txn, "ssh_destination", v.clone()),
                        None => entry.insert(&mut txn, "ssh_destination", yrs::Any::Null),
                    };
                    match m.ssh_port {
                        Some(v) => entry.insert(&mut txn, "ssh_port", v as i64),
                        None => entry.insert(&mut txn, "ssh_port", yrs::Any::Null),
                    };
                    entry.insert(&mut txn, "phase", m.phase.clone());
                    match &m.error_code {
                        Some(v) => entry.insert(&mut txn, "error_code", v.clone()),
                        None => entry.insert(&mut txn, "error_code", yrs::Any::Null),
                    };
                    entry.insert(&mut txn, "has_identity_file", m.has_identity_file);
                    entry.insert(&mut txn, "auto_reconnect", m.auto_reconnect);
                    match &m.host_key_sha256 {
                        Some(v) => entry.insert(&mut txn, "host_key_sha256", v.clone()),
                        None => entry.insert(&mut txn, "host_key_sha256", yrs::Any::Null),
                    };
                    entry.insert(&mut txn, "updated_at", m.updated_at.clone());
                    match &m.archived_at {
                        Some(v) => entry.insert(&mut txn, "archived_at", v.clone()),
                        None => entry.insert(&mut txn, "archived_at", yrs::Any::Null),
                    };
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    /// workspace 全量读取（启动恢复：workspace 内存注册表重建；读 doc 快照，
    /// 不经命令路径）。
    pub(crate) fn list_workspaces(&self) -> Vec<WorkspaceSummary> {
        let txn = self.doc.transact();
        let root = match txn.get_map(ROOT) {
            Some(r) => r,
            None => return Vec::new(),
        };
        let Some(ws) = root
            .get(&txn, "workspaces")
            .and_then(|v| v.cast::<yrs::MapRef>().ok())
        else {
            return Vec::new();
        };
        let str_or = |m: &yrs::MapRef, k: &str| -> String {
            m.get(&txn, k)
                .and_then(|x| x.cast::<String>().ok())
                .unwrap_or_default()
        };
        let mut out = Vec::new();
        for (id, v) in ws.iter(&txn) {
            if let Ok(m) = v.cast::<yrs::MapRef>() {
                out.push(WorkspaceSummary {
                    id: id.to_string(),
                    name: str_or(&m, "name"),
                    cwd: str_or(&m, "cwd"),
                    created_at: str_or(&m, "created_at"),
                    updated_at: str_or(&m, "updated_at"),
                });
            }
        }
        out
    }

    pub(crate) fn list_legacy_sessions(&self) -> Vec<SessionSummaryProjection> {
        let txn = self.doc.transact();
        let Some(root) = txn.get_map(ROOT) else {
            return Vec::new();
        };
        session_list::read_current(&txn, &root)
            .into_values()
            .collect()
    }

    /// Registry `machines` 投影的 credential-free 摘要（health / CLI status）。
    pub(crate) fn list_health_machines(&self) -> Vec<super::registry::MachineHealthRow> {
        let txn = self.doc.transact();
        let root = match txn.get_map(ROOT) {
            Some(r) => r,
            None => return Vec::new(),
        };
        let Some(mm) = root
            .get(&txn, "machines")
            .and_then(|v| v.cast::<yrs::MapRef>().ok())
        else {
            return Vec::new();
        };
        let str_or = |m: &yrs::MapRef, k: &str| -> String {
            m.get(&txn, k)
                .and_then(|x| x.cast::<String>().ok())
                .unwrap_or_default()
        };
        let mut out = Vec::new();
        for (_, v) in mm.iter(&txn) {
            if let Ok(m) = v.cast::<yrs::MapRef>() {
                out.push(super::registry::MachineHealthRow {
                    instance_id: str_or(&m, "instance_id"),
                    kind: str_or(&m, "kind"),
                    display_name: str_or(&m, "display_name"),
                    phase: str_or(&m, "phase"),
                });
            }
        }
        out.sort_by(|a, b| {
            a.kind
                .cmp(&b.kind)
                .then_with(|| a.display_name.cmp(&b.display_name))
                .then_with(|| a.instance_id.cmp(&b.instance_id))
        });
        out
    }

    /// gap 写回（读现状改 gap 字段；§9.4/§12.4）。
    pub(crate) fn set_chat_gap(
        &mut self,
        chat_id: &str,
        gap: Option<u64>,
    ) -> Result<(), RegistryError> {
        let mut txn = self.doc.transact_mut();
        let root = txn.get_or_insert_map(ROOT);
        let chats = root.get_or_init::<_, yrs::MapRef>(&mut txn, "chats");
        let Some(sm) = chats
            .get(&txn, chat_id)
            .and_then(|v| v.cast::<yrs::MapRef>().ok())
        else {
            return Err(RegistryError::NotFound(chat_id.to_string()));
        };
        match gap {
            Some(count) => sm.insert(&mut txn, "gap", count as f64),
            None => sm.insert(&mut txn, "gap", yrs::Any::Null),
        };
        Ok(())
    }

    /// chat 状态迁移写回（读现状改 status；§7.3/§7.6）。
    pub(crate) fn set_chat_status(
        &mut self,
        chat_id: &str,
        status: &str,
    ) -> Result<(), RegistryError> {
        let mut txn = self.doc.transact_mut();
        let root = txn.get_or_insert_map(ROOT);
        let chats = root.get_or_init::<_, yrs::MapRef>(&mut txn, "chats");
        let Some(sm) = chats
            .get(&txn, chat_id)
            .and_then(|v| v.cast::<yrs::MapRef>().ok())
        else {
            return Err(RegistryError::NotFound(chat_id.to_string()));
        };
        sm.insert(&mut txn, "status", status.to_string());
        Ok(())
    }
}

fn write_instance(txn: &mut yrs::TransactionMut<'_>, root: &yrs::MapRef, m: &InstanceView) {
    let instances = root.get_or_init::<_, yrs::MapRef>(txn, "instances");
    let mm = instances.get_or_init::<_, yrs::MapRef>(txn, m.id.as_str());
    mm.insert(txn, "id", m.id.clone());
    mm.insert(txn, "hostname", m.hostname.clone());
    mm.insert(txn, "status", instance_status_str(m.status));
    mm.insert(txn, "token_id", m.token_id.clone());
    mm.insert(txn, "registered_at", m.registered_at.clone());
    mm.insert(txn, "last_heartbeat", m.last_heartbeat.clone());
    mm.insert(txn, "chat_count", m.chat_count as f64);
    match m.resource_protocol_version {
        Some(version) => mm.insert(txn, "resource_protocol_version", version as f64),
        None => mm.insert(txn, "resource_protocol_version", yrs::Any::Null),
    };
    mm.insert(txn, "resource_write", m.resource_write);
    mm.insert(
        txn,
        "resource_structural_mutations",
        m.resource_structural_mutations,
    );
}

fn write_chat_summary(txn: &mut yrs::TransactionMut<'_>, root: &yrs::MapRef, s: &ChatSummary) {
    let chats = root.get_or_init::<_, yrs::MapRef>(txn, "chats");
    let sm = chats.get_or_init::<_, yrs::MapRef>(txn, s.id.as_str());
    // 重启语义（§5.5）：已存在条目（历史会话）不得被无条件覆盖——status
    // 由 set_chat_status 权威管理（否则客户端订阅触发的 open_chat
    // 会把启动对账标记的 ended 复活回 accepting，实测 836c8a3e）；title/
    // instance_id 同理（重启后内存表为空，覆盖会抹掉历史标题）。upsert
    // 收敛为：新条目全量写入；已存在条目仅刷新 updated_at（列表排序）。
    if sm.get(txn, "status").is_some() {
        sm.insert(txn, "updated_at", s.updated_at.clone());
        return;
    }
    sm.insert(txn, "id", s.id.clone());
    sm.insert(txn, "instance_id", s.instance_id.clone());
    sm.insert(txn, "title", s.title.clone());
    sm.insert(txn, "status", s.status.clone());
    match s.gap {
        Some(count) => sm.insert(txn, "gap", count as f64),
        None => sm.insert(txn, "gap", yrs::Any::Null),
    };
    sm.insert(txn, "updated_at", s.updated_at.clone());
    sm.insert(txn, "cwd", s.cwd.clone());
    match &s.workspace_id {
        Some(id) => sm.insert(txn, "workspace_id", id.clone()),
        None => sm.insert(txn, "workspace_id", yrs::Any::Null),
    };
}

fn write_workspace(txn: &mut yrs::TransactionMut<'_>, root: &yrs::MapRef, w: &WorkspaceSummary) {
    let workspaces = root.get_or_init::<_, yrs::MapRef>(txn, "workspaces");
    let wm = workspaces.get_or_init::<_, yrs::MapRef>(txn, w.id.as_str());
    wm.insert(txn, "id", w.id.clone());
    wm.insert(txn, "name", w.name.clone());
    wm.insert(txn, "cwd", w.cwd.clone());
    wm.insert(txn, "created_at", w.created_at.clone());
    wm.insert(txn, "updated_at", w.updated_at.clone());
}

pub(crate) fn instance_status_str(s: InstanceStatus) -> &'static str {
    match s {
        InstanceStatus::Online => "online",
        InstanceStatus::Offline => "offline",
        InstanceStatus::Unknown => "unknown",
    }
}

pub(crate) fn global_status_str(s: GlobalStatus) -> &'static str {
    match s {
        GlobalStatus::Healthy => "healthy",
        GlobalStatus::Degraded => "degraded",
        GlobalStatus::Restarting => "restarting",
    }
}

/// 读取 Registry Doc 的全局状态（读侧辅助；broadcaster/TUI 快照用）。
#[allow(dead_code)] // 预留：F7 broadcaster 快照用
pub(crate) fn read_global_status(doc: &yrs::Doc) -> GlobalStatus {
    let txn = doc.transact();
    let Some(root) = txn.get_map(ROOT) else {
        return GlobalStatus::Healthy;
    };
    let status = root
        .get(&txn, "global")
        .and_then(|v| v.cast::<yrs::MapRef>().ok())
        .and_then(|g| g.get(&txn, "status"))
        .and_then(|s| s.cast::<String>().ok())
        .unwrap_or_default();
    match status.as_str() {
        "degraded" => GlobalStatus::Degraded,
        "restarting" => GlobalStatus::Restarting,
        _ => GlobalStatus::Healthy,
    }
}

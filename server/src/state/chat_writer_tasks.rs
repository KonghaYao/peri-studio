//! Session Doc Peri Task 物理写入（`root.tasks` / `root.task_order`）。
//!
//! 状态机与终态保护在 `aggregator_write_task`；本模块只做 upsert/淘汰原语。

use yrs::{Array, ArrayRef, Map, MapRef};

use peri_studio_proto::schema::PeriTaskViewProjection;

use crate::state::view_store::TransactionCtx;

/// Session Doc 内任务视图硬上限（对齐 Fenix PERI_TASK_VIEW_MAX）。
pub const PERI_TASK_VIEW_MAX: u32 = 200;

const PERI_TASK_FALLBACK_TITLE: &str = "Background task";

/// upsert 结果：是否首次创建（task_order 已由本原语维护）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UpsertPeriTaskResult {
    pub created: bool,
}

fn tasks_map(txn: &mut TransactionCtx<'_>, root: &MapRef) -> MapRef {
    root.get_or_init::<_, MapRef>(txn, "tasks")
}

fn task_order_array(txn: &mut TransactionCtx<'_>, root: &MapRef) -> ArrayRef {
    root.get_or_init::<_, ArrayRef>(txn, "task_order")
}

/// 读取已有 task 的 status 字符串（不存在则 None）。
pub(crate) fn peri_task_status_read(
    txn: &TransactionCtx<'_>,
    root: &MapRef,
    task_id: &str,
) -> Option<String> {
    let tasks = root.get(txn, "tasks")?.cast::<MapRef>().ok()?;
    let task = tasks.get(txn, task_id)?.cast::<MapRef>().ok()?;
    task.get(txn, "status")?.cast::<String>().ok()
}

/// 幂等 upsert：首次创建 append `task_order`；更新不重排。
pub fn upsert_peri_task_view(
    txn: &mut TransactionCtx<'_>,
    root: &MapRef,
    view: &PeriTaskViewProjection,
) -> UpsertPeriTaskResult {
    let tasks = tasks_map(txn, root);
    if let Some(existing) = tasks.get(txn, &view.task_id) {
        let map = existing.cast::<MapRef>().expect("task entry map");
        if !view.title.is_empty() {
            map.insert(txn, "title", view.title.clone());
        }
        if let Some(sub) = view.task_subtype {
            map.insert(txn, "task_subtype", sub.as_str());
        }
        insert_optional_string(txn, &map, "summary", view.summary.as_deref());
        map.insert(txn, "status", view.status.as_str());
        insert_optional_string(txn, &map, "completed_at", view.completed_at.as_deref());
        map.insert(txn, "updated_at", view.updated_at.clone());
        map.insert(
            txn,
            "detail_availability",
            view.detail_availability.as_str(),
        );
        return UpsertPeriTaskResult { created: false };
    }

    let map = tasks.insert(txn, view.task_id.clone(), yrs::MapPrelim::default());
    map.insert(txn, "task_id", view.task_id.clone());
    map.insert(txn, "kind", view.kind.as_str());
    if let Some(sub) = view.task_subtype {
        map.insert(txn, "task_subtype", sub.as_str());
    }
    let title = if view.title.is_empty() {
        PERI_TASK_FALLBACK_TITLE
    } else {
        view.title.as_str()
    };
    map.insert(txn, "title", title.to_string());
    insert_optional_string(txn, &map, "summary", view.summary.as_deref());
    map.insert(txn, "status", view.status.as_str());
    insert_optional_string(txn, &map, "turn_id", view.turn_id.as_deref());
    map.insert(txn, "is_background", view.is_background);
    map.insert(txn, "started_at", view.started_at.clone());
    insert_optional_string(txn, &map, "completed_at", view.completed_at.as_deref());
    map.insert(txn, "updated_at", view.updated_at.clone());
    map.insert(
        txn,
        "detail_availability",
        view.detail_availability.as_str(),
    );

    let order = task_order_array(txn, root);
    order.push_back(txn, view.task_id.clone());
    evict_tasks_if_needed(txn, root);
    UpsertPeriTaskResult { created: true }
}

fn insert_optional_string(
    txn: &mut TransactionCtx<'_>,
    map: &MapRef,
    key: &str,
    value: Option<&str>,
) {
    match value {
        Some(v) => {
            map.insert(txn, key, v.to_string());
        }
        None => {
            map.insert(txn, key, yrs::Any::Null);
        }
    }
}

/// 优先淘汰最早终态任务；若全部 running 则淘汰最早条目。
fn evict_tasks_if_needed(txn: &mut TransactionCtx<'_>, root: &MapRef) {
    let order = task_order_array(txn, root);
    let tasks = tasks_map(txn, root);
    while order.len(txn) > PERI_TASK_VIEW_MAX {
        let len = order.len(txn);
        if len == 0 {
            break;
        }
        let mut evict_index = 0u32;
        for i in 0..len {
            let task_id = order
                .get(txn, i)
                .and_then(|v| v.cast::<String>().ok())
                .unwrap_or_default();
            let status = tasks
                .get(txn, &task_id)
                .and_then(|v| v.cast::<MapRef>().ok())
                .and_then(|m| m.get(txn, "status"))
                .and_then(|s| s.cast::<String>().ok());
            if matches!(
                status.as_deref(),
                Some("completed" | "failed" | "cancelled")
            ) {
                evict_index = i;
                break;
            }
        }
        let evict_id = order
            .get(txn, evict_index)
            .and_then(|v| v.cast::<String>().ok())
            .unwrap_or_default();
        if !evict_id.is_empty() {
            tasks.remove(txn, &evict_id);
        }
        order.remove(txn, evict_index);
    }
}

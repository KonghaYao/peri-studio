//! Peri Task 事件状态机（对齐 Fenix `applyPeriTaskEvent`）。

use yrs::MapRef;

use peri_studio_proto::schema::{
    PeriTaskDetailAvailability, PeriTaskKind, PeriTaskStatus, PeriTaskViewProjection,
};

use crate::state::chat_writer_tasks::{peri_task_status_read, upsert_peri_task_view};
use crate::state::normalized::{EventBody, NormalizedEvent};
use crate::state::view_store::TransactionCtx;

use super::aggregator::Aggregator;

fn resolve_timestamp(raw: Option<&str>, fallback: &str) -> String {
    let Some(raw) = raw else {
        return fallback.to_string();
    };
    if chrono::DateTime::parse_from_rfc3339(raw).is_ok() {
        return raw.to_string();
    }
    fallback.to_string()
}

fn status_from_str(s: &str) -> Option<PeriTaskStatus> {
    match s {
        "running" => Some(PeriTaskStatus::Running),
        "completed" => Some(PeriTaskStatus::Completed),
        "failed" => Some(PeriTaskStatus::Failed),
        "cancelled" => Some(PeriTaskStatus::Cancelled),
        _ => None,
    }
}

fn terminal_status(body: &EventBody) -> (PeriTaskStatus, PeriTaskKind) {
    match body {
        EventBody::PeriTaskCompleted { success, kind, .. } => (
            if *success {
                PeriTaskStatus::Completed
            } else {
                PeriTaskStatus::Failed
            },
            *kind,
        ),
        EventBody::PeriTaskCancelled { kind, .. } => (PeriTaskStatus::Cancelled, *kind),
        EventBody::PeriTaskStarted { kind, .. } => (PeriTaskStatus::Running, *kind),
        _ => (PeriTaskStatus::Running, PeriTaskKind::Background),
    }
}

impl Aggregator {
    /// 应用 Peri Task 事件；返回是否产生 Yjs 变更（无变更则不 bump projection_version）。
    pub(crate) fn apply_peri_task_event(
        &self,
        txn: &mut TransactionCtx<'_>,
        root: &MapRef,
        ev: &NormalizedEvent,
        active_turn_id: Option<&str>,
    ) -> bool {
        let task_id = match &ev.body {
            EventBody::PeriTaskStarted { task_id, .. }
            | EventBody::PeriTaskCompleted { task_id, .. }
            | EventBody::PeriTaskCancelled { task_id, .. } => task_id.clone(),
            _ => return false,
        };

        let existing_status = peri_task_status_read(txn, root, &task_id)
            .as_deref()
            .and_then(status_from_str);

        let turn_id = active_turn_id.map(str::to_string);

        let view = match build_view(&ev.body, &ev.ts, turn_id.as_deref()) {
            Some(v) => v,
            None => return false,
        };

        if existing_status.is_none() {
            upsert_peri_task_view(txn, root, &view);
            return true;
        }

        match &ev.body {
            EventBody::PeriTaskStarted { .. } => {
                if existing_status.is_some_and(|s| s.is_terminal()) {
                    return false;
                }
                upsert_peri_task_view(txn, root, &view);
                true
            }
            EventBody::PeriTaskCompleted { .. } | EventBody::PeriTaskCancelled { .. } => {
                let (target, _) = terminal_status(&ev.body);
                if let Some(existing) = existing_status {
                    if !existing.is_terminal() {
                        upsert_peri_task_view(txn, root, &view);
                        return true;
                    }
                    if existing == target {
                        return false;
                    }
                    return false;
                }
                upsert_peri_task_view(txn, root, &view);
                true
            }
            _ => false,
        }
    }
}

fn build_view(
    body: &EventBody,
    received_at: &str,
    active_turn_id: Option<&str>,
) -> Option<PeriTaskViewProjection> {
    match body {
        EventBody::PeriTaskStarted {
            task_id,
            kind,
            task_subtype,
            title,
            summary,
            source_started_at,
            is_background,
            detail_availability,
        } => {
            let started_at = match kind {
                PeriTaskKind::Background => {
                    resolve_timestamp(source_started_at.as_deref(), received_at)
                }
                PeriTaskKind::Subagent => received_at.to_string(),
            };
            Some(PeriTaskViewProjection {
                task_id: task_id.clone(),
                kind: *kind,
                task_subtype: *task_subtype,
                title: title.clone(),
                summary: summary.clone(),
                status: PeriTaskStatus::Running,
                turn_id: active_turn_id.map(str::to_string),
                is_background: *is_background,
                started_at,
                completed_at: None,
                updated_at: received_at.to_string(),
                detail_availability: *detail_availability,
            })
        }
        EventBody::PeriTaskCompleted {
            task_id,
            kind,
            success,
            summary,
            detail_availability,
            ..
        } => Some(PeriTaskViewProjection {
            task_id: task_id.clone(),
            kind: *kind,
            task_subtype: None,
            title: String::new(),
            summary: summary.clone(),
            status: if *success {
                PeriTaskStatus::Completed
            } else {
                PeriTaskStatus::Failed
            },
            turn_id: active_turn_id.map(str::to_string),
            is_background: matches!(kind, PeriTaskKind::Background),
            started_at: received_at.to_string(),
            completed_at: Some(received_at.to_string()),
            updated_at: received_at.to_string(),
            detail_availability: *detail_availability,
        }),
        EventBody::PeriTaskCancelled { task_id, kind, .. } => Some(PeriTaskViewProjection {
            task_id: task_id.clone(),
            kind: *kind,
            task_subtype: None,
            title: String::new(),
            summary: None,
            status: PeriTaskStatus::Cancelled,
            turn_id: active_turn_id.map(str::to_string),
            is_background: true,
            started_at: received_at.to_string(),
            completed_at: Some(received_at.to_string()),
            updated_at: received_at.to_string(),
            detail_availability: PeriTaskDetailAvailability::Unavailable,
        }),
        _ => None,
    }
}

//! Peri Task 投影与 source_agent_id 隔离测试。

use super::util::*;

use yrs::{Array, ArrayRef, Map, MapRef, Transact};

use peri_studio_proto::schema::{
    PeriTaskDetailAvailability, PeriTaskKind, PeriTaskSubtype,
};

use crate::state::aggregator::Aggregator;
use crate::state::chat_writer;
use crate::state::normalized::EventBody;

fn peri_started(task_id: &str, title: &str) -> EventBody {
    EventBody::PeriTaskStarted {
        task_id: task_id.into(),
        kind: PeriTaskKind::Background,
        task_subtype: Some(PeriTaskSubtype::Agent),
        title: title.into(),
        summary: None,
        source_started_at: None,
        is_background: true,
        detail_availability: PeriTaskDetailAvailability::Preview,
    }
}

fn peri_completed(task_id: &str, success: bool, summary: &str) -> EventBody {
    EventBody::PeriTaskCompleted {
        task_id: task_id.into(),
        kind: PeriTaskKind::Background,
        success,
        summary: Some(summary.into()),
        duration_ms: None,
        detail_availability: PeriTaskDetailAvailability::Preview,
    }
}

fn task_status(pair: &crate::state::doc_pair::DocPair, task_id: &str) -> Option<String> {
    let txn = pair.session.transact();
    let root = chat_writer::root_map_read(&txn)?;
    let tasks = root.get(&txn, "tasks")?.cast::<MapRef>().ok()?;
    let task = tasks.get(&txn, task_id)?.cast::<MapRef>().ok()?;
    task.get(&txn, "status")?.cast::<String>().ok()
}

fn task_order_len(pair: &crate::state::doc_pair::DocPair) -> u32 {
    let txn = pair.session.transact();
    let root = chat_writer::root_map_read(&txn).unwrap();
    root.get(&txn, "task_order")
        .unwrap()
        .cast::<ArrayRef>()
        .unwrap()
        .len(&txn)
}

fn session_projection_version(pair: &crate::state::doc_pair::DocPair) -> u32 {
    let txn = pair.session.transact();
    let root = chat_writer::root_map_read(&txn).unwrap();
    root.get(&txn, "projection_version")
        .and_then(|v| v.cast::<u32>().ok())
        .unwrap_or(0)
}

#[test]
fn started_creates_running_and_appends_task_order_without_active_turn() {
    let mut pair = pair();
    assert!(
        Aggregator
            .apply(&mut pair, &ev("s1", 1, peri_started("bg-1", "Review")))
            .applied
    );
    assert_eq!(task_status(&pair, "bg-1").as_deref(), Some("running"));
    assert_eq!(task_order_len(&pair), 1);
}

#[test]
fn duplicate_started_does_not_append_task_order_again() {
    let mut pair = pair();
    assert!(Aggregator.apply(&mut pair, &ev("s1", 1, peri_started("bg-1", "A"))).applied);
    let v0 = session_projection_version(&pair);
    assert!(Aggregator.apply(&mut pair, &ev("s1", 2, peri_started("bg-1", "B"))).applied);
    assert_eq!(task_order_len(&pair), 1);
    assert!(session_projection_version(&pair) > v0);
}

#[test]
fn completed_updates_status_and_summary_without_reordering() {
    let mut pair = pair();
    assert!(Aggregator.apply(&mut pair, &ev("s1", 1, peri_started("bg-1", "A"))).applied);
    assert!(
        Aggregator
            .apply(&mut pair, &ev("s1", 2, peri_completed("bg-1", true, "done")))
            .applied
    );
    assert_eq!(task_status(&pair, "bg-1").as_deref(), Some("completed"));
    assert_eq!(task_order_len(&pair), 1);
    let txn = pair.session.transact();
    let root = chat_writer::root_map_read(&txn).unwrap();
    let tasks = root.get(&txn, "tasks").unwrap().cast::<MapRef>().unwrap();
    let task = tasks.get(&txn, "bg-1").unwrap().cast::<MapRef>().unwrap();
    assert_eq!(task.get(&txn, "summary"), Some("done".into()));
}

#[test]
fn started_after_terminal_does_not_bump_projection() {
    let mut pair = pair();
    assert!(Aggregator.apply(&mut pair, &ev("s1", 1, peri_started("bg-1", "A"))).applied);
    assert!(
        Aggregator
            .apply(&mut pair, &ev("s1", 2, peri_completed("bg-1", true, "ok")))
            .applied
    );
    let v = session_projection_version(&pair);
    assert!(Aggregator.apply(&mut pair, &ev("s1", 3, peri_started("bg-1", "late"))).applied);
    assert_eq!(session_projection_version(&pair), v);
    assert_eq!(task_status(&pair, "bg-1").as_deref(), Some("completed"));
}

#[test]
fn conflicting_terminal_preserves_first_terminal() {
    let mut pair = pair();
    assert!(
        Aggregator
            .apply(
                &mut pair,
                &ev("s1", 1, peri_completed("bg-1", true, "ok")),
            )
            .applied
    );
    assert_eq!(task_status(&pair, "bg-1").as_deref(), Some("completed"));
    let v = session_projection_version(&pair);
    assert!(
        Aggregator
            .apply(
                &mut pair,
                &ev(
                    "s1",
                    2,
                    EventBody::PeriTaskCancelled {
                        task_id: "bg-1".into(),
                        kind: PeriTaskKind::Background,
                        reason_code: Some("user".into()),
                    },
                ),
            )
            .applied
    );
    assert_eq!(session_projection_version(&pair), v);
    assert_eq!(task_status(&pair, "bg-1").as_deref(), Some("completed"));
}

#[test]
fn terminal_first_completed_creates_task() {
    let mut pair = pair();
    assert!(
        Aggregator
            .apply(
                &mut pair,
                &ev("s1", 1, peri_completed("bg-9", false, "fail")),
            )
            .applied
    );
    assert_eq!(task_status(&pair, "bg-9").as_deref(), Some("failed"));
    assert_eq!(task_order_len(&pair), 1);
}

#[test]
fn subagent_message_delta_not_in_chat_entries() {
    let mut pair = pair();
    seed_user_msg(&mut pair, "t1", "t1:user", "hi");
    assert!(
        Aggregator
            .apply(
                &mut pair,
                &ev_subagent(
                    "s1",
                    1,
                    "child-1",
                    msg_delta("t1", "t1:assistant", "text", "secret"),
                ),
            )
            .applied
    );
    assert_eq!(entry_count(&pair), 1);
}

#[test]
fn subagent_tool_call_not_in_tool_calls() {
    let mut pair = pair();
    seed_user_msg(&mut pair, "t1", "t1:user", "hi");
    assert!(
        Aggregator
            .apply(
                &mut pair,
                &ev_subagent("s1", 1, "child-1", tool_started("t1", "tc-sub")),
            )
            .applied
    );
    assert_eq!(tool_call_count(&pair), 0);
}

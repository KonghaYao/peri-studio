//! 直播工具生命周期：pending → running → completed 必须逐帧写入。

use super::util::*;

use peri_studio_proto::schema::{ToolCallKind, ToolCallStatus, TurnStatus};
use serde_json::json;

use crate::state::{
    aggregator::Aggregator,
    normalized::{EventBody, ToolCallPatch, ToolJsonPatch},
};

#[test]
fn live_tool_patch_persists_pending_running_then_completed() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert_eq!(active_turn_status(&p), Some(TurnStatus::Accepting));
    let id = "tc-lifecycle";
    assert!(
        agg.apply(
            &mut p,
            &ev("s1", 2, patched(id, ToolCallStatus::Pending, None))
        )
        .applied
    );
    let started = tool_call(&p, id);
    assert_eq!(started.status, ToolCallStatus::Pending);
    assert_eq!(started.started_at.as_deref(), Some("2026-08-07T00:00:00Z"));
    assert!(started.completed_at.is_none());
    assert_eq!(active_turn_status(&p), Some(TurnStatus::Running));

    assert!(
        agg.apply(
            &mut p,
            &ev("s1", 3, patched(id, ToolCallStatus::Running, None))
        )
        .applied
    );
    let loading = tool_call(&p, id);
    assert_eq!(loading.status, ToolCallStatus::Running);
    assert!(loading.completed_at.is_none());

    assert!(
        agg.apply(
            &mut p,
            &ev(
                "s1",
                4,
                patched(id, ToolCallStatus::Completed, Some("2026-08-07T00:00:02Z"))
            )
        )
        .applied
    );
    let done = tool_call(&p, id);
    assert_eq!(done.status, ToolCallStatus::Completed);
    assert_eq!(done.started_at.as_deref(), Some("2026-08-07T00:00:00Z"));
    assert_eq!(done.completed_at.as_deref(), Some("2026-08-07T00:00:02Z"));
}

#[test]
fn update_first_running_patch_records_live_start_observation() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert!(
        agg.apply(
            &mut p,
            &ev(
                "s1",
                2,
                patched("tc-update-start", ToolCallStatus::Running, None)
            )
        )
        .applied
    );
    let tool = tool_call(&p, "tc-update-start");
    assert_eq!(tool.status, ToolCallStatus::Running);
    assert_eq!(tool.started_at.as_deref(), Some("2026-08-07T00:00:00Z"));
}

#[test]
fn replay_tool_patch_does_not_forge_started_at() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    p.stream.replay_active = true;
    let initial = EventBody::ToolCallPatched {
        turn_id: String::new(),
        tool_call_id: "tc-replay".into(),
        patch: ToolCallPatch {
            name: Some("Read".into()),
            kind: Some(ToolCallKind::Read),
            status: Some(ToolCallStatus::Completed),
            created_at: Some("2026-08-07T00:00:00Z".into()),
            completed_at: Some("2026-08-07T00:00:02Z".into()),
            ..Default::default()
        },
    };
    assert!(agg.apply(&mut p, &ev("s1", 2, initial)).applied);
    let tool = tool_call(&p, "tc-replay");
    assert_eq!(tool.status, ToolCallStatus::Completed);
    assert_eq!(tool.started_at, None, "回放通知时间不是原执行开始时间");
}

fn patched(id: &str, status: ToolCallStatus, completed_at: Option<&str>) -> EventBody {
    EventBody::ToolCallPatched {
        turn_id: String::new(),
        tool_call_id: id.into(),
        patch: ToolCallPatch {
            name: Some("Run".into()),
            kind: Some(ToolCallKind::Execute),
            status: Some(status),
            completed_at: completed_at.map(str::to_string),
            result: if completed_at.is_some() {
                ToolJsonPatch::Set {
                    value: json!({"stdout": "ok"}),
                }
            } else {
                ToolJsonPatch::Unchanged
            },
            ..Default::default()
        },
    }
}

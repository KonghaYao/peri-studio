//! 聚合器扩展协商测试（对应 `aggregator_write_control.rs` 的扩展协商
//! 门控）：agent activity（精确 negotiated extension + 边界记录管理）、
//! agent plan（active 形态需精确扩展）、input prediction（envelope
//! 身份 + 陈旧值清理，§17 扩展）。

use super::util::*;

use yrs::{Array, Map, Transact, WriteTxn};

use peri_studio_proto::schema::{AgentActivityKind, AgentActivityStatus};

use crate::state::aggregator::Aggregator;
use crate::state::chat_writer;
use crate::state::factory::ROOT;
use crate::state::normalized::EventBody;

#[test]
fn agent_activity_requires_exact_negotiated_extension() {
    let mut pair = pair();
    assert!(
        Aggregator
            .apply(
                &mut pair,
                &ev(
                    "s1",
                    1,
                    activity(
                        AgentActivityKind::Subagent,
                        AgentActivityStatus::Running,
                        Some("abc123"),
                    ),
                ),
            )
            .applied
    );
    let txn = pair.session.transact();
    let root = chat_writer::root_map_read(&txn).unwrap();
    let agent = root
        .get(&txn, "agent")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert!(agent.get(&txn, "activities").is_none());
}

#[test]
fn agent_plan_is_standard_but_active_form_requires_exact_extension() {
    let mut pair = pair();
    let plan = || EventBody::AgentPlan {
        entries: vec![peri_studio_proto::schema::AgentPlanEntryProjection {
            content: "Run tests".into(),
            status: peri_studio_proto::schema::AgentPlanEntryStatus::InProgress,
            active_form: Some("Running tests".into()),
        }],
    };
    assert!(Aggregator.apply(&mut pair, &ev("s1", 1, plan())).applied);
    {
        let txn = pair.session.transact();
        let root = chat_writer::root_map_read(&txn).unwrap();
        let agent = root
            .get(&txn, "agent")
            .unwrap()
            .cast::<yrs::MapRef>()
            .unwrap();
        let entries = agent
            .get(&txn, "plan_entries")
            .unwrap()
            .cast::<yrs::MapRef>()
            .unwrap();
        let first = entries
            .get(&txn, "0")
            .unwrap()
            .cast::<yrs::MapRef>()
            .unwrap();
        assert_eq!(first.get(&txn, "content"), Some("Run tests".into()));
        assert!(matches!(
            first.get(&txn, "active_form"),
            Some(yrs::Out::Any(yrs::Any::Null))
        ));
    }
    {
        let mut txn = pair.session.transact_mut();
        let root = txn.get_or_insert_map(ROOT);
        let agent = root.get_or_init::<_, yrs::MapRef>(&mut txn, "agent");
        let extensions = agent.get_or_init::<_, yrs::ArrayRef>(&mut txn, "extensions");
        extensions.push_back(&mut txn, "peri.planEntryActiveForm");
    }
    assert!(Aggregator.apply(&mut pair, &ev("s1", 2, plan())).applied);
    let txn = pair.session.transact();
    let root = chat_writer::root_map_read(&txn).unwrap();
    let agent = root
        .get(&txn, "agent")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let entries = agent
        .get(&txn, "plan_entries")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let first = entries
        .get(&txn, "0")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(first.get(&txn, "active_form"), Some("Running tests".into()));
}

#[test]
fn input_prediction_requires_negotiation_and_uses_envelope_identity() {
    let mut pair = pair();
    assert!(
        Aggregator
            .apply(
                &mut pair,
                &ev(
                    "s1",
                    4,
                    EventBody::InputPrediction {
                        text: Some("未协商".into())
                    }
                )
            )
            .applied
    );
    assert_eq!(projected_prediction(&pair), None);

    enable_input_prediction(&mut pair);
    let prediction = ev(
        "s1",
        5,
        EventBody::InputPrediction {
            text: Some("检查失败测试".into()),
        },
    );
    assert!(Aggregator.apply(&mut pair, &prediction).applied);
    assert_eq!(
        projected_prediction(&pair),
        Some(("prediction:0:5".into(), "检查失败测试".into()))
    );
}

#[test]
fn input_prediction_clear_and_next_user_message_remove_stale_value() {
    let mut pair = pair();
    enable_input_prediction(&mut pair);
    assert!(
        Aggregator
            .apply(
                &mut pair,
                &ev(
                    "s1",
                    1,
                    EventBody::InputPrediction {
                        text: Some("先检查测试".into())
                    }
                )
            )
            .applied
    );
    assert!(projected_prediction(&pair).is_some());
    assert!(
        Aggregator
            .apply(
                &mut pair,
                &ev("s1", 2, EventBody::InputPrediction { text: None })
            )
            .applied
    );
    assert_eq!(projected_prediction(&pair), None);

    assert!(
        Aggregator
            .apply(
                &mut pair,
                &ev(
                    "s1",
                    3,
                    EventBody::InputPrediction {
                        text: Some("再检查构建".into())
                    }
                )
            )
            .applied
    );
    // 投递新 user 消息 → 陈旧 input_prediction 清除（§6.5：非回放 user
    // 事件已被聚合器拒绝，投递经回放写分支/注入命令路径——此处验证回放
    // 写分支的 clear_input_prediction）。
    pair.stream.replay_active = true;
    assert!(
        Aggregator
            .apply(&mut pair, &ev("s1", 4, user_msg("", "", "继续")))
            .applied
    );
    assert_eq!(projected_prediction(&pair), None);
}

#[test]
fn correlated_agent_activity_updates_one_bounded_record() {
    let mut pair = pair();
    enable_agent_activity(&mut pair);
    let mut started = ev(
        "s1",
        1,
        activity(
            AgentActivityKind::Subagent,
            AgentActivityStatus::Running,
            Some("abc123"),
        ),
    );
    started.ts = "2026-08-07T00:00:01Z".into();
    assert!(Aggregator.apply(&mut pair, &started).applied);

    let mut completed = ev(
        "s1",
        2,
        EventBody::AgentActivity {
            kind: AgentActivityKind::Subagent,
            status: AgentActivityStatus::Completed,
            correlation_id: Some("abc123".into()),
            label: Some("Done".into()),
            is_background: Some(false),
            metrics: std::collections::BTreeMap::from([("duration_ms".into(), 42)]),
            attributes: std::collections::BTreeMap::new(),
        },
    );
    completed.ts = "2026-08-07T00:00:02Z".into();
    assert!(Aggregator.apply(&mut pair, &completed).applied);

    let txn = pair.session.transact();
    let root = chat_writer::root_map_read(&txn).unwrap();
    let agent = root
        .get(&txn, "agent")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let order = agent
        .get(&txn, "activity_order")
        .unwrap()
        .cast::<yrs::ArrayRef>()
        .unwrap();
    assert_eq!(order.len(&txn), 1);
    assert_eq!(order.get(&txn, 0), Some("subagent:abc123".into()));
    let activities = agent
        .get(&txn, "activities")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let record = activities
        .get(&txn, "subagent:abc123")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(record.get(&txn, "status"), Some("completed".into()));
    assert_eq!(
        record.get(&txn, "created_at"),
        Some("2026-08-07T00:00:01Z".into())
    );
    assert_eq!(
        record.get(&txn, "updated_at"),
        Some("2026-08-07T00:00:02Z".into())
    );
    let metrics = record
        .get(&txn, "metrics")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert!(metrics.get(&txn, "tool_count").is_none());
    assert_eq!(
        metrics.get(&txn, "duration_ms"),
        Some(yrs::Any::BigInt(42).into())
    );
    let attributes = record
        .get(&txn, "attributes")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(attributes.len(&txn), 0);
}

#[test]
fn agent_activity_evicts_oldest_record_after_limit() {
    let mut pair = pair();
    enable_agent_activity(&mut pair);
    for seq in 1..=65 {
        assert!(
            Aggregator
                .apply(
                    &mut pair,
                    &ev(
                        "s1",
                        seq,
                        activity(AgentActivityKind::System, AgentActivityStatus::Info, None,),
                    ),
                )
                .applied
        );
    }
    let txn = pair.session.transact();
    let root = chat_writer::root_map_read(&txn).unwrap();
    let agent = root
        .get(&txn, "agent")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let order = agent
        .get(&txn, "activity_order")
        .unwrap()
        .cast::<yrs::ArrayRef>()
        .unwrap();
    let activities = agent
        .get(&txn, "activities")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(order.len(&txn), 64);
    assert_eq!(activities.len(&txn), 64);
    assert!(activities.get(&txn, "event:0:1").is_none());
    assert_eq!(order.get(&txn, 0), Some("event:0:2".into()));
}

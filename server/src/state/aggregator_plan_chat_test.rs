//! WP-B：AgentPlan Control + Chat `plan:{turn|global}` 双写。

use super::util::*;

use yrs::{Map, Transact};

use peri_studio_proto::schema::{AgentPlanEntryProjection, AgentPlanEntryStatus};

use crate::state::aggregator::Aggregator;
use crate::state::chat_writer;
use crate::state::normalized::EventBody;

fn plan_body(content: &str) -> EventBody {
    EventBody::AgentPlan {
        entries: vec![AgentPlanEntryProjection {
            content: content.into(),
            status: AgentPlanEntryStatus::InProgress,
            active_form: None,
        }],
    }
}

#[test]
fn agent_plan_writes_control_and_chat_system_entry() {
    let mut pair = pair();
    seed_user_msg(&mut pair, "turn_1", "turn_1:user", "go");
    assert!(
        Aggregator
            .apply(&mut pair, &ev("s1", 2, plan_body("Step 1")))
            .applied
    );

    let txn = pair.session.transact();
    let root = chat_writer::root_map_read(&txn).unwrap();
    let agent = root
        .get(&txn, "agent")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert!(agent.get(&txn, "plan_entries").is_some());

    let chat_txn = pair.chat.transact();
    let chat_root = chat_writer::root_map_read(&chat_txn).unwrap();
    let entry = chat_root
        .get(&chat_txn, "entries")
        .and_then(|v| v.cast::<yrs::MapRef>().ok())
        .and_then(|entries| entries.get(&chat_txn, "plan:turn_1"))
        .and_then(|v| v.cast::<yrs::MapRef>().ok())
        .expect("plan chat entry");
    assert_eq!(entry.get(&chat_txn, "kind"), Some("system".into()));
    assert!(entry.get(&chat_txn, "plan_entries").is_some());
    assert_eq!(
        entry_order(&pair)
            .iter()
            .filter(|id| *id == "plan:turn_1")
            .count(),
        1
    );
}

#[test]
fn agent_plan_updates_same_chat_entry_in_place() {
    let mut pair = pair();
    seed_user_msg(&mut pair, "turn_1", "turn_1:user", "go");
    assert!(
        Aggregator
            .apply(&mut pair, &ev("s1", 2, plan_body("v1")))
            .applied
    );
    assert!(
        Aggregator
            .apply(&mut pair, &ev("s1", 3, plan_body("v2")))
            .applied
    );
    assert_eq!(
        entry_order(&pair)
            .iter()
            .filter(|id| *id == "plan:turn_1")
            .count(),
        1
    );

    let chat_txn = pair.chat.transact();
    let chat_root = chat_writer::root_map_read(&chat_txn).unwrap();
    let payload = chat_root
        .get(&chat_txn, "entries")
        .and_then(|v| v.cast::<yrs::MapRef>().ok())
        .and_then(|entries| entries.get(&chat_txn, "plan:turn_1"))
        .and_then(|v| v.cast::<yrs::MapRef>().ok())
        .and_then(|entry| entry.get(&chat_txn, "plan_entries"))
        .and_then(|v| v.cast::<String>().ok())
        .unwrap();
    assert!(payload.contains("v2"));
}

#[test]
fn agent_plan_without_active_turn_uses_global_entry() {
    let mut pair = pair();
    assert!(
        Aggregator
            .apply(&mut pair, &ev("s1", 1, plan_body("global step")))
            .applied
    );
    assert!(entry_order(&pair).contains(&"plan:global".to_string()));
}

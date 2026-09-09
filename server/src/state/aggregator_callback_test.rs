//! WP-B：无 turnId + callback 语义 → 独立 entry 对，不污染 active_turn。

use super::util::*;

use crate::state::aggregator::{Aggregator, ApplyReason};

#[test]
fn callback_user_message_creates_entry_pair_without_active_turn() {
    let mut pair = pair();
    let cb = "callback_test_1";
    assert!(
        Aggregator
            .apply(
                &mut pair,
                &ev_callback("s1", 1, cb, callback_user_msg(cb, "ping")),
            )
            .applied
    );
    let order = entry_order(&pair);
    assert!(order.contains(&cb.to_string()));
    assert!(order.contains(&format!("{cb}:assistant")));
    assert!(active_turn_id(&pair).is_none());
}

#[test]
fn callback_delta_routes_to_assistant_entry() {
    let mut pair = pair();
    let cb = "callback_test_2";
    assert!(
        Aggregator
            .apply(
                &mut pair,
                &ev_callback("s1", 1, cb, callback_user_msg(cb, "hi")),
            )
            .applied
    );
    assert!(
        Aggregator
            .apply(
                &mut pair,
                &ev_callback("s1", 2, cb, msg_delta("", "", "text", " there")),
            )
            .applied
    );
}

#[test]
fn user_message_without_turn_or_callback_is_rejected() {
    let mut pair = pair();
    let r = Aggregator.apply(
        &mut pair,
        &ev("s1", 1, callback_user_msg("ignored", "nope")),
    );
    assert!(!r.applied);
    assert_eq!(r.reason, Some(ApplyReason::UnknownTurn));
}

#[test]
fn prompt_turn_active_unchanged_when_callback_runs() {
    let mut pair = pair();
    seed_user_msg(&mut pair, "turn_a", "turn_a:user", "prompt");
    assert_eq!(active_turn_id(&pair).as_deref(), Some("turn_a"));

    let cb = "callback_test_3";
    assert!(
        Aggregator
            .apply(
                &mut pair,
                &ev_callback("s1", 2, cb, callback_user_msg(cb, "side channel")),
            )
            .applied
    );
    assert_eq!(active_turn_id(&pair).as_deref(), Some("turn_a"));
}

//! CommandOutcomeBroker 容量/溢出测试（command_outcome_broker_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 997 行超 500 行阈值，按「broker 职责」分主题。
//!
//! 职责边界：本模块只覆盖容量上限——每命令 observer 上限与关闭通道剪枝、
//! 全局第 257 个活动通道拒绝、terminal fallback 溢出粘滞且不逐出既有裁决
//! （admit_terminal_fallback 经父模块从 command_outcome_broker_terminal 导入）。
use super::*;
#[test]
fn observer_capacity_is_bounded_and_closed_channels_are_pruned() {
    let command_id = Uuid::new_v4();
    let outcome_key = key(Uuid::new_v4(), command_id);
    let mut observers = HashMap::new();
    let mut receivers = Vec::new();
    for _ in 0..MAX_OBSERVERS_PER_COMMAND {
        let (tx, rx) = mpsc::channel(1);
        assert!(attach_observer(&mut observers, outcome_key, tx));
        receivers.push(rx);
    }
    let (ninth, _ninth_rx) = mpsc::channel(1);
    assert!(!attach_observer(&mut observers, outcome_key, ninth));

    receivers.pop();
    let (replacement, _replacement_rx) = mpsc::channel(1);
    assert!(attach_observer(&mut observers, outcome_key, replacement));
}

#[test]
fn global_observer_capacity_rejects_the_257th_live_channel() {
    let mut observers = HashMap::new();
    let mut receivers = Vec::new();
    for _ in 0..MAX_OBSERVERS_GLOBAL {
        let (tx, rx) = mpsc::channel(1);
        assert!(attach_observer(
            &mut observers,
            key(Uuid::new_v4(), Uuid::new_v4()),
            tx
        ));
        receivers.push(rx);
    }
    let (overflow, _overflow_rx) = mpsc::channel(1);
    assert!(!attach_observer(
        &mut observers,
        key(Uuid::new_v4(), Uuid::new_v4()),
        overflow
    ));
    assert_eq!(receivers.len(), MAX_OBSERVERS_GLOBAL);
}

#[test]
fn fallback_overflow_is_sticky_and_never_evicts_existing_verdicts() {
    let mut state = OutcomeState::default();
    let first = key(Uuid::new_v4(), Uuid::new_v4());
    for index in 0..MAX_TERMINAL_FALLBACKS {
        let id = if index == 0 {
            first
        } else {
            key(Uuid::new_v4(), Uuid::new_v4())
        };
        admit_terminal_fallback(
            &mut state,
            id,
            action_error(
                &id.command_id.to_string(),
                ErrorCode::DeliveryUnknown,
                "unknown",
                false,
            ),
        );
    }
    assert!(!state.terminal_fallback_overflow);
    let overflow = key(Uuid::new_v4(), Uuid::new_v4());
    admit_terminal_fallback(
        &mut state,
        overflow,
        action_error(
            &overflow.command_id.to_string(),
            ErrorCode::DeliveryUnknown,
            "unknown",
            false,
        ),
    );
    assert!(state.terminal_fallback_overflow);
    assert_eq!(state.terminal_fallbacks.len(), MAX_TERMINAL_FALLBACKS);
    assert!(state.terminal_fallbacks.contains_key(&first));
    assert!(!state.terminal_fallbacks.contains_key(&overflow));
}

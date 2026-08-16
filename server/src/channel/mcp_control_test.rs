use peri_studio_proto::ack::{AckStatus, ErrorCode};
use peri_studio_proto::frame::Frame;
use serde_json::json;

use super::{
    classify_cancel_result, classify_start_result, replay_terminal, MutationVerdict, OAuthClaim,
    OAuthTerminal,
};

#[test]
fn start_and_cancel_results_require_exact_safe_shapes() {
    let command = "00000000-0000-4000-8000-000000000001";
    assert_eq!(
        classify_start_result(
            json!({
                "success": true,
                "status": "started",
                "flowId": command,
                "activeFlowId": command
            }),
            command,
        ),
        MutationVerdict::Committed
    );
    assert_eq!(
        classify_start_result(
            json!({
                "success": false,
                "status": "conflict",
                "flowId": command,
                "activeFlowId": "other-flow"
            }),
            command,
        ),
        MutationVerdict::Rejected("INVALID_STATE")
    );
    for malformed in [
        json!({"success": true,"status":"conflict","flowId":command,"activeFlowId":"other"}),
        json!({"success": true,"status":"started","flowId":"other","activeFlowId":command}),
        json!({"success": true,"status":"started","flowId":command,"activeFlowId":command,"authorizationUrl":"https://secret.invalid"}),
    ] {
        assert_eq!(
            classify_start_result(malformed, command),
            MutationVerdict::DeliveryUnknown("invalid_start_response")
        );
    }
    assert_eq!(
        classify_cancel_result(json!({"success":true,"cancelled":false})),
        MutationVerdict::Committed
    );
    assert_eq!(
        classify_cancel_result(json!({"success":true,"cancelled":true,"rawError":"secret"})),
        MutationVerdict::DeliveryUnknown("invalid_cancel_response")
    );
}

#[test]
fn durable_terminal_replay_never_turns_unknown_into_safe_retry() {
    let command = "00000000-0000-4000-8000-000000000002";
    let Frame::ActionAck(ack) =
        replay_terminal(command, OAuthClaim::Terminal(OAuthTerminal::Committed))
    else {
        panic!("committed terminal must replay an Ack");
    };
    assert_eq!(ack.status, AckStatus::Duplicate);

    let Frame::ActionError(error) = replay_terminal(
        command,
        OAuthClaim::Terminal(OAuthTerminal::DeliveryUnknown {
            error_code: Some("server_restart_after_dispatch".into()),
        }),
    ) else {
        panic!("unknown terminal must replay an error");
    };
    assert_eq!(error.code, ErrorCode::DeliveryUnknown);
    assert!(!error.retryable);
}

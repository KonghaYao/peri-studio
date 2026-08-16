//! error 模块测试（F6 后仅保留 `extract_session_id` 活跃函数）。

use super::*;

#[test]
fn test_extract_session_id() {
    let msg = serde_json::json!({
        "method": "session/prompt",
        "params": {"sessionId": "abc-123"}
    });
    assert_eq!(extract_session_id(&msg), Some("abc-123"));

    let no_sid = serde_json::json!({"method": "session/prompt", "params": {}});
    assert_eq!(extract_session_id(&no_sid), None);

    // 原始 `{type, payload}` 形态。
    let raw = serde_json::json!({
        "type": "session/update",
        "payload": {"sessionId": "raw-9"}
    });
    assert_eq!(extract_session_id(&raw), Some("raw-9"));
}

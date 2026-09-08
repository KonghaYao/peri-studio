//! 从 session/prompt JSON-RPC 响应提取 Chat 可投影的 PublicError（§9.3）。

use peri_studio_proto::schema::PublicError;
use serde_json::Value;

use crate::protocol::{public_error, truncate_text};

/// 从 prompt 的 JSON-RPC 成功响应体提取 turn 失败时的公开错误。
pub(crate) fn public_error_from_prompt_response(
    rpc_response: &Value,
    turn_failed: bool,
) -> Option<PublicError> {
    if !turn_failed {
        return None;
    }
    let result = rpc_response.get("result")?;
    let obj = result.as_object()?;
    if let Some(error) = public_error(obj) {
        return Some(error);
    }
    let message = obj
        .get("message")
        .or_else(|| obj.get("errorMessage"))
        .and_then(Value::as_str)
        .map(truncate_text)
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "The model response failed".to_string());
    Some(PublicError {
        code: "AGENT_ERROR".to_string(),
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_structured_public_error_from_result() {
        let rpc = json!({
            "result": {
                "stopReason": "error",
                "publicError": { "code": "RATE_LIMITED", "message": "safe" }
            }
        });
        let error = public_error_from_prompt_response(&rpc, true).unwrap();
        assert_eq!(error.code, "RATE_LIMITED");
        assert_eq!(error.message, "safe");
    }

    #[test]
    fn synthesizes_agent_error_when_failed_without_payload() {
        let rpc = json!({ "result": { "stopReason": "failed" } });
        let error = public_error_from_prompt_response(&rpc, true).unwrap();
        assert_eq!(error.code, "AGENT_ERROR");
        assert!(error.message.contains("failed"));
    }

    #[test]
    fn none_when_turn_completed() {
        let rpc = json!({ "result": { "stopReason": "end_turn" } });
        assert!(public_error_from_prompt_response(&rpc, false).is_none());
    }
}

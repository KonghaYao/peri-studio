//! ACP 帧最小协议面辅助（§3.3）。

/// 从 ACP 帧中提取 sessionId（§3.3 最小协议面双格式）。
///
/// 兼容两种包裹形态：
/// - 原始 `{type, payload}` 格式：`payload.sessionId`；
/// - JSON-RPC 包裹格式：`params.sessionId`（ACP v1 camelCase 规范）。
///
/// 无法提取 → `None`（调用方丢弃并记本地缺口计数，§3.3）。
///
/// 注：旧 stdio 桥接时代的错误码/响应构造（`error_response`/`ok_response`/
/// `extract_method`/`SESSION_*` 常量）已随 F6 移除（instance 不再应答
/// JSON-RPC，server 全权驱动，见 f6-instance.md §9），本模块仅保留活跃函数。
pub fn extract_session_id(msg: &serde_json::Value) -> Option<&str> {
    msg.get("payload")
        .and_then(|p| p.get("sessionId"))
        .and_then(|v| v.as_str())
        .or_else(|| {
            msg.get("params")
                .and_then(|p| p.get("sessionId"))
                .and_then(|v| v.as_str())
        })
}

#[cfg(test)]
#[path = "error_test.rs"]
mod tests;

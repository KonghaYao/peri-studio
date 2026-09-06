//! 浏览器终端 PTY 线协议（独立于 ACP/Yjs/resource）。
//!
//! 原始字节经标准 base64 承载；`data` 解码后长度不得超过
//! [`MAX_TERMINAL_CHUNK_BYTES`]。

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};

/// instance hello `caps.terminals.protocolVersion` 须为 1。
pub const TERMINAL_PROTOCOL_VERSION: u32 = 1;
/// 单次 input/output 原始字节上限。
pub const MAX_TERMINAL_CHUNK_BYTES: usize = 16 * 1024;
const MAX_TERMINAL_BASE64_BYTES: usize = MAX_TERMINAL_CHUNK_BYTES.div_ceil(3) * 4;
/// 终端行列下限（含）。
pub const TERMINAL_DIM_MIN: u16 = 2;
/// 终端行列上限（含）。
pub const TERMINAL_DIM_MAX: u16 = 500;
/// `requestId` / `projectId` / `terminalId` 最大 UTF-8 字节长度。
pub const MAX_TERMINAL_ID_BYTES: usize = 128;
/// 每个 browser principal 同时打开的终端数上限。
pub const MAX_TERMINALS_PER_PRINCIPAL: usize = 4;
/// instance 侧 PTY 会话总数上限。
pub const MAX_TERMINALS_PER_INSTANCE_HOST: usize = 16;

/// 稳定终端错误码（映射到 `terminal_error.code` 字符串）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TerminalErrorCode {
    Forbidden,
    InvalidRequest,
    Unavailable,
    DeliveryUnknown,
    LimitExceeded,
}

impl TerminalErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Forbidden => "forbidden",
            Self::InvalidRequest => "invalid-request",
            Self::Unavailable => "unavailable",
            Self::DeliveryUnknown => "delivery-unknown",
            Self::LimitExceeded => "limit-exceeded",
        }
    }
}

// ---------------------------------------------------------------------------
// browser ↔ server
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOpen {
    pub request_id: String,
    pub project_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInput {
    pub terminal_id: String,
    pub seq: u64,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResize {
    pub terminal_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalClose {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOpened {
    pub request_id: String,
    pub terminal_id: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutput {
    pub terminal_id: String,
    pub seq: u64,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExit {
    pub terminal_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signal: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalError {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal_id: Option<String>,
    pub code: TerminalErrorCode,
    pub message: String,
    pub retryable: bool,
}

// ---------------------------------------------------------------------------
// server ↔ instance
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceTerminalOpen {
    pub request_id: String,
    pub terminal_id: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceTerminalInput {
    pub terminal_id: String,
    pub seq: u64,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceTerminalResize {
    pub terminal_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceTerminalClose {
    pub terminal_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceTerminalOpened {
    pub request_id: String,
    pub terminal_id: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cols: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceTerminalOutput {
    pub terminal_id: String,
    pub seq: u64,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceTerminalExit {
    pub terminal_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signal: Option<String>,
}

/// 校验协议 id 字段：非空且 UTF-8 字节长度有界。
pub fn validate_terminal_id(id: &str, field: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err(format!("{field} must not be empty"));
    }
    if id.len() > MAX_TERMINAL_ID_BYTES {
        return Err(format!("{field} exceeds max length"));
    }
    Ok(())
}

/// 校验终端尺寸。
pub fn validate_terminal_dims(cols: u16, rows: u16) -> Result<(), String> {
    if !(TERMINAL_DIM_MIN..=TERMINAL_DIM_MAX).contains(&cols)
        || !(TERMINAL_DIM_MIN..=TERMINAL_DIM_MAX).contains(&rows)
    {
        return Err("cols/rows out of range".into());
    }
    Ok(())
}

/// 严格 base64 解码并检查原始字节上限。
pub fn decode_terminal_chunk(data: &str) -> Result<Vec<u8>, String> {
    if data.is_empty() {
        return Ok(Vec::new());
    }
    if data.len() > MAX_TERMINAL_BASE64_BYTES {
        return Err("chunk too large".into());
    }
    let decoded = STANDARD
        .decode(data.as_bytes())
        .map_err(|_| "invalid base64".to_string())?;
    if decoded.len() > MAX_TERMINAL_CHUNK_BYTES {
        return Err("chunk too large".into());
    }
    Ok(decoded)
}

/// 编码输出块（调用方须保证 `raw.len() <= MAX_TERMINAL_CHUNK_BYTES`）。
pub fn encode_terminal_chunk(raw: &[u8]) -> String {
    STANDARD.encode(raw)
}

#[cfg(test)]
#[path = "terminal_test.rs"]
mod terminal_test;

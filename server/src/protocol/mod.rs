//! 协议层（Feature F5）：ACPChannel 入站规范化 + Translator 出站翻译（§6.1）。
//!
//! 定位：server 侧的**唯一协议边界**（架构 §6.1）。instance 透明转发原始 ACP
//! 帧，server 在此规范化为 [`NormalizedEvent`]（state 层定义），聚合层只消费
//! 规范化事件；客户端 Action 经 [`Translator`] 翻译为 ACP JSON-RPC 下发。
//!
//! 本层为**纯函数层**（零 I/O、零状态依赖，除 [`Translator`] 的 rpcId 分配
//! 计数器）：binding 校验与持久化在调用方（channel 层 RelayEventHandler /
//! CommandCoordinator）。
//!
//! 脱敏纪律（§9.3）：本层不产生日志；字段提取只做结构校验，不记录正文。
//!
//! 权威：`docs/architecture.md` §6.1/§4.3/§9.3。

mod acp_channel;
mod acp_channel_activity;
mod acp_channel_config;
mod acp_channel_elicitation;
mod acp_channel_map;
mod acp_channel_parse;
mod acp_channel_question;
mod acp_channel_task;
mod acp_channel_tool;
mod mcp_name;
mod ssh_destination;
mod translator;

pub use acp_channel::{
    extract_session_id, normalize_agent_config, AcpChannel, AgentConfigSnapshot,
    ConfigCatalogError, DropReason, ElicitationRequestFields, NormalizeOutcome,
    PermissionRequestFields, PERMISSION_TIMEOUT,
};
pub(crate) use acp_channel_parse::jsonrpc_response_id;
pub(crate) use acp_channel_parse::{public_error, truncate_text};
pub use mcp_name::{parse_mcp_tool_name, ParsedMcpToolName};
pub use ssh_destination::{validate_identity_file_path, validate_ssh_destination};
pub(crate) use translator::permission_option_matches;
pub use translator::{
    negotiated_peri_extensions, validate_cwd, OutboundCtx, OutboundMessage, TranslateError,
    Translator, PERI_AGENT_ACTIVITY_EXTENSION, PERI_OAUTH_EXTENSION, PERI_PREDICTION_EXTENSION,
    PERI_REPLAY_EXTENSION, PERI_REWIND_EXTENSION, PERI_SKILL_NAMES_EXTENSION,
    PERI_TOKEN_STATS_EXTENSION,
};

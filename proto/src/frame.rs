//! 帧模型：`Frame` 枚举（serde tag `"t"`）与解析入口（§4.2）。
//!
//! 每条 WebSocket 文本消息是一个 JSON 对象 `{ "t": <frame_type>, ... }`。
//! `Frame` 采用**双层 internally tagged** 形态：外层 `t` 判别帧类，`Action`
//! 变体 newtype 包裹 tag `"type"` 的 [`ActionEnvelope`]。
//!
//! [`Frame::parse`] 先直接反序列化；失败时回退提取 `t` 查全量注册表（[`FRAME_TAGS`]），
//! 区分「未知 tag」（→ [`ProtoError::Unsupported`]）与「已知 tag 反序列化失败」
//! （→ [`ProtoError::Malformed`]），不 panic、不静默。
//!
//! **全量帧 tag 注册表**（[`FRAME_TAGS`]，含 M2/M3 保留帧）归属本层：它是
//! `Frame::parse` 区分「未知 tag」与「已知 tag 反序列化失败」的服务对象；
//! M1 收窄层（[`crate::whitelist`]）只持有对 [`FrameTag`] 的引用与收窄逻辑，
//! 不反向持有全集（依赖方向：帧层 → 收窄层，无循环）。
//!
//! **重复 `t` 键**（RFC 8259 未定义行为，畸形输入）：serde 流式解析取第一个
//! `t` 键值，回退路径（`Value` BTreeMap 合并）取最后一个——两条路径对 `t`
//! 的选取不一致，属已知语义差异（review cross#2，接受，无兼容义务）；
//! 行为由测试 `duplicate_t_key_is_malformed_or_unsupported` 固定。

use serde::{Deserialize, Serialize};

use crate::ack::{ActionAck, ActionError};
use crate::action::ActionEnvelope;
use crate::conn::{Auth, AuthResponse, KeepAlive, Pong, Ready};
use crate::event::EventFrame;
use crate::instance::{
    InstanceBufferSync, InstanceEvent, InstanceForward, InstanceForwardAck, InstanceHeartbeat,
    InstanceHello, InstanceKill, InstanceKillAck, InstanceProcessExit, InstanceSpawn,
    InstanceSpawnAck,
};
use crate::mcp_apps::{McpAppCallResultFrame, McpAppResourceFrame, McpAppSessionFrame};
use crate::oauth::{McpOAuthAuthorizationFrame, McpOAuthFrame, McpServersFrame};
use crate::resource::{
    InstanceResourceQuery, InstanceResourceResult, ResourceQuery, ResourceResult,
};
use crate::rewind::{RewindCandidatesFrame, RewindPreviewFrame};
use crate::session::PromptStatusFrame;
use crate::session::SessionListFrame;
use crate::terminal::{
    InstanceTerminalClose, InstanceTerminalExit, InstanceTerminalInput, InstanceTerminalOpen,
    InstanceTerminalOpened, InstanceTerminalOutput, InstanceTerminalResize, TerminalClose,
    TerminalError, TerminalExit, TerminalInput, TerminalOpen, TerminalOpened, TerminalOutput,
    TerminalResize,
};
use crate::ysync::{YsyncAwareness, YsyncSubscribe, YsyncSync, YsyncUnsubscribe, YsyncUpdate};

/// 全量帧 tag 注册表（§3.2 完整面，含 M2/M3 保留帧）。
///
/// `Frame::parse` 依赖：tag 出现在此表 = 已知帧，反序列化失败归类为
/// `Malformed`；不在此表 = 未知帧，归类为 `Unsupported`。M1 收窄与方向
/// 约束见 [`crate::whitelist::m1_check`]。
pub static FRAME_TAGS: &[FrameTag] = &[
    FrameTag("action"),
    FrameTag("action_ack"),
    FrameTag("action_error"),
    FrameTag("event"),
    FrameTag("keep_alive"),
    FrameTag("pong"),
    FrameTag("ready"),
    FrameTag("auth"),
    FrameTag("auth_response"),
    FrameTag("ysync.subscribe"),
    FrameTag("ysync.unsubscribe"),
    FrameTag("ysync.update"),
    FrameTag("ysync.sync"),
    FrameTag("ysync.awareness"),
    FrameTag("instance/hello"),
    FrameTag("instance/heartbeat"),
    FrameTag("instance/event"),
    FrameTag("instance/buffer_sync"),
    FrameTag("instance/spawn"),
    FrameTag("instance/kill"),
    FrameTag("instance/forward"),
    FrameTag("instance/spawn_ack"),
    FrameTag("instance/kill_ack"),
    FrameTag("instance/forward_ack"),
    FrameTag("instance/process_exit"),
    FrameTag("session_list"),
    FrameTag("prompt_status"),
    FrameTag("mcp_servers"),
    FrameTag("mcp_oauth"),
    FrameTag("mcp_oauth_authorization"),
    FrameTag("mcp_app_session"),
    FrameTag("mcp_app_resource"),
    FrameTag("mcp_app_call_result"),
    FrameTag("rewind_candidates"),
    FrameTag("rewind_preview"),
    FrameTag("resource_query"),
    FrameTag("resource_result"),
    FrameTag("instance/resource_query"),
    FrameTag("instance/resource_result"),
    FrameTag("terminal_open"),
    FrameTag("terminal_input"),
    FrameTag("terminal_resize"),
    FrameTag("terminal_close"),
    FrameTag("terminal_opened"),
    FrameTag("terminal_output"),
    FrameTag("terminal_exit"),
    FrameTag("terminal_error"),
    FrameTag("instance/terminal_open"),
    FrameTag("instance/terminal_input"),
    FrameTag("instance/terminal_resize"),
    FrameTag("instance/terminal_close"),
    FrameTag("instance/terminal_opened"),
    FrameTag("instance/terminal_output"),
    FrameTag("instance/terminal_exit"),
];

/// 帧解析与白名单检查的错误面。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProtoError {
    /// JSON 不可解析 / 字段缺失 / 已知 tag 但载荷反序列化失败。
    #[error("malformed frame: {0}")]
    Malformed(String),
    /// `t` 未注册，或已知但不在当前 M1 白名单 → 上层映射为 `UNSUPPORTED_FRAME`（§4.8）。
    #[error("unsupported frame tag: {0}")]
    Unsupported(String),
    /// 帧在白名单内但方向约束违反（如 C→S 的 `ysync.update`，§5.6）。
    #[error("frame rejected by direction: {0}")]
    DirectionRejected(String),
}

/// `"t"` 的静态注册表条目（见 [`FRAME_TAGS`]）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FrameTag(pub &'static str);

impl std::fmt::Display for FrameTag {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

/// 全量帧枚举（§4.2 完整面 → M1 收窄见 [`crate::whitelist`]）。
///
/// tag 值含 `.`（`ysync.*`）与 `/`（`instance/*`），无法由 `rename_all` 派生，
/// 逐变体显式 `#[serde(rename = ...)]`。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t")]
pub enum Frame {
    /// C→S 控制命令；`ActionEnvelope` 自身是 tag=`"type"` 的 internally tagged 枚举。
    #[serde(rename = "action")]
    Action(ActionEnvelope),
    /// S→C 两阶段 Ack（§4.4）。
    #[serde(rename = "action_ack")]
    ActionAck(ActionAck),
    /// S→C 稳定错误码（§4.4）。
    #[serde(rename = "action_error")]
    ActionError(ActionError),
    /// S→C `events/subscribe` 推送（M3 启用，类型保留）。
    #[serde(rename = "event")]
    Event(EventFrame),
    /// S→C 心跳（§4.7）。
    #[serde(rename = "keep_alive")]
    KeepAlive(KeepAlive),
    /// C→S keep_alive 回执（§4.7）。
    #[serde(rename = "pong")]
    Pong(Pong),
    /// S→C 快照推送完成握手（§4.6）。
    #[serde(rename = "ready")]
    Ready(Ready),
    /// C→S 连接后第一帧；角色由 token 解析（§4.2）。
    #[serde(rename = "auth")]
    Auth(Auth),
    /// S→M server 身份证明（§9.2 步骤 2；M1 instance 面）。
    #[serde(rename = "auth_response")]
    AuthResponse(AuthResponse),
    /// C→S 订阅 Doc（§4.2）。
    #[serde(rename = "ysync.subscribe")]
    YsyncSubscribe(YsyncSubscribe),
    /// C→S 退订 Doc（§4.2）。
    #[serde(rename = "ysync.unsubscribe")]
    YsyncUnsubscribe(YsyncUnsubscribe),
    /// S→C 单向 update（base64，§5.6；客户端上行一律拒绝）。
    #[serde(rename = "ysync.update")]
    YsyncUpdate(YsyncUpdate),
    /// y-sync Step 1/2（§5.6 不采用双向增量握手，保留定义）。
    #[serde(rename = "ysync.sync")]
    YsyncSync(YsyncSync),
    /// y-protocol awareness（M3 启用，保留定义）。
    #[serde(rename = "ysync.awareness")]
    YsyncAwareness(YsyncAwareness),
    /// M→S 注册 + 重连握手（§4.5）。
    #[serde(rename = "instance/hello")]
    InstanceHello(InstanceHello),
    /// M→S 周期心跳（§4.5）。
    #[serde(rename = "instance/heartbeat")]
    InstanceHeartbeat(InstanceHeartbeat),
    /// M→S 原始 ACP 帧转发（带 seq 与流纪元，§4.5.1）。
    #[serde(rename = "instance/event")]
    InstanceEvent(InstanceEvent),
    /// M→S 断线缓冲补推（§4.5）。
    #[serde(rename = "instance/buffer_sync")]
    InstanceBufferSync(InstanceBufferSync),
    /// S→M 启动 ACP 进程（按 session_id 幂等，§4.5）。
    #[serde(rename = "instance/spawn")]
    InstanceSpawn(InstanceSpawn),
    /// S→M 停止 ACP 进程（幂等，§4.5）。
    #[serde(rename = "instance/kill")]
    InstanceKill(InstanceKill),
    /// S→M 下行 ACP JSON-RPC 透传（L1+L2 确认，§4.5/§4.4）。
    #[serde(rename = "instance/forward")]
    InstanceForward(InstanceForward),
    /// M→S spawn 结果（§4.5）。
    #[serde(rename = "instance/spawn_ack")]
    InstanceSpawnAck(InstanceSpawnAck),
    /// M→S kill 结果（§4.5）。
    #[serde(rename = "instance/kill_ack")]
    InstanceKillAck(InstanceKillAck),
    /// M→S 下行转发结果（L1+L2 合并确认，§4.4）。
    #[serde(rename = "instance/forward_ack")]
    InstanceForwardAck(InstanceForwardAck),
    /// S→C 按需会话列表查询结果（§6.3：agent 侧真实数据源，非轮询投影）。
    #[serde(rename = "session_list")]
    SessionList(SessionListFrame),
    /// S→C 持久 logical session 的安全 prompt delivery 摘要。
    #[serde(rename = "prompt_status")]
    PromptStatus(PromptStatusFrame),
    /// S→C 当前 runtime 的安全 MCP 连接快照。
    #[serde(rename = "mcp_servers")]
    McpServers(McpServersFrame),
    /// S→C 不含 URL/raw error 的 MCP OAuth 生命周期状态。
    #[serde(rename = "mcp_oauth")]
    McpOAuth(McpOAuthFrame),
    /// S→C full-role exact-flow 瞬时授权地址响应。
    #[serde(rename = "mcp_oauth_authorization")]
    McpOAuthAuthorization(McpOAuthAuthorizationFrame),
    /// S→C MCP App open 结果（app session 元数据，不含 HTML）。
    #[serde(rename = "mcp_app_session")]
    McpAppSession(McpAppSessionFrame),
    /// S→C MCP App UI HTML（瞬时，对标 oauth authorization）。
    #[serde(rename = "mcp_app_resource")]
    McpAppResource(McpAppResourceFrame),
    /// S→C MCP App `tools/call` 结果（瞬时）。
    #[serde(rename = "mcp_app_call_result")]
    McpAppCallResult(McpAppCallResultFrame),
    /// S→C Peri rewind 目标目录。server 已对每个预览做有界与脱敏处理。
    #[serde(rename = "rewind_candidates")]
    RewindCandidates(RewindCandidatesFrame),
    /// S→C 精确 rewind 影响预览与确认指纹。
    #[serde(rename = "rewind_preview")]
    RewindPreview(RewindPreviewFrame),
    /// Web 面板申请/释放有界资源视图或 blob ticket。
    #[serde(rename = "resource_query")]
    ResourceQuery(ResourceQuery),
    /// server 返回资源视图/blob ticket 查询结果。
    #[serde(rename = "resource_result")]
    ResourceResult(ResourceResult),
    /// server → instance 的可信资源查询。
    #[serde(rename = "instance/resource_query")]
    InstanceResourceQuery(InstanceResourceQuery),
    /// instance → server 的资源查询结果。
    #[serde(rename = "instance/resource_result")]
    InstanceResourceResult(InstanceResourceResult),
    /// C→S 打开项目终端（PTY）。
    #[serde(rename = "terminal_open")]
    TerminalOpen(TerminalOpen),
    /// C→S 终端输入。
    #[serde(rename = "terminal_input")]
    TerminalInput(TerminalInput),
    /// C→S 终端尺寸调整。
    #[serde(rename = "terminal_resize")]
    TerminalResize(TerminalResize),
    /// C→S 关闭终端。
    #[serde(rename = "terminal_close")]
    TerminalClose(TerminalClose),
    /// S→C 终端已就绪。
    #[serde(rename = "terminal_opened")]
    TerminalOpened(TerminalOpened),
    /// S→C 终端输出。
    #[serde(rename = "terminal_output")]
    TerminalOutput(TerminalOutput),
    /// S→C 终端进程退出。
    #[serde(rename = "terminal_exit")]
    TerminalExit(TerminalExit),
    /// S→C 终端错误。
    #[serde(rename = "terminal_error")]
    TerminalError(TerminalError),
    /// S→M 打开 PTY。
    #[serde(rename = "instance/terminal_open")]
    InstanceTerminalOpen(InstanceTerminalOpen),
    /// S→M 终端输入。
    #[serde(rename = "instance/terminal_input")]
    InstanceTerminalInput(InstanceTerminalInput),
    /// S→M 终端 resize。
    #[serde(rename = "instance/terminal_resize")]
    InstanceTerminalResize(InstanceTerminalResize),
    /// S→M 关闭终端。
    #[serde(rename = "instance/terminal_close")]
    InstanceTerminalClose(InstanceTerminalClose),
    /// M→S 打开结果。
    #[serde(rename = "instance/terminal_opened")]
    InstanceTerminalOpened(InstanceTerminalOpened),
    /// M→S 终端输出。
    #[serde(rename = "instance/terminal_output")]
    InstanceTerminalOutput(InstanceTerminalOutput),
    /// M→S 终端退出。
    #[serde(rename = "instance/terminal_exit")]
    InstanceTerminalExit(InstanceTerminalExit),
    /// M→S ACP 进程退出事件（§4.5）。
    #[serde(rename = "instance/process_exit")]
    InstanceProcessExit(InstanceProcessExit),
}

impl Frame {
    /// 直接反序列化单条消息（单遍文本解析构建变体）。
    ///
    /// 失败时回退一次 `Value` 解析提取 `"t"` 查全量注册表，区分「未知 tag」
    /// （→ [`ProtoError::Unsupported`]）与「已知 tag 反序列化失败」
    /// （→ [`ProtoError::Malformed`]）。不 panic、不静默。
    pub fn parse(raw: &str) -> Result<Frame, ProtoError> {
        // 正常路径：单遍文本解析直接构建变体（省 Value DOM 构建与 from_value 深拷贝）。
        // serde internally tagged 枚举的报错不区分「未知 tag」与「已知但畸形」，
        // 失败时回退一次 Value 解析提取 t 完成分类（错误帧低频，非热路径）。
        match serde_json::from_str::<Frame>(raw) {
            Ok(frame) => Ok(frame),
            Err(e) => {
                let unknown_tag = serde_json::from_str::<serde_json::Value>(raw)
                    .ok()
                    .and_then(|v| {
                        v.get("t")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_string)
                    })
                    .filter(|t| !FRAME_TAGS.iter().any(|tag| tag.0 == t));
                match unknown_tag {
                    Some(tag) => Err(ProtoError::Unsupported(tag)),
                    None => Err(ProtoError::Malformed(e.to_string())),
                }
            }
        }
    }

    /// 返回本帧的 `"t"` 注册表条目。
    pub fn tag(&self) -> FrameTag {
        match self {
            Frame::Action(_) => FrameTag("action"),
            Frame::ActionAck(_) => FrameTag("action_ack"),
            Frame::ActionError(_) => FrameTag("action_error"),
            Frame::Event(_) => FrameTag("event"),
            Frame::KeepAlive(_) => FrameTag("keep_alive"),
            Frame::Pong(_) => FrameTag("pong"),
            Frame::Ready(_) => FrameTag("ready"),
            Frame::Auth(_) => FrameTag("auth"),
            Frame::AuthResponse(_) => FrameTag("auth_response"),
            Frame::YsyncSubscribe(_) => FrameTag("ysync.subscribe"),
            Frame::YsyncUnsubscribe(_) => FrameTag("ysync.unsubscribe"),
            Frame::YsyncUpdate(_) => FrameTag("ysync.update"),
            Frame::YsyncSync(_) => FrameTag("ysync.sync"),
            Frame::YsyncAwareness(_) => FrameTag("ysync.awareness"),
            Frame::InstanceHello(_) => FrameTag("instance/hello"),
            Frame::InstanceHeartbeat(_) => FrameTag("instance/heartbeat"),
            Frame::InstanceEvent(_) => FrameTag("instance/event"),
            Frame::InstanceBufferSync(_) => FrameTag("instance/buffer_sync"),
            Frame::InstanceSpawn(_) => FrameTag("instance/spawn"),
            Frame::InstanceKill(_) => FrameTag("instance/kill"),
            Frame::InstanceForward(_) => FrameTag("instance/forward"),
            Frame::InstanceSpawnAck(_) => FrameTag("instance/spawn_ack"),
            Frame::InstanceKillAck(_) => FrameTag("instance/kill_ack"),
            Frame::InstanceForwardAck(_) => FrameTag("instance/forward_ack"),
            Frame::InstanceProcessExit(_) => FrameTag("instance/process_exit"),
            Frame::SessionList(_) => FrameTag("session_list"),
            Frame::PromptStatus(_) => FrameTag("prompt_status"),
            Frame::McpServers(_) => FrameTag("mcp_servers"),
            Frame::McpOAuth(_) => FrameTag("mcp_oauth"),
            Frame::McpOAuthAuthorization(_) => FrameTag("mcp_oauth_authorization"),
            Frame::McpAppSession(_) => FrameTag("mcp_app_session"),
            Frame::McpAppResource(_) => FrameTag("mcp_app_resource"),
            Frame::McpAppCallResult(_) => FrameTag("mcp_app_call_result"),
            Frame::RewindCandidates(_) => FrameTag("rewind_candidates"),
            Frame::RewindPreview(_) => FrameTag("rewind_preview"),
            Frame::ResourceQuery(_) => FrameTag("resource_query"),
            Frame::ResourceResult(_) => FrameTag("resource_result"),
            Frame::InstanceResourceQuery(_) => FrameTag("instance/resource_query"),
            Frame::InstanceResourceResult(_) => FrameTag("instance/resource_result"),
            Frame::TerminalOpen(_) => FrameTag("terminal_open"),
            Frame::TerminalInput(_) => FrameTag("terminal_input"),
            Frame::TerminalResize(_) => FrameTag("terminal_resize"),
            Frame::TerminalClose(_) => FrameTag("terminal_close"),
            Frame::TerminalOpened(_) => FrameTag("terminal_opened"),
            Frame::TerminalOutput(_) => FrameTag("terminal_output"),
            Frame::TerminalExit(_) => FrameTag("terminal_exit"),
            Frame::TerminalError(_) => FrameTag("terminal_error"),
            Frame::InstanceTerminalOpen(_) => FrameTag("instance/terminal_open"),
            Frame::InstanceTerminalInput(_) => FrameTag("instance/terminal_input"),
            Frame::InstanceTerminalResize(_) => FrameTag("instance/terminal_resize"),
            Frame::InstanceTerminalClose(_) => FrameTag("instance/terminal_close"),
            Frame::InstanceTerminalOpened(_) => FrameTag("instance/terminal_opened"),
            Frame::InstanceTerminalOutput(_) => FrameTag("instance/terminal_output"),
            Frame::InstanceTerminalExit(_) => FrameTag("instance/terminal_exit"),
        }
    }
}

#[cfg(test)]
#[path = "frame_test.rs"]
mod frame_test;

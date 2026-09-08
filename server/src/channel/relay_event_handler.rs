//! instance 入站事件消费与断链清理（架构 §4.5/§6.1/§8.2/§8.5）。
//!
//! 入站链路：epoch 校验（防御，§4.5.1）→ binding 校验（§6.1 规则 5）→
//! ACPChannel 规范化 → `DocManager::submit_event`（F4 单写者 + 微批次 +
//! 投递）。`RpcResponse`（L3）经 pending_rpc 表匹配通知 coordinator（§4.4）。
//!
//! **持久化澄清**（设计稿 §8 注）：instance 入站事件**不进 outbox**（outbox
//! 是命令账本，§4.4）；入站事件经 DocManager → UpdateSink 投递到内存镜像
//! （StoreSink）+ 广播（**无落盘**；update 日志/水位随无状态投影重构已删除）。
//! 断链期间 instance 缓冲保留产出，补推由 `instance/buffer_sync` 的 `from_seq`
//! 驱动（§8.5）。
//!
//! 断链清理（§8.2 matrix instance 行 + §7.1 离线即刻生效）：该 instance 全部
//! 活 chat → 活动 turn `MarkTurnInterrupted`、`registry.set_chat_gap`
//! 置标记（缺口数量由补推时聚合器精确计算）、chat 状态 Gap。
//! **遗留**：pending 权限批量 expired（§7.1）需 F4 提供枚举/批量 CAS 命令
//! （本模块无 Doc 读取接口），断链时保持 pending（gap 期间只读，补推/新事件
//! 驱动），已记录输出。
//!
//! **结构拆分**（review #3，行为语义不变）：本文件收敛为类型定义、装配与
//! 实时帧入口 `on_instance_event`；实现段按主题拆出——`relay_buffer_sync`
//! （补推消费）、`relay_disconnect`（断链清理/进程退出）、`relay_permission`
//! （官方 permission/elicitation 登记与响应材料）、`relay_rpc`（pending_rpc
//! 与丢弃指标）、`relay_events`（规范化投递与 gap 恢复）。

use std::collections::HashMap;
use std::sync::{Arc, RwLock as StdRwLock};

use tokio::sync::{oneshot, RwLock};

use peri_studio_proto::action::PermissionDecision;
use peri_studio_proto::instance::InstanceEvent;
use peri_studio_proto::oauth::{McpOAuthAuthorizationFrame, McpOAuthFrame};
use peri_studio_proto::schema::ElicitationFieldProjection;

use crate::protocol::{extract_session_id, AcpChannel, NormalizeOutcome, PERI_OAUTH_EXTENSION};
use crate::state::doc_manager::DocManager;
use crate::state::registry::RegistryState;

use crate::control::{ChatRegistry, InstanceRegistry};

use super::oauth_control::OAuthControl;
use super::relay_question::PendingQuestionReq;

/// 消费结果（gateway 记录日志/计数用；脱敏，不携带正文）。
#[derive(Debug, Clone, PartialEq)]
pub enum ConsumeResult {
    /// 已投递聚合器（`applied=false` 表示聚合器拒绝——幂等/守卫/防御，按
    /// reason 计数，§6.3）。
    Delivered {
        /// hub 侧 chat_id。
        chat_id: String,
        /// 事件种类（脱敏）。
        kind: &'static str,
        /// instance 侧 seq。
        seq: u64,
        /// 聚合器是否接受。
        applied: bool,
    },
    /// JSON-RPC response 匹配 pending_rpc（L3 确认，§4.4）。
    RpcConfirmed {
        /// 关联 command_id。
        command_id: String,
        /// 完整 response（coordinator 解析 result/error）。
        response: serde_json::Value,
    },
    /// Capability-gated, privacy-safe OAuth lifecycle frame. Authorization URL
    /// is deliberately absent and is available only through an explicit query.
    OAuthStatus {
        chat_id: String,
        frame: McpOAuthFrame,
    },
    /// 单帧丢弃 + 原因（§4.5.1 防御；计数）。
    Dropped {
        /// 稳定原因（脱敏）。
        reason: &'static str,
    },
    /// 整批拒绝（buffer_sync epoch 不符，§4.5.1）。
    BatchRejected {
        /// 稳定原因。
        reason: &'static str,
    },
    /// 事件已投递但 UpdateSink 投递失败（§17.2 degraded 输入）。
    PersistFailed {
        /// hub 侧 chat_id。
        chat_id: String,
    },
}

/// relay 错误（断链清理面）。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RelayError {
    /// Registry 写回失败。
    #[error("registry write failed: {0}")]
    Registry(String),
    /// DocManager 提交拒绝（chat 不存在/已关闭）。
    #[error("submit rejected: {0}")]
    Submit(String),
}

/// pending_rpc 条目（L3 确认，§4.4）。
#[derive(Debug)]
pub struct PendingRpc {
    /// 关联 command_id（coordinator 登记）。
    pub command_id: String,
    /// 响应通知通道（coordinator 等待侧；`None` = 已超时清理）。
    pub(super) notify: Option<oneshot::Sender<serde_json::Value>>,
}

/// pending_permission 表条目（#1：官方 `session/request_permission` 响应回
/// 投数据；key = server 生成 permission_id）。
#[derive(Debug, Clone)]
pub struct PendingPermissionReq {
    /// agent 的 request id（响应帧 id 原样回显）。
    pub request_id: serde_json::Value,
    /// 官方 options 原样（响应 optionId 回显选档）。
    pub options: Vec<serde_json::Value>,
    /// 归属 chat（断链/进程退出清理用）。
    pub chat_id: String,
    /// 过期时刻（RFC3339，与投影 expires_at 同源；TTL 剪枝用，review #17）。
    pub expires_at: String,
    /// 首次裁决的 commandId。明确未送达时只允许这一条命令
    /// 恢复，防止新 commandId 把同一安全副作用重放。
    pub(super) resolving_command_id: Option<String>,
    /// 与 `resolving_command_id` 绑定的原始决策。
    pub(super) resolving_decision: Option<PermissionDecision>,
    /// 与命令绑定的精确 ACP optionId；legacy 请求可能缺失。
    pub(super) resolving_option_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PendingElicitationReq {
    pub request_id: serde_json::Value,
    pub chat_id: String,
    pub fields: Vec<ElicitationFieldProjection>,
    pub(super) resolving_command_id: Option<String>,
    pub(super) response_fingerprint: Option<String>,
}

/// 客户端请求拒绝载荷（reject_client_request 参数；`pub(super)` 供
/// `relay_permission`/`relay_buffer_sync` 构造——结构拆分，行为语义不变）。
pub(super) struct ClientRequestRejection {
    pub(super) request_id: serde_json::Value,
    pub(super) code: i32,
    pub(super) message: &'static str,
}

/// instance 入站事件消费（§4.5）。
///
/// `inner` 与 [`RelayInner`] 字段均为 `pub(super)`：结构拆分后实现段位于
/// sibling 模块（`relay_rpc`/`relay_permission`/`relay_events` 等），需在
/// `channel` 模块内共享访问——仅放宽可见性，行为语义不变。
#[derive(Clone)]
pub struct RelayEventHandler {
    pub(super) inner: Arc<RelayInner>,
}

pub(super) struct RelayInner {
    pub(super) doc: Arc<DocManager>,
    pub(super) chats: ChatRegistry,
    pub(super) instance: Arc<InstanceRegistry>,
    pub(super) registry: RegistryState,
    pub(super) channel: AcpChannel,
    /// pending_rpc 表（rpc_id → command_id；L3 确认，§4.4）——与 coordinator
    /// 共享的 in-memory 表（设计稿【决策】放本模块，coordinator 登记、本模块
    /// 匹配）。
    pub(super) pending_rpc: RwLock<HashMap<String, PendingRpc>>,
    /// pending_permissions 表（permission_id → 官方 request 回投数据；#1，
    /// 与 pending_rpc 并列，coordinator resolve 时一次性 take）。
    pub(super) pending_permissions: RwLock<HashMap<String, PendingPermissionReq>>,
    pub(super) pending_elicitations: RwLock<HashMap<String, PendingElicitationReq>>,
    /// O-001：无 prompt turn 的 callback 流（chat_id → `callback_{uuid}`）。
    pub(super) callback_entry_by_chat: RwLock<HashMap<String, String>>,
    pub(super) pending_questions: RwLock<HashMap<String, PendingQuestionReq>>,
    pub(super) oauth: OAuthControl,
    /// MCP App 首屏 CallToolResult（chat_id → tool_call_id → result）。
    /// Chat Doc 4KB 会省略；随 chat tear-down 丢弃，不落盘。
    pub(super) mcp_app_tool_results: RwLock<HashMap<String, HashMap<String, serde_json::Value>>>,
    /// MCP App 首屏 tool input（canvas 的 source 在 arguments 里，ACP 结果常只有 text fallback）。
    pub(super) mcp_app_tool_inputs: RwLock<HashMap<String, HashMap<String, serde_json::Value>>>,
    /// 丢弃计数（§17.1 指标；**按原因分桶**，review #6：调用方传入的稳定
    /// 原因——`epoch_mismatch`/`binding_missing`/`oauth_replay_rejected` 等
    /// ——各自独立计数，运维可区分丢弃分布）。
    pub(super) dropped: StdRwLock<HashMap<&'static str, u64>>,
}

impl RelayEventHandler {
    /// 装配（hub 调用；`AcpChannel` 以默认权限超时 5min 构建，§16）。
    pub fn new(
        doc: Arc<DocManager>,
        chats: ChatRegistry,
        instance: Arc<InstanceRegistry>,
        registry: RegistryState,
    ) -> Self {
        RelayEventHandler {
            inner: Arc::new(RelayInner {
                doc,
                chats,
                instance,
                registry,
                channel: AcpChannel::default(),
                pending_rpc: RwLock::new(HashMap::new()),
                pending_permissions: RwLock::new(HashMap::new()),
                pending_elicitations: RwLock::new(HashMap::new()),
                callback_entry_by_chat: RwLock::new(HashMap::new()),
                pending_questions: RwLock::new(HashMap::new()),
                oauth: OAuthControl::new(),
                mcp_app_tool_results: RwLock::new(HashMap::new()),
                mcp_app_tool_inputs: RwLock::new(HashMap::new()),
                dropped: StdRwLock::new(HashMap::new()),
            }),
        }
    }

    /// `instance/event` 消费（§4.5）。
    ///
    /// 链路：epoch 校验（hello 上报的 stream_epochs；无记录 → 放行，聚合器
    /// 防御兜底）→ binding 校验（§6.1）→ normalize → submit_event。
    pub async fn on_instance_event(&self, instance_id: &str, ev: &InstanceEvent) -> ConsumeResult {
        // 1. epoch 校验（§4.5.1 防御；正常路径 hello 已对账）。
        //    信封 chat_id = instance 进程归属（hub chat id，spawn 时
        //    确立，§4.5.1）；instance hello 上报 stream_epochs 同为该键。
        if let Some(expected) = self
            .inner
            .instance
            .chat_epoch(instance_id, &ev.chat_id)
            .await
        {
            if expected != ev.epoch {
                self.count_dropped("epoch_mismatch");
                return ConsumeResult::Dropped {
                    reason: "epoch_mismatch",
                };
            }
        }
        // 2. binding 校验（§6.1 规则 5 / §6.5 / §495）：**ACP 帧内携带的
        //    sessionId**（acp_session_id，test-child/真实 ACP 自建 id）必须
        //    命中可信 binding（acp_session_id → hub chat_id）且映射回本
        //    信封 chat。信封本身是 instance 进程归属（dumb pipe 不翻译 id，
        //    §3.3），不再作 binding 查询键。
        //    JSON-RPC 形态例外（#5，与 child.rs C1 同判据——有 jsonrpc 键
        //    的 response/request/notification 无帧内 sessionId 语义）：
        //    create 序列 initialize/session/new 的响应（§4.4 L3 经 pending_rpc
        //    匹配）、官方 session/request_permission request（#1，params.
        //    sessionId 必填但防御性统一）、agent/status 通知（instance 级
        //    事件）按信封兜底投递；其余帧按 §6.1 丢弃。
        let hub_chat_id = ev.chat_id.clone();
        let binding_ok = match extract_session_id(&ev.frame) {
            Some(acp_id) => matches!(
                self.inner.chats.resolve(&acp_id).await,
                Some(mapped) if mapped == hub_chat_id
            ),
            None => false,
        };
        if !binding_ok {
            // 无帧内 sessionId（或未命中 binding）：JSON-RPC 形态按信封兜底。
            // 官方 session/prompt 终态是 {id, result:{stopReason}}，部分实现
            // 省略 jsonrpc 键；不得按 binding_missing 丢掉，否则 loading 不落。
            let jsonrpc_shape = ev.frame.get("jsonrpc").is_some()
                || crate::protocol::jsonrpc_response_id(&ev.frame).is_some();
            if !jsonrpc_shape {
                let _ = self
                    .observe_non_projected_frame(&hub_chat_id, ev.epoch, ev.seq)
                    .await;
                self.count_dropped("binding_missing");
                return ConsumeResult::Dropped {
                    reason: "binding_missing",
                };
            }
            // 方法面帧（request/notification：官方 request_permission、
            // agent/status 等）进入 chat 作用域投递（register_permission_
            // request / submit），以「信封 chat 存在」为唯一校验——信封是
            // spawn 时确立的进程归属（§4.5.1，客户端不可控）。JSON-RPC
            // response 例外（§4.4 L3 经 pending_rpc 匹配，无 chat 语义，
            // 历史行为保留：不要求信封 chat 登记）。
            if ev.frame.get("method").is_some()
                && self.inner.chats.entry(&hub_chat_id).await.is_none()
            {
                let _ = self
                    .observe_non_projected_frame(&hub_chat_id, ev.epoch, ev.seq)
                    .await;
                self.count_dropped("binding_missing");
                return ConsumeResult::Dropped {
                    reason: "binding_missing",
                };
            }
            // 投递路径与下方 Some 分支合并（不再 normalize("") 兜底）：
            // RpcResponse → confirm_rpc；PermissionRequest →
            // register_permission_request；Event → submit；Dropped → 计数。
        }
        // Peri OAuth is a sensitive, non-projected notification surface. It is
        // accepted only after initialize explicitly echoed the capability and
        // advances the stream watermark without ever entering Yjs or the update sink.
        if ev.frame.get("method").and_then(serde_json::Value::as_str) == Some("peri/oauth") {
            let capability_negotiated = self
                .inner
                .chats
                .supports_extension(&hub_chat_id, PERI_OAUTH_EXTENSION)
                .await;
            if !self
                .observe_non_projected_frame(&hub_chat_id, ev.epoch, ev.seq)
                .await
            {
                self.count_dropped("oauth_stream_rejected");
                return ConsumeResult::Dropped {
                    reason: "oauth_stream_rejected",
                };
            }
            let observed = self
                .inner
                .oauth
                .observe(&hub_chat_id, &ev.frame, capability_negotiated)
                .await;
            return match observed {
                Ok(frame) => ConsumeResult::OAuthStatus {
                    chat_id: hub_chat_id,
                    frame,
                },
                Err(_) => {
                    self.count_dropped("oauth_event_rejected");
                    ConsumeResult::Dropped {
                        reason: "oauth_event_rejected",
                    }
                }
            };
        }
        // 3. 规范化（§6.1）。
        let now = chrono::Utc::now().to_rfc3339();
        match self
            .inner
            .channel
            .normalize(&hub_chat_id, ev.epoch, ev.seq, &now, &ev.frame)
        {
            NormalizeOutcome::Event(nev) => {
                let r = self.submit(&hub_chat_id, *nev).await;
                // 断链追平恢复（§7.3/§8.5）：实时帧投递成功 → 尝试清除
                // 断链置的 gap 标记并恢复 chat 可用。判定（可校准/不可
                // 校准）在 writer 内以聚合器事实源进行——uncalibratable
                // chat 的事件被聚合器拒绝（applied=false），不会误恢复。
                if matches!(r, ConsumeResult::Delivered { applied: true, .. }) {
                    self.recover_from_gap(&hub_chat_id).await;
                }
                r
            }
            // #1 官方 request_permission：登记 pending 表 + 投递投影。
            NormalizeOutcome::PermissionRequest(req) => {
                let r = self
                    .register_permission_request(&hub_chat_id, ev.epoch, ev.seq, &now, &req)
                    .await;
                // 断链追平恢复（评审 P2-2：与 Event 分支 227-229 对称）：
                // 实时帧投递成功 → 尝试清除断链置的 gap 标记并恢复 chat
                // 可用（判定在 writer 内，applied=false 不会误恢复）。
                if matches!(r, ConsumeResult::Delivered { applied: true, .. }) {
                    self.recover_from_gap(&hub_chat_id).await;
                }
                r
            }
            NormalizeOutcome::ElicitationRequest(req) => {
                let r = self
                    .register_elicitation_request(
                        instance_id,
                        &hub_chat_id,
                        ev.epoch,
                        ev.seq,
                        &now,
                        &req,
                    )
                    .await;
                if matches!(r, ConsumeResult::Delivered { applied: true, .. }) {
                    self.recover_from_gap(&hub_chat_id).await;
                }
                r
            }
            NormalizeOutcome::RejectedClientRequest {
                request_id,
                code,
                message,
            } => {
                self.reject_client_request(
                    instance_id,
                    &hub_chat_id,
                    ev.epoch,
                    ev.seq,
                    ClientRequestRejection {
                        request_id,
                        code,
                        message,
                    },
                )
                .await
            }
            NormalizeOutcome::RpcResponse { id, is_error } => {
                if !self
                    .observe_non_projected_frame(&hub_chat_id, ev.epoch, ev.seq)
                    .await
                {
                    self.count_dropped("rpc_response_stream_rejected");
                    return ConsumeResult::Dropped {
                        reason: "rpc_response_stream_rejected",
                    };
                }
                self.confirm_rpc(&id, ev.frame.clone(), is_error).await
            }
            NormalizeOutcome::Dropped(reason) => {
                let _ = self
                    .observe_non_projected_frame(&hub_chat_id, ev.epoch, ev.seq)
                    .await;
                self.count_dropped(reason.as_str());
                ConsumeResult::Dropped {
                    reason: reason.as_str(),
                }
            }
        }
    }

    /// Chat Doc 4KB 会省略工具结果；MCP App 首屏走瞬时缓存（上限与 HTML 同为 1 MiB）。
    pub(super) const MCP_APP_RESULT_MAX_BYTES: usize = 1024 * 1024;

    /// 从 ACP 规范化事件记住完整 CallToolResult（不写 Yjs）。
    pub(super) async fn remember_mcp_app_tool_result(
        &self,
        chat_id: &str,
        tool_call_id: &str,
        result: serde_json::Value,
    ) {
        let wrapped = as_mcp_app_call_tool_result(result);
        let Some(bytes) = serde_json::to_vec(&wrapped).ok().map(|body| body.len()) else {
            tracing::warn!(
                target: "peri_studio::mcp_apps",
                chat_id,
                tool_call_id,
                "mcp app tool result skipped: not serializable"
            );
            return;
        };
        let shape = mcp_app_result_shape(&wrapped);
        if bytes == 0 || bytes > Self::MCP_APP_RESULT_MAX_BYTES {
            tracing::warn!(
                target: "peri_studio::mcp_apps",
                chat_id,
                tool_call_id,
                bytes,
                max = Self::MCP_APP_RESULT_MAX_BYTES,
                has_structured_content = shape.has_structured_content,
                source_chars = shape.source_chars,
                "mcp app tool result skipped: empty or over 1MiB"
            );
            return;
        }
        tracing::info!(
            target: "peri_studio::mcp_apps",
            chat_id,
            tool_call_id,
            bytes,
            has_structured_content = shape.has_structured_content,
            source_chars = shape.source_chars,
            content_blocks = shape.content_blocks,
            "mcp app tool result cached"
        );
        let mut by_chat = self.inner.mcp_app_tool_results.write().await;
        by_chat
            .entry(chat_id.to_string())
            .or_default()
            .insert(tool_call_id.to_string(), wrapped);
    }

    pub(super) async fn remember_mcp_app_tool_input(
        &self,
        chat_id: &str,
        tool_call_id: &str,
        arguments: serde_json::Value,
    ) {
        if !arguments.is_object() {
            return;
        }
        let Some(bytes) = serde_json::to_vec(&arguments).ok().map(|body| body.len()) else {
            return;
        };
        if bytes == 0 || bytes > Self::MCP_APP_RESULT_MAX_BYTES {
            tracing::warn!(
                target: "peri_studio::mcp_apps",
                chat_id,
                tool_call_id,
                bytes,
                "mcp app tool input skipped: empty or over 1MiB"
            );
            return;
        }
        let source_chars = arguments
            .get("source")
            .and_then(serde_json::Value::as_str)
            .map(str::len)
            .unwrap_or(0);
        tracing::info!(
            target: "peri_studio::mcp_apps",
            chat_id,
            tool_call_id,
            bytes,
            source_chars,
            "mcp app tool input cached"
        );
        let mut by_chat = self.inner.mcp_app_tool_inputs.write().await;
        by_chat
            .entry(chat_id.to_string())
            .or_default()
            .insert(tool_call_id.to_string(), arguments);
    }

    pub(super) async fn mcp_app_tool_input(
        &self,
        chat_id: &str,
        tool_call_id: &str,
    ) -> Option<serde_json::Value> {
        self.inner
            .mcp_app_tool_inputs
            .read()
            .await
            .get(chat_id)
            .and_then(|by_tool| by_tool.get(tool_call_id).cloned())
    }

    pub(super) async fn mcp_app_tool_result(
        &self,
        chat_id: &str,
        tool_call_id: &str,
    ) -> Option<serde_json::Value> {
        self.inner
            .mcp_app_tool_results
            .read()
            .await
            .get(chat_id)
            .and_then(|by_tool| by_tool.get(tool_call_id).cloned())
    }

    pub(super) async fn clear_mcp_app_tool_results(&self, chat_id: &str) {
        self.inner
            .mcp_app_tool_results
            .write()
            .await
            .remove(chat_id);
        self.inner.mcp_app_tool_inputs.write().await.remove(chat_id);
    }

    /// Exact, explicit retrieval of the transient authorization URL.
    pub(super) async fn oauth_authorization(
        &self,
        command_id: &str,
        chat_id: &str,
        flow_id: &str,
    ) -> Result<McpOAuthAuthorizationFrame, super::oauth_control::OAuthControlError> {
        self.inner
            .oauth
            .authorization(command_id, chat_id, flow_id)
            .await
    }
}

/// 把 ACP `rawOutput` 收成 App Bridge 需要的 CallToolResult。
/// 已有 `content[]` 则原样保留；否则包一层并把原值放进 `structuredContent`。
pub(super) fn as_mcp_app_call_tool_result(value: serde_json::Value) -> serde_json::Value {
    if value
        .get("content")
        .and_then(|content| content.as_array())
        .is_some()
    {
        return value;
    }
    if value.is_object() {
        return serde_json::json!({
            "content": [{ "type": "text", "text": value.to_string() }],
            "structuredContent": value,
        });
    }
    serde_json::json!({
        "content": [{ "type": "text", "text": value.to_string() }],
    })
}

/// Peri ACP 的 rawOutput 经常只有 `content[]` 文本；canvas 的 TSX 在 arguments.source。
pub(crate) fn merge_mcp_app_tool_result(
    result: Option<serde_json::Value>,
    input: Option<serde_json::Value>,
) -> Option<serde_json::Value> {
    match (result, input) {
        (Some(result), input) => {
            let mut wrapped = as_mcp_app_call_tool_result(result);
            if wrapped.get("structuredContent").is_none() {
                if let Some(input) = input.filter(|value| value.is_object()) {
                    wrapped["structuredContent"] = input;
                }
            }
            Some(wrapped)
        }
        (None, Some(input)) if input.is_object() => Some(as_mcp_app_call_tool_result(input)),
        _ => None,
    }
}

struct McpAppResultShape {
    has_structured_content: bool,
    source_chars: usize,
    content_blocks: usize,
}

fn mcp_app_result_shape(value: &serde_json::Value) -> McpAppResultShape {
    let source_chars = value
        .pointer("/structuredContent/source")
        .and_then(serde_json::Value::as_str)
        .map(str::len)
        .unwrap_or(0);
    McpAppResultShape {
        has_structured_content: value.get("structuredContent").is_some(),
        source_chars,
        content_blocks: value
            .get("content")
            .and_then(serde_json::Value::as_array)
            .map(Vec::len)
            .unwrap_or(0),
    }
}

#[cfg(test)]
#[path = "relay_event_handler_test.rs"]
mod relay_event_handler_test;

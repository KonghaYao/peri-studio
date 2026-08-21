//! CommandCoordinator：每 chat 串行命令队列 + commandId 去重 + 两阶段 Ack
//! （架构 §4.3/§4.4/§7.4）。
//!
//! **核心纪律**（§7.4 规则 6 + §4.4）：commandId 去重检查、入队上限检查与
//! `in_flight` 标记必须在**同一临界区**完成（Rust 无 JS 单线程原子性）——
//! 本模块以 `tokio::sync::Mutex<()>` 包住「outbox 去重判定 → try_reserve →
//! outbox.insert」三连；去重记录持久化到 outbox（F3，跨 server 重启有效）。
//!
//! 提交点顺序（§4.4/§6.2 prompt 路径，由执行器保证）：
//! `pending user entry → intent_durable → dispatch barrier → forward_rpc →
//! dispatched → L3（JSON-RPC response 匹配 rpcId）→ delivery_confirmed →
//! projection_committed → completed → committed Ack`；无增量窗口耗尽（issue
//! #3：窗口内无事件投递）→ delivery_unknown（路径 B：非幂等禁止自动重发，§4.4）。
//!
//! create 序列由 `RuntimeCreation` 独占：本地 prepare → durable spawn barrier →
//! spawn/initialize → session/load 或 session/new → bind/project → committed。
//! 只有 ACP side effect 尚未发生且 runtime cleanup 得到精确 Ack 时才允许安全重试；
//! session/new 或 transport Ack 的不确定窗口一律 `DELIVERY_UNKNOWN`，禁止自动重发。
//!
//! **结构拆分**（review #3，行为语义不变）：本文件收敛为类型定义、常量与
//! submit 入口路由（`CoordInner` 字段经 `pub(super)` 在 channel 模块内共享）；
//! 实现段按职责拆出——`coordinator_assembly`（new/with_l3_timeout 装配）、
//! `management_actions`（直通管理面）、`queued_submission`（队列面提交与
//! per-chat 执行器）、`queued_actions`（队列面 exec 族）、`session_actions`
//! （chat/load 与 session/new）、`terminal_io`（终态输出）、`coordinator_helpers`
//! （纯函数）。
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, Mutex, RwLock};

use peri_studio_proto::ack::{ActionAck, ActionError, ErrorCode};
use peri_studio_proto::action::ActionEnvelope;

use crate::auth::ConnectionCtx;
use crate::channel::broadcaster::OutboundMsg;
use crate::channel::command_outcome_broker::CommandOutcomeBroker;
// 纯函数 helpers 拆出到 coordinator_helpers 后，经此处 re-export 保持
// `command_coordinator::{action_error, extract_command_id}` 的既有引用路径
// （chat_channel/gateway/metadata_*/runtime_creation 等仍按旧路径引用）。
pub(super) use crate::channel::coordinator_helpers::{action_error, extract_command_id};
use crate::channel::elicitation_response::ElicitationResponse;
use crate::channel::mcp_control::McpControl;
use crate::channel::metadata_command_processor::MetadataCommandProcessor;
use crate::channel::permission_resolution::PermissionResolution;
use crate::channel::prompt_delivery::PromptDelivery;
use crate::channel::runtime_closure::RuntimeClosure;
use crate::channel::runtime_creation::RuntimeCreation;
use crate::channel::session_catalog_sync::SessionCatalogSync;
use crate::channel::session_configuration::SessionConfiguration;
use crate::channel::session_discovery::SessionDiscovery;
use crate::channel::session_rewind::{SessionRewindExecution, SessionRewindQueries};
use crate::channel::session_runtime_operations::SessionRuntimeOperations;
use crate::channel::turn_cancellation::TurnCancellation;
use crate::channel::workspace_compatibility::WorkspaceCompatibility;
use crate::control::ProjectService;
use crate::persist::Store;
use crate::state::doc_manager::DocManager;

/// 默认 ACP 启动命令（架构 §11「默认 `peri acp`，可配置」；M1 起经
/// `Config::acp_cmd` 可配——config.toml `acp_cmd` 数组或
/// `PERI_STUDIO_ACP_CMD` 空格拆分，见 `crate::config`）。
pub use crate::config::DEFAULT_ACP_CMD;

/// L3 确认超时（§4.4 路径 B：issue #3 增量窗口——窗口内该 chat 无事件投递
/// → delivery_unknown；默认 30s，测试注入短值）【决策：设计稿 §16 测试 13
/// 的 30s 常量，非 §16 配置表项】。
pub const L3_TIMEOUT: Duration = Duration::from_secs(30);

/// session/list 轮询间隔（§6.3：10s 全量同步；幂等，响应中不存在的旧条目
/// 删除——自愈）。
pub const SESSION_POLL_INTERVAL: Duration = Duration::from_secs(10);

/// session/list 单次请求超时（§6.3；超过即放弃本轮，下轮重试）。
pub const SESSION_POLL_TIMEOUT: Duration = Duration::from_secs(10);

/// 提交结果（同步返回的部分）：accepted 立即；终态经连接发送队列。
#[derive(Debug, Clone, PartialEq)]
pub enum SubmitAck {
    /// 已入队（accepted，§4.4：只表示进入有界处理队列）。
    Accepted { command_id: String },
    /// 已提交命令重发（§4.4）：duplicate + 原 turnId，**不重复调用 Agent**。
    Duplicate(ActionAck),
    /// 同步失败（RATE_LIMITED/CHAT_NOT_FOUND/INVALID_STATE…）→ action_error。
    Failed(ActionError),
    /// Coordinator wrote accepted and terminal frames through the same queue.
    Handled,
}

/// 执行器命令（submit 入队载荷；终态经 `tx` 回客户端连接）。
#[derive(Debug, Clone)]
pub struct ExecCmd {
    /// 客户端连接上下文（审计）。
    pub ctx: ConnectionCtx,
    /// hub 侧 chat_id（create：submit 时生成的新 id）。
    pub chat_id: String,
    /// 原始 Action。
    pub action: ActionEnvelope,
    /// 客户端连接发送队列（committed/error 回投）。
    pub tx: mpsc::Sender<OutboundMsg>,
}

/// 每 chat 串行命令队列（上限 64，§7.4 规则 1）+ commandId 去重（§4.4）。
#[derive(Clone)]
pub struct CommandCoordinator {
    /// 内部状态；`pub(super)` 供 channel 模块内各实现段文件访问
    /// （结构拆分，行为语义不变）。
    pub(super) inner: Arc<CoordInner>,
}

/// 内部状态（结构拆分后经 `pub(super)` 在 channel 模块内共享——各实现段
/// 文件直接读写字段；Rust 可见性仅限本模块树，不构成对外 API）。
pub(super) struct CoordInner {
    /// 去重 + 入队 + in_flight 同一临界区（§7.4 规则 6；tokio Mutex 可跨 await）。
    pub(super) gate: Mutex<()>,
    pub(super) store: Arc<Store>,
    pub(super) doc: Arc<DocManager>,
    /// Legacy workspace wire compatibility over the project authority.
    pub(super) workspace_compatibility: WorkspaceCompatibility,
    pub(super) queue_cap: usize,
    /// 每 chat 执行器（串行消费；lazy spawn）。
    pub(super) executors: RwLock<HashMap<String, mpsc::Sender<ExecCmd>>>,
    /// Existing-runtime load/new owns its shared per-chat lease and replay order.
    pub(super) session_operations: SessionRuntimeOperations,
    /// Permission decisions own durable recovery, CAS and no-redelivery
    /// semantics behind one lifecycle interface.
    pub(super) permission_resolution: PermissionResolution,
    pub(super) elicitation_response: ElicitationResponse,
    /// Runtime close owns idempotent kill, projection, closed marker and
    /// durable terminal repair behind one lifecycle interface.
    pub(super) runtime_closure: RuntimeClosure,
    /// Cancel owns the writer acknowledgement, no-redelivery barrier and
    /// terminal turn projection behind one lifecycle interface.
    pub(super) turn_cancellation: TurnCancellation,
    /// Prompt delivery owns the cross-store body, dispatch, L3 and terminal
    /// state machine behind one return-value interface.
    pub(super) prompt_delivery: PromptDelivery,
    /// Runtime create owns exact cleanup proof and no-redelivery adjudication.
    pub(super) runtime_creation: RuntimeCreation,
    /// Project/session metadata commands own validation, durable command
    /// phases, Registry projection barriers and runtime activation.
    pub(super) metadata_commands: MetadataCommandProcessor,
    /// Project-scoped discovery owns single-flight and private ACP lifecycle.
    pub(super) session_discovery: SessionDiscovery,
    /// Interactive and background ACP session catalog reads share one
    /// transport, decoration and projection owner.
    pub(super) session_catalog: SessionCatalogSync,
    pub(super) session_configuration: SessionConfiguration,
    pub(super) session_rewind: SessionRewindQueries,
    pub(super) rewind_execution: SessionRewindExecution,
    pub(super) mcp_control: McpControl,
    pub(super) projects: Arc<RwLock<Option<ProjectService>>>,
    pub(super) history_sink: RwLock<Option<Arc<crate::control::StoreSink>>>,
    /// One owner for durable outcome replay, reconnect observers and the
    /// process-local fallback used when terminal persistence itself fails.
    pub(super) outcome_broker: CommandOutcomeBroker,
}

impl CommandCoordinator {
    /// 提交入口（§7.4 规则 6）：三条面——metadata 直通（独立子系统）、
    /// 管理面直通（`submit_management_action`）、队列面
    /// （`submit_queued_action`：临界区内 去重判定 → try_reserve → 入队）。
    ///
    /// `tx` 为客户端连接发送队列（执行器终态回投）。
    pub async fn submit(
        &self,
        ctx: &ConnectionCtx,
        action: ActionEnvelope,
        tx: mpsc::Sender<OutboundMsg>,
    ) -> SubmitAck {
        // metadata 直通面（独立子系统，review #9）：project/session 元数据
        // 命令自带完整提交序列（校验 → payload_hash → BeginCommand 去重 →
        // accepted ack → 按 action 分发），不经 chat 队列。
        if matches!(
            action,
            ActionEnvelope::ProjectCreate { .. }
                | ActionEnvelope::ProjectArchive { .. }
                | ActionEnvelope::ProjectRestore { .. }
                | ActionEnvelope::ProjectRename { .. }
                | ActionEnvelope::PersistedSessionCreate { .. }
                | ActionEnvelope::PersistedSessionOpen { .. }
                | ActionEnvelope::PersistedSessionRename { .. }
                | ActionEnvelope::PersistedSessionArchive { .. }
                | ActionEnvelope::PersistedSessionRestore { .. }
                | ActionEnvelope::PersistedSessionImport { .. }
        ) {
            return self
                .inner
                .metadata_commands
                .submit(self.clone(), ctx, action, tx)
                .await;
        }

        // commandId（幂等键，uuid 形态，§4.3）。仅校验形态；Uuid 解析
        // 在 `submit_queued_action` 内部（create 去重需要），其 expect
        // 依赖本入口保证 uuid 形态。
        let command_id_str = match extract_command_id(&action) {
            Some(c) => c,
            None => {
                return SubmitAck::Failed(action_error(
                    String::new(),
                    ErrorCode::InvalidState,
                    "missing commandId",
                    false,
                ))
            }
        };
        if uuid::Uuid::parse_str(&command_id_str).is_err() {
            return SubmitAck::Failed(action_error(
                command_id_str,
                ErrorCode::InvalidState,
                "invalid commandId (uuid expected)",
                false,
            ));
        }

        // 直通面：workspace/session-list/mcp/config/rewind/prompt-status/
        // discover/load/session-new——低频或只读，不经 chat 队列（管理面）。
        if matches!(
            action,
            ActionEnvelope::WorkspaceCreate { .. }
                | ActionEnvelope::WorkspaceRemove { .. }
                | ActionEnvelope::SessionList { .. }
                | ActionEnvelope::McpList { .. }
                | ActionEnvelope::McpOAuthStart { .. }
                | ActionEnvelope::McpOAuthAuthorization { .. }
                | ActionEnvelope::McpOAuthCancel { .. }
                | ActionEnvelope::ConfigSet { .. }
                | ActionEnvelope::Rewind { .. }
                | ActionEnvelope::RewindCandidates { .. }
                | ActionEnvelope::RewindPreview { .. }
                | ActionEnvelope::PersistedSessionPromptStatus { .. }
                | ActionEnvelope::PersistedSessionDiscover { .. }
                | ActionEnvelope::Load { .. }
                | ActionEnvelope::SessionNew { .. }
        ) {
            return self
                .submit_management_action(ctx, action, tx, &command_id_str)
                .await;
        }

        // 队列面（§7.4 规则 6）：临界区内 去重判定 → try_reserve → 入队。
        self.submit_queued_action(ctx, action, tx, &command_id_str)
            .await
    }
}

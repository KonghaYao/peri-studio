//! Doc 写入命令（`doc_manager.rs` 拆分，§8.2 提交点纪律）。
//!
//! 职责边界：[`DocCommand`] 命令面（chat 维度命令 + Registry 系命令）与
//! [`DocCommand::is_registry`] 路由判定（§8.5【决策】Registry Doc 无 chat
//! 维度，命令路由到全局 registry 写者）。
//!
//! 拆分动机（结构拆分，行为不变）：原 `doc_manager.rs` 2014 行超限，按主题
//! 拆分——命令面（本文件）、API 面（`doc_manager.rs`）、写者循环与 persist
//! 提交（`doc_manager_persist.rs`）、事件/命令应用（`doc_manager_apply_*`）。

use peri_studio_proto::schema::{
    ChatStatus, ChatSummary, SessionConfigOptionProjection,
    SessionSummaryProjection, TurnStatus, WorkspaceSummary,
};
use peri_studio_proto::schema::{InstanceStatus};

#[derive(Debug, Clone, PartialEq)]
pub enum DocCommand {
    /// Advance the instance transport stream for a frame that has no Yjs
    /// projection (currently a JSON-RPC response). Instance sequence numbers
    /// cover every child frame, so skipping these would manufacture a gap when
    /// the next projectable event arrives.
    ObserveStreamFrame {
        epoch: u64,
        seq: u64,
    },
    /// 服务端单写用户消息注册（§6.5；幂等：同 turn_id 跳过）。
    RegisterUserEntry {
        turn_id: String,
        entry_id: String,
        text: String,
        author_user_id: Option<String>,
        source_command_id: String,
        created_at: String,
    },
    /// prompt-delivery-v2 authoritative body projection. This durable Pending
    /// entry is written before the external dispatch barrier and keyed by the
    /// same command identity/fingerprint as the outbox.
    RegisterPendingPromptEntry {
        turn_id: String,
        entry_id: String,
        text: String,
        author_user_id: Option<String>,
        source_command_id: String,
        payload_fingerprint: String,
        created_at: String,
    },
    /// Update delivery evidence on the same Hub-owned user entry without
    /// conflating delivery verdict with the turn/assistant state machine.
    SetPromptEntryDelivery {
        entry_id: String,
        delivery_state: String,
        delivery_error_code: Option<String>,
        completed_at: Option<String>,
    },
    /// 权限 CAS：resolve（pending → resolved 原子一次；§7.4 规则 4）。
    ResolvePermission {
        permission_id: String,
        decision: peri_studio_proto::action::PermissionDecision,
    },
    /// 权限 CAS：expire（pending → expired；定时器路径，§4.7）。
    ExpirePermission {
        permission_id: String,
    },
    /// 断链清理：该 chat 全部 pending 权限批量 expired（§7.1；对齐参考实现
    /// `expireTurnPermissions`——断链即会话失效，未决议权限全部过期）。
    ExpirePendingPermissions,
    /// Persist a bounded typed ACP form request.
    RegisterElicitation {
        elicitation: peri_studio_proto::schema::ElicitationProjection,
        epoch: u64,
        seq: u64,
    },
    /// CAS pending → responding; the response action becomes immutable.
    BeginElicitationResponse {
        elicitation_id: String,
        action: peri_studio_proto::action::ElicitationResponseAction,
        updated_at: String,
    },
    /// Mark the response delivered after instance writer confirmation.
    CompleteElicitationResponse {
        elicitation_id: String,
        updated_at: String,
    },
    /// Runtime disconnect/reset expires pending and responding forms.
    ExpirePendingElicitations {
        updated_at: String,
    },
    /// 断链 → 活动 turn 置 interrupted（§7.3 分区恢复；turn 级终态）。
    MarkTurnInterrupted {
        turn_id: String,
    },
    /// cancel 前置：活动 turn 置 cancelling（§7.2 状态机参考语义：取消请求
    /// 发出即进入取消中；终态由 agent 的 interrupted 事件或控制面注入的
    /// Cancelled 覆盖）。
    MarkTurnCancelling {
        turn_id: String,
    },
    /// 控制面 turn 终态（§7.2）：active_turn 匹配且非终态 → 终态迁移 +
    /// assistant entry 迁移。等价聚合器 TurnTerminal 事件分支，但走控制面
    /// （不经聚合器 seq 水位——宿主注入无 instance 流 seq）。
    SetTurnTerminal {
        turn_id: String,
        status: TurnStatus,
        completed_at: String,
    },
    /// 标题更新（§7.4 规则 5：可独立排队，仍经服务端命令写入）。
    UpdateTitle {
        title: String,
    },
    /// `session/load` 回放开始（§8.5 显式重建）：置聚合器回放模式
    /// （历史 chunk 无 turn_id，按回放序归位）。须先于回放通知进入
    /// writer 队列（coordinator 在 forward_rpc 后立即提交）。
    BeginLoadReplay {
        acp_session_id: String,
    },
    /// agent 投影的 acp_session_id 更新（§5.4 agent map；参考实现 load/resume
    /// 成功路径 `registry.forEachByRcsSession` 更新 acpSessionId 的等价物）。
    /// 用途：create 的 session/new 绑定建立后写入；load 失败恢复路径写回旧值。
    SetAgentSessionId {
        acp_session_id: String,
    },
    /// agent 投影的 model/effort 更新（§5.4 agent map；部分更新语义——
    /// None 不覆盖）。来源：session/new 响应体 configOptions 提取
    /// （handle_new 不发 config_option_update 通知，响应即唯一路径；
    /// load 路径由通知送达，本命令幂等补写）。
    SetAgentConfig {
        model: Option<String>,
        effort: Option<String>,
        config_options: Option<Vec<SessionConfigOptionProjection>>,
    },
    /// ACP initialize negotiation result. This is deliberately separate from
    /// the available-command projection historically named `capabilities`.
    SetAgentExtensions {
        extensions: Vec<String>,
    },
    /// 断链追平恢复（§7.3/§8.5）：relay 在补推/实时帧恢复投递成功后提交。
    /// writer 以聚合器事实源判定——**可校准**（非 uncalibratable）→ 置
    /// `gap_dirty` 触发上报（registry gap 清除 + degraded 条件解除）；
    /// **不可校准**（epoch 变化，§4.5.1）→ 拒绝（保持 gap，只能经
    /// `session/load` 显式重建消除——不得把不可校准 chat 误标为已追平）。
    /// 调用方（relay）以 Applied 为信号迁移 ChatState Gap → Accepting。
    ResumeAfterGap,
    /// `session/load` 回放结束（§8.5）：回放 turn 置终态（completed），
    /// 退出回放模式。load 响应（L3）到达后提交——回放通知先于响应，
    /// writer 串行队列保证顺序。
    EndLoadReplay,
    /// 旧 turn 未完成时新 prompt 的裁决（§6.4：旧 assistant entry 置 cancelled，
    /// 不发 ACP cancel）。
    CancelStaleAssistantEntry {
        turn_id: String,
        entry_id: String,
    },
    /// chat 级终态（ended/closed/crashed，§7.3）写视图。
    SetChatTerminal {
        status: ChatStatus,
    },
    /// Registry：活跃 chat 摘要 upsert/移除/gap 同步（§12.4）。
    RegistryUpsertChat(ChatSummary),
    RegistryRemoveChat {
        chat_id: String,
    },
    /// Registry：instance 视图与全局状态（§12.4/§12.5）。
    RegistryUpsertInstance(peri_studio_proto::schema::InstanceView),
    RegistrySetInstanceState {
        instance_id: String,
        status: InstanceStatus,
    },
    RegistrySetGlobal {
        status: peri_studio_proto::schema::GlobalStatus,
    },
    /// Registry：ACP `session/list` 响应全量同步投影（§6.3：幂等，10s 轮询；
    /// 响应中不存在的旧条目删除——自愈）。sessions 是 **instance 级数据**
    /// （agent 磁盘历史），投影到全局 Registry Doc——不随 chat 销毁/重建，
    /// 切换对话列表持续可用。走控制面（不经聚合器 seq 水位——宿主注入
    /// 无 instance 流 seq，`SetTurnTerminal` 同源）。
    RegistryApplySessions {
        entries: Vec<SessionSummaryProjection>,
    },
    /// Registry：工作区摘要 upsert/移除（独立于 chat 的上层概念：定义本地
    /// 目录 cwd，其下新建对话继承；Registry Doc `workspaces` map）。
    RegistryUpsertWorkspace(WorkspaceSummary),
    RegistryRemoveWorkspace {
        workspace_id: String,
    },
    RegistryReplaceProjects {
        projects: Vec<peri_studio_proto::schema::ProjectSummary>,
        sessions: Vec<peri_studio_proto::schema::ProjectSessionSummary>,
    },
}

impl DocCommand {
    /// 是否为 Registry 系命令（路由到全局 registry 写者，§8.5【决策】）。
    pub(crate) fn is_registry(&self) -> bool {
        matches!(
            self,
            DocCommand::RegistryUpsertChat(_)
                | DocCommand::RegistryRemoveChat { .. }
                | DocCommand::RegistryUpsertInstance(_)
                | DocCommand::RegistrySetInstanceState { .. }
                | DocCommand::RegistrySetGlobal { .. }
                | DocCommand::RegistryApplySessions { .. }
                | DocCommand::RegistryUpsertWorkspace(_)
                | DocCommand::RegistryRemoveWorkspace { .. }
                | DocCommand::RegistryReplaceProjects { .. }
        )
    }
}

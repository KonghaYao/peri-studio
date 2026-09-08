//! command outbox（§4.4/§5）：commandId 去重账本 + 状态机迁移 API。
//!
//! 无状态投影重构后为**纯内存**实现（`docs/design/
//! peri-studio-stateless-projections.md`）：`outbox.log` 追加日志、重放、物理
//! 压缩、保留期清理与损坏处理已全部删除。server 重启后 outbox 即为空——
//! 命令**从不重新发送**，"以 ACP 现场为准"（客户端手动重试 prompt 可能
//! 重复执行的边缘风险为已接受决策）。
//!
//! 状态机迁移表（设计稿 §5.2；非法迁移一律 [`StoreError::InvalidTransition`]
//! 拒绝并 `tracing::warn`，不静默）：
//!
//! | from | to | 触发方 |
//! |------|-----|--------|
//! | received | accepted | coordinator 入队（两阶段 Ack 之 accepted） |
//! | accepted | intent_durable | 意图落盘（§4.4 提交点纪律第一步） |
//! | intent_durable | dispatched | 下发 instance（置 `dispatched_at`） |
//! | intent_durable | （清除） | retryable 失败（§4.4：清除允许重发） |
//! | received / accepted / intent_durable | failed | 非 retryable 失败 |
//! | dispatched | delivery_confirmed | L1+L2 达成（M1 合并） |
//! | dispatched | delivery_unknown | L2 后 L3 不可得（M1 路径 B，§5.3） |
//! | delivery_confirmed | projection_committed | 投影 update 落盘后 |
//! | delivery_confirmed | failed | 业务失败（客户端收 action_error） |
//! | projection_committed | completed | committed Ack 返回（终态） |
//! | delivery_unknown | completed | 人工裁决「确认已送达」（§5.3 runbook） |
//! | delivery_unknown | （清除） | 人工裁决「确认未送达」 |
//! | delivery_unknown | delivery_unknown | 裁决「仍未知」（幂等，重载不推进） |
//!
//! **H1 裁决**（主管补充，设计稿缺口）：投递后（dispatched 及之后）收到
//! **retryable** 失败 → 状态**回退**到 `intent_durable`（记录保留、去重索引
//! 不删、`dispatched_at` 清除、状态标记可重发）；非 retryable 失败 →
//! `failed`。retryable 分类以架构 §4.4 为准（`AGENT_UNAVAILABLE` /
//! `INSTANCE_OFFLINE`）。投递前（received/accepted/intent_durable）的
//! retryable 失败 → 清除（允许重发重新执行，设计稿 §5.2 原语义）。

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tracing::warn;

use uuid::Uuid;

use peri_studio_proto::action::PermissionDecision;

use crate::persist::StoreError;

/// 命令类型（§4.8 M1 五种；JSON 形态与 proto action `type` 对应）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandType {
    /// `chat/create`（以 chat_id 为天然幂等键，§4.5）。
    #[serde(rename = "chat/create")]
    Create,
    /// `chat/prompt`（非幂等，禁止盲重试）。
    #[serde(rename = "chat/prompt")]
    Prompt,
    /// `chat/cancel`（非幂等）。
    #[serde(rename = "chat/cancel")]
    Cancel,
    /// `chat/close`（以 chat_id 为天然幂等键）。
    #[serde(rename = "chat/close")]
    Close,
    /// `permission/resolve`（非幂等）。
    #[serde(rename = "permission/resolve")]
    Resolve,
    /// `elicitation/respond`（非幂等 agent→client request response）。
    #[serde(rename = "elicitation/respond")]
    ElicitationRespond,
    /// `question/respond`（非幂等 control_response 路径）。
    #[serde(rename = "question/respond")]
    QuestionRespond,
}

impl CommandType {
    /// 命令固有幂等性分类（§5.2 分类表）：close → SafeToRedeliver；
    /// create/prompt/cancel/resolve → NoAutoRedeliver。create 的 spawn 对同一
    /// chat id 幂等，但客户端重试会先生成新 chat id，因此必须由 create
    /// lifecycle 在确认旧 runtime 已清理后显式解除 barrier。
    pub fn default_retryable_class(self) -> RetryableClass {
        match self {
            CommandType::Close => RetryableClass::SafeToRedeliver,
            CommandType::Create
            | CommandType::Prompt
            | CommandType::Cancel
            | CommandType::Resolve
            | CommandType::ElicitationRespond
            | CommandType::QuestionRespond => RetryableClass::NoAutoRedeliver,
        }
    }
}

/// 命令固有幂等性分类（§4.4 顾问3）：进入 outbox 前必须显式分类，未分类
/// 默认 [`RetryableClass::NoAutoRedeliver`]。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RetryableClass {
    /// 可安全重发（以 chat_id 等为天然幂等键），但 lifecycle/startup
    /// recovery 必须先持久化 retire 旧记录；extant `delivery_unknown`
    /// 本身不授予新 executor ownership。
    SafeToRedeliver,
    /// 禁止自动重发（非幂等，路径 B：仅可对账/人工裁决后重发，§5.3）。
    NoAutoRedeliver,
}

/// outbox 状态机状态（§5.1/§5.2）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutboxStatus {
    /// 已入队（两阶段 Ack 之 accepted）。
    Received,
    /// 已 accepted。
    Accepted,
    /// 意图已记录（§4.4 提交点纪律第一步）。
    IntentDurable,
    /// 已下发 instance（置 `dispatched_at`）。
    Dispatched,
    /// L1+L2 达成（M1 合并，§4.4）。
    DeliveryConfirmed,
    /// 投影 update 已投递（内存镜像 + 广播，无落盘）。
    ProjectionCommitted,
    /// committed Ack 已返回（终态）。
    Completed,
    /// 非 retryable 失败（终态）。
    Failed,
    /// L2 后 L3 不可得（M1 路径 B，§5.3）。
    DeliveryUnknown,
}

impl OutboxStatus {
    /// 是否为终态（completed/failed；清理策略与归档前置条件检查用，§5.5）。
    pub fn is_terminal(self) -> bool {
        matches!(self, OutboxStatus::Completed | OutboxStatus::Failed)
    }
}

impl std::fmt::Display for OutboxStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            OutboxStatus::Received => "received",
            OutboxStatus::Accepted => "accepted",
            OutboxStatus::IntentDurable => "intent_durable",
            OutboxStatus::Dispatched => "dispatched",
            OutboxStatus::DeliveryConfirmed => "delivery_confirmed",
            OutboxStatus::ProjectionCommitted => "projection_committed",
            OutboxStatus::Completed => "completed",
            OutboxStatus::Failed => "failed",
            OutboxStatus::DeliveryUnknown => "delivery_unknown",
        };
        f.write_str(s)
    }
}

/// 最近一次失败（`delivery_unknown` 对账展示，§4.4）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastError {
    /// 稳定错误码（§4.4，如 `AGENT_UNAVAILABLE`；脱敏）。
    pub code: String,
    /// 是否 retryable（架构 §4.4 分类：`AGENT_UNAVAILABLE`/`INSTANCE_OFFLINE`）。
    pub retryable: bool,
    /// 失败时刻（server 时钟，§4.7）。
    pub at: DateTime<Utc>,
}

impl LastError {
    /// 由 proto 稳定错误码构造（retryable 分类事实源：
    /// [`ErrorCode::default_retryable`]）。
    pub fn from_error_code(code: peri_studio_proto::ack::ErrorCode) -> Self {
        LastError {
            code: serde_json::to_value(code)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_else(|| format!("{code:?}")),
            retryable: code.default_retryable(),
            at: Utc::now(),
        }
    }
}

/// outbox 记录（§5.1；JSON 字段与 §4.4 `commandId → {type, turnId, status,
/// dispatched_at}` 一一对应 + 补充字段）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxRecord {
    /// 命令 id（幂等键，同 chat 唯一）。
    pub command_id: Uuid,
    /// 所属 chat。
    pub chat_id: Uuid,
    /// 命令类型。
    pub command_type: CommandType,
    /// turn id（server 生成；同 commandId 重试复用，§4.4）。
    pub turn_id: Option<Uuid>,
    /// 当前状态。
    pub status: OutboxStatus,
    /// 命令固有幂等性分类（§4.4 顾问3）。
    pub retryable_class: RetryableClass,
    /// 下发时刻（`dispatched` 后非 None）。
    pub dispatched_at: Option<DateTime<Utc>>,
    /// 创建时刻（server 时钟，§4.7）。
    pub created_at: DateTime<Utc>,
    /// 最近迁移时刻。
    pub updated_at: DateTime<Utc>,
    /// 最近失败（回退/重试展示）。
    pub last_error: Option<LastError>,
    /// 投递尝试次数（§17.1 指标；每次进入 `dispatched` +1）。
    pub attempt_count: u32,
    /// Hub prompt delivery contract version. `None` identifies legacy records
    /// whose pre-ack `intent_durable` state cannot prove that ACP was untouched.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_protocol_version: Option<u16>,
    /// SHA-256 of the canonical typed prompt payload. This is equality evidence
    /// only; user message text must never be copied into the outbox.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload_fingerprint: Option<String>,
    /// Durable no-redelivery barrier. When present, an ACP dispatch may have
    /// begun even while `status` is still `intent_durable`; any ambiguous
    /// outcome must converge to `delivery_unknown`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dispatch_barrier_at: Option<DateTime<Utc>>,
    /// 非幂等命令在明确未投递时安全恢复所需的最小证据。
    /// 可选以保持旧 outbox 记录的向后兼容。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery: Option<Box<CommandRecovery>>,
}

/// 按命令类型封闭的恢复证据。不得存放 bearer token、Cookie 或
/// 用户消息正文。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CommandRecovery {
    /// 官方 ACP `session/request_permission` 的 JSON-RPC response 回投材料。
    PermissionResponse {
        /// server 生成的权限投影身份。
        permission_id: String,
        /// agent request id，响应必须原样回显。
        request_id: serde_json::Value,
        /// ACP 官方 options，用于将 Allow/Deny 映射回 optionId。
        options: Vec<serde_json::Value>,
        /// 首次裁决；必须与重试 action 完全一致。
        decision: PermissionDecision,
        /// 首次裁决精确选择的 ACP optionId；旧记录可能缺失。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        option_id: Option<String>,
    },
    /// Body-free evidence for an ACP `elicitation/create` response.
    ElicitationResponse {
        elicitation_id: String,
        request_id: serde_json::Value,
        response_fingerprint: String,
    },
}

/// 新记录（[`OutboxStore::insert`] 入参 → Received）。
#[derive(Debug, Clone)]
pub struct NewOutboxRecord {
    /// 命令 id。
    pub command_id: Uuid,
    /// 所属 chat。
    pub chat_id: Uuid,
    /// 命令类型。
    pub command_type: CommandType,
    /// turn id（可选，§4.4：重试复用同一 turnId）。
    pub turn_id: Option<Uuid>,
    /// 幂等性分类（未显式分类默认 NoAutoRedeliver，§4.4 顾问3）。
    pub retryable_class: RetryableClass,
}

/// delivery_unknown 人工裁决（§5.3 runbook；权限与依据属 control 层）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryVerdict {
    /// 确认已送达 → completed。
    ConfirmedDelivered,
    /// 确认未送达 → tombstone 清除（允许重发）。
    ConfirmedNotDelivered,
    /// 仍未知 → 保持 delivery_unknown（幂等，重载不推进）。
    StillUnknown,
}

/// command outbox 存储（§5）：**内存**去重索引 + 状态机（无落盘）。
///
/// `&mut self` 方法必须在调用方持外层 `tokio::sync::Mutex` 后调用（设计稿
/// §10 并发模型）。
pub struct OutboxStore {
    index: HashMap<Uuid, OutboxRecord>,
}

impl OutboxStore {
    /// 新建空 outbox（内存；server 重启即空，命令从不重新发送）。
    pub fn new() -> Self {
        OutboxStore {
            index: HashMap::new(),
        }
    }
}

impl Default for OutboxStore {
    fn default() -> Self {
        Self::new()
    }
}

// 结构拆分：命令方法 / restart 对账族（含裁决）为同目录实现段。
#[path = "outbox_commands.rs"]
mod outbox_commands;
#[path = "outbox_reconcile.rs"]
mod outbox_reconcile;

impl OutboxStore {
    /// 去重索引查询（重发判定，§4.4/§7 协作表）。
    pub fn get(&self, id: Uuid) -> Option<&OutboxRecord> {
        self.index.get(&id)
    }

    /// 全部记录（清理/归档前置条件检查用，§5.5）。
    pub fn records(&self) -> impl Iterator<Item = &OutboxRecord> {
        self.index.values()
    }

    /// 记录数（归档前置条件「outbox 全终态」检查辅助）。
    pub fn len(&self) -> usize {
        self.index.len()
    }

    /// 索引是否为空。
    pub fn is_empty(&self) -> bool {
        self.index.is_empty()
    }

    /// 记录状态迁移落点：更新内存索引（无落盘）。
    fn append_record(&mut self, record: &OutboxRecord) -> Result<(), StoreError> {
        self.index.insert(record.command_id, record.clone());
        Ok(())
    }

    /// 清除记录（§5.1 删除语义）：索引删除（无落盘 tombstone）。
    fn tombstone(&mut self, id: Uuid) -> Result<(), StoreError> {
        self.index.remove(&id);
        Ok(())
    }

    /// 合法迁移执行：校验 + 追加记录 + 更新内存索引（纯内存，无落盘）。
    fn transition(
        &mut self,
        id: Uuid,
        to: OutboxStatus,
        mutate: impl FnOnce(&mut OutboxRecord),
    ) -> Result<(), StoreError> {
        let mut record = self
            .index
            .get(&id)
            .cloned()
            .ok_or_else(|| self.not_found(id))?;
        let from = record.status;
        if !allowed_transition(from, to) {
            return self.reject(id, from, to);
        }
        record.status = to;
        record.updated_at = Utc::now();
        mutate(&mut record);
        self.append_record(&record)
    }

    /// 非法迁移：`InvalidTransition` 拒绝（不修改状态，§5.2 不静默）。
    fn reject(&self, id: Uuid, from: OutboxStatus, to: OutboxStatus) -> Result<(), StoreError> {
        warn!(
            command_id = %id, from = ?from, to = ?to,
            "invalid outbox transition rejected"
        );
        Err(StoreError::InvalidTransition {
            command_id: id,
            from,
            to,
        })
    }

    /// 记录不存在错误。
    fn not_found(&self, id: Uuid) -> StoreError {
        StoreError::CommandNotFound { command_id: id }
    }
}

/// 状态机合法迁移表（§5.2 表 + H1 裁决回退路径经 [`OutboxStore::mark_failed`]
/// 单独处理，不在此表）。
fn allowed_transition(from: OutboxStatus, to: OutboxStatus) -> bool {
    use OutboxStatus::*;
    matches!(
        (from, to),
        (Received, Accepted)
            | (Received, Failed)
            | (Accepted, IntentDurable)
            | (Accepted, Failed)
            | (IntentDurable, Dispatched)
            | (IntentDurable, DeliveryUnknown)
            | (IntentDurable, Failed)
            | (Dispatched, DeliveryConfirmed)
            | (Dispatched, DeliveryUnknown)
            | (DeliveryConfirmed, DeliveryUnknown)
            // H1 扩展：投递后非 retryable 失败 → failed（§4.4 重试分类）。
            | (Dispatched, Failed)
            | (DeliveryConfirmed, ProjectionCommitted)
            | (ProjectionCommitted, DeliveryUnknown)
            | (DeliveryConfirmed, Failed)
            | (ProjectionCommitted, Completed)
            // H1 裁决：投影落盘后业务失败（action_error，非 retryable）→
            // failed（终态）；与 mark_failed 注释一致（§4.4 重试分类）。
            | (ProjectionCommitted, Failed)
            | (DeliveryUnknown, Completed)
            | (DeliveryUnknown, DeliveryUnknown)
    )
}

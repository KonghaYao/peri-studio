//! 聚合器写辅助族·目录（`aggregator.rs` 拆分，§5.3/§6.3/§17.2）。
//!
//! 职责边界：agent 计划/活动（[`write_agent_plan`]/[`write_agent_activity`]）、
//! 能力目录（[`write_capabilities`]）、会话元信息（[`write_chat_info`]）与
//! 状态字符串映射（[`chat_status_str`]/[`chat_status_from_str`]/
//! [`turn_status_from_str`]）及公共错误字段写入（[`write_public_error`]）。
//!
//! 拆分动机（结构拆分，行为不变）：原 `aggregator.rs` 2201 行超限，按主题
//! 拆分；写辅助按职责分两文件——本文件为「计划/活动/能力/会话信息」族，
//! `aggregator_write_helpers.rs` 为「状态/配置/预测」族。

use std::collections::{BTreeMap, HashSet};

use yrs::{Array, Map};

use peri_studio_proto::schema::{
    AgentActivityKind, AgentActivityStatus, AgentPlanEntryProjection, ChatStatus, PublicError,
    TurnStatus,
};

use crate::state::view_store::TransactionCtx;

use super::aggregator::AGENT_ACTIVITY_LIMIT;
pub(crate) struct AgentActivityWrite<'a> {
    pub(crate) kind: AgentActivityKind,
    pub(crate) status: AgentActivityStatus,
    pub(crate) correlation_id: Option<&'a str>,
    pub(crate) label: Option<&'a str>,
    pub(crate) is_background: Option<bool>,
    pub(crate) metrics: &'a BTreeMap<String, u64>,
    pub(crate) attributes: &'a BTreeMap<String, String>,
}

pub(crate) fn write_agent_plan(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    entries: &[AgentPlanEntryProjection],
) {
    let agent = root.get_or_init::<_, yrs::MapRef>(txn, "agent");
    let active_form_negotiated = match agent.get(txn, "extensions") {
        Some(yrs::Out::YArray(extensions)) => extensions.iter(txn).any(|value| {
            matches!(
                value,
                yrs::Out::Any(yrs::Any::String(extension))
                    if extension.as_ref() == "peri.planEntryActiveForm"
            )
        }),
        _ => false,
    };
    let plan = agent.get_or_init::<_, yrs::MapRef>(txn, "plan_entries");
    for key in plan.keys(txn).map(str::to_string).collect::<Vec<_>>() {
        plan.remove(txn, &key);
    }
    let order = agent.get_or_init::<_, yrs::ArrayRef>(txn, "plan_order");
    for index in (0..order.len(txn)).rev() {
        order.remove(txn, index);
    }
    for (index, entry) in entries.iter().enumerate() {
        let id = index.to_string();
        let projected = plan.get_or_init::<_, yrs::MapRef>(txn, id.clone());
        projected.insert(txn, "content", entry.content.clone());
        projected.insert(txn, "status", entry.status.as_str());
        write_optional_string(
            txn,
            &projected,
            "active_form",
            active_form_negotiated
                .then_some(entry.active_form.as_deref())
                .flatten(),
        );
        order.push_back(txn, id);
    }
}

/// Project a negotiated, already-normalized Peri activity. The extension check
/// is repeated at the write boundary so malformed or out-of-order transports
/// cannot create a private-capability surface accidentally.
pub(crate) fn write_agent_activity(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    epoch: u64,
    seq: u64,
    observed_at: &str,
    activity: AgentActivityWrite<'_>,
) -> bool {
    let agent = root.get_or_init::<_, yrs::MapRef>(txn, "agent");
    let negotiated = match agent.get(txn, "extensions") {
        Some(yrs::Out::YArray(extensions)) => extensions.iter(txn).any(|value| {
            matches!(
                value,
                yrs::Out::Any(yrs::Any::String(extension))
                    if extension.as_ref() == "peri.agentActivity"
            )
        }),
        _ => false,
    };
    if !negotiated {
        return false;
    }

    let id = activity
        .correlation_id
        .map(|correlation| format!("{}:{correlation}", activity.kind.as_str()))
        .unwrap_or_else(|| format!("event:{epoch}:{seq}"));
    let activities = agent.get_or_init::<_, yrs::MapRef>(txn, "activities");
    let created_at = activities
        .get(txn, &id)
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
        .and_then(|record| record.get(txn, "created_at"))
        .and_then(|value| value.cast::<String>().ok())
        .unwrap_or_else(|| observed_at.to_string());
    let record = activities.get_or_init::<_, yrs::MapRef>(txn, id.clone());
    record.insert(txn, "id", id.clone());
    record.insert(txn, "kind", activity.kind.as_str());
    record.insert(txn, "status", activity.status.as_str());
    write_optional_string(txn, &record, "label", activity.label);
    match activity.is_background {
        Some(value) => record.insert(txn, "is_background", value),
        None => record.insert(txn, "is_background", yrs::Any::Null),
    };
    record.insert(txn, "created_at", created_at);
    record.insert(txn, "updated_at", observed_at.to_string());

    let metrics = record.get_or_init::<_, yrs::MapRef>(txn, "metrics");
    for key in metrics.keys(txn).map(str::to_string).collect::<Vec<_>>() {
        metrics.remove(txn, &key);
    }
    for (key, value) in activity.metrics {
        let value = i64::try_from(*value).expect("activity normalizer bounds metrics to i64");
        metrics.insert(txn, key.clone(), yrs::Any::BigInt(value));
    }
    let attributes = record.get_or_init::<_, yrs::MapRef>(txn, "attributes");
    for key in attributes.keys(txn).map(str::to_string).collect::<Vec<_>>() {
        attributes.remove(txn, &key);
    }
    for (key, value) in activity.attributes {
        attributes.insert(txn, key.clone(), value.clone());
    }

    let order = agent.get_or_init::<_, yrs::ArrayRef>(txn, "activity_order");
    if let Some(index) = order.iter(txn).position(|value| {
        matches!(value, yrs::Out::Any(yrs::Any::String(existing)) if existing.as_ref() == id)
    }) {
        order.remove(txn, index as u32);
    }
    order.push_back(txn, id);
    while order.len(txn) > AGENT_ACTIVITY_LIMIT {
        if let Some(oldest) = order
            .get(txn, 0)
            .and_then(|value| value.cast::<String>().ok())
        {
            activities.remove(txn, &oldest);
        }
        order.remove(txn, 0);
    }
    agent.insert(txn, "last_activity_at", observed_at.to_string());
    true
}

pub(crate) fn write_optional_u32(
    txn: &mut TransactionCtx<'_>,
    map: &yrs::MapRef,
    key: &str,
    value: Option<u32>,
) {
    match value {
        Some(value) => map.insert(txn, key, value),
        None => map.insert(txn, key, yrs::Any::Null),
    };
}

pub(crate) fn write_optional_string(
    txn: &mut TransactionCtx<'_>,
    map: &yrs::MapRef,
    key: &str,
    value: Option<&str>,
) {
    match value {
        Some(value) => map.insert(txn, key, value.to_string()),
        None => map.insert(txn, key, yrs::Any::Null),
    };
}

pub(crate) fn write_capabilities(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    caps: &[String],
    descriptions: &BTreeMap<String, String>,
    skill_names: &[String],
    mcp_skill_names: &[String],
) {
    let agent = root.get_or_init::<_, yrs::MapRef>(txn, "agent");
    // `capabilities` was the historical name for available commands. Keep it
    // as a compatibility mirror while making the domain distinction explicit.
    for key in ["available_commands", "capabilities"] {
        let arr = agent.get_or_init::<_, yrs::ArrayRef>(txn, key);
        let len = arr.len(txn);
        for i in (0..len).rev() {
            arr.remove(txn, i);
        }
        for command in caps {
            arr.push_back(txn, command.clone());
        }
    }

    let local_skill_classification = match agent.get(txn, "extensions") {
        Some(yrs::Out::YArray(extensions)) => extensions.iter(txn).any(|value| {
            matches!(
                value,
                yrs::Out::Any(yrs::Any::String(extension))
                    if extension.as_ref() == "peri.skillNames"
            )
        }),
        _ => false,
    };
    let local_names: HashSet<String> = if local_skill_classification {
        skill_names.iter().map(|name| name.to_lowercase()).collect()
    } else {
        HashSet::new()
    };
    let mcp_names: HashSet<String> = mcp_skill_names
        .iter()
        .map(|name| name.to_lowercase())
        .collect();
    let catalog = agent.get_or_init::<_, yrs::MapRef>(txn, "command_catalog");
    let old_keys: Vec<String> = catalog.keys(txn).map(str::to_string).collect();
    for key in old_keys {
        catalog.remove(txn, &key);
    }
    for command in caps {
        let entry = catalog.insert(txn, command.clone(), yrs::MapPrelim::default());
        entry.insert(txn, "name", command.clone());
        entry.insert(
            txn,
            "description",
            descriptions.get(command).cloned().unwrap_or_default(),
        );
        let lower = command.to_lowercase();
        let kind = if mcp_names.contains(&lower) {
            "mcp_skill"
        } else if local_names.contains(&lower) {
            "skill"
        } else {
            "command"
        };
        entry.insert(txn, "kind", kind);
    }
}

pub(crate) fn write_chat_info(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    title: Option<&str>,
    status: Option<ChatStatus>,
    active_turn_id: Option<&str>,
) {
    // Session Doc 会话面（对齐 Chat/Session 双 Doc）：写入根级 `session` map。
    let sm = root.get_or_init::<_, yrs::MapRef>(txn, "session");
    if let Some(t) = title {
        sm.insert(txn, "title", t.to_string());
    }
    if let Some(s) = status {
        sm.insert(txn, "status", chat_status_str(s));
    }
    if let Some(a) = active_turn_id {
        sm.insert(txn, "active_turn_id", a.to_string());
    }
}

pub(crate) fn write_public_error(txn: &mut TransactionCtx<'_>, map: &yrs::MapRef, e: &PublicError) {
    let em = map.insert(txn, "public_error", yrs::MapPrelim::default());
    em.insert(txn, "code", e.code.clone());
    em.insert(txn, "message", e.message.clone());
}

pub(crate) fn chat_status_str(s: ChatStatus) -> &'static str {
    match s {
        ChatStatus::Accepting => "accepting",
        ChatStatus::Active => "active",
        ChatStatus::Ended => "ended",
        ChatStatus::Closed => "closed",
        ChatStatus::Crashed => "crashed",
    }
}

pub(crate) fn chat_status_from_str(s: &str) -> Option<ChatStatus> {
    match s {
        "accepting" => Some(ChatStatus::Accepting),
        "active" => Some(ChatStatus::Active),
        "ended" => Some(ChatStatus::Ended),
        "closed" => Some(ChatStatus::Closed),
        "crashed" => Some(ChatStatus::Crashed),
        _ => None,
    }
}

pub(crate) fn turn_status_from_str(s: &str) -> TurnStatus {
    match s {
        "accepting" => TurnStatus::Accepting,
        "running" => TurnStatus::Running,
        "awaitingPermission" => TurnStatus::AwaitingPermission,
        "cancelling" => TurnStatus::Cancelling,
        "completed" => TurnStatus::Completed,
        "cancelled" => TurnStatus::Cancelled,
        "interrupted" => TurnStatus::Interrupted,
        "failed" => TurnStatus::Failed,
        _ => TurnStatus::Accepting,
    }
}

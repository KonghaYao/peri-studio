//! 聚合器写辅助族（`aggregator.rs` 拆分，§5.3/§8.5/§9.4）。
//!
//! 职责边界：tool_call 投影辅助（[`default_tool_call`]/[`advance_tool_status`]）、
//! control doc 写辅助（[`write_permission_request`]/[`write_agent_status`]/
//! [`write_agent_config`]/[`write_agent_usage`]）、会话配置目录
//! （[`write_session_config_catalog`]）、回放扩展判定（[`extension_negotiated`]）
//! 与输入预测写入（[`write_input_prediction`]）。
//!
//! 拆分动机（结构拆分，行为不变）：原 `aggregator.rs` 2201 行超限，按主题
//! 拆分；写辅助按职责分两文件——本文件为「状态/配置/预测」族，
//! `aggregator_write_catalog.rs` 为「计划/活动/能力/会话信息」族。

use yrs::{Array, Map, Transact};

use peri_studio_proto::schema::{
    PermissionOptions, PermissionStatus, PublicError, SessionConfigOptionProjection,
    ToolCallProjection, ToolCallStatus,
};

use crate::state::chat_writer;
use crate::state::doc_pair::DocPair;
use crate::state::view_store::TransactionCtx;

use super::aggregator_write_catalog::{
    write_optional_string, write_optional_u32, write_public_error,
};
pub(crate) fn default_tool_call() -> ToolCallProjection {
    ToolCallProjection {
        tool_call_id: String::new(),
        turn_id: String::new(),
        name: String::new(),
        kind: Default::default(),
        status: ToolCallStatus::Pending,
        arguments: None,
        arguments_omitted: None,
        arguments_bytes: None,
        content: None,
        content_omitted: None,
        content_bytes: None,
        locations: None,
        locations_omitted: None,
        locations_bytes: None,
        result: None,
        result_omitted: None,
        result_bytes: None,
        public_error: None,
        permission_id: None,
        started_at: None,
        completed_at: None,
    }
}

pub(crate) fn advance_tool_status(
    current: ToolCallStatus,
    incoming: ToolCallStatus,
    permission_event: bool,
) -> ToolCallStatus {
    if matches!(
        current,
        ToolCallStatus::Completed | ToolCallStatus::Error | ToolCallStatus::Cancelled
    ) {
        return current;
    }
    if current == ToolCallStatus::AwaitingPermission && !permission_event {
        return current;
    }
    if current == ToolCallStatus::Running && incoming == ToolCallStatus::Pending {
        return current;
    }
    incoming
}

// ---------------------------------------------------------------------------
// control 侧写入辅助
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)] // 与 doc_manager 提交面一致：字段摊开的写入原语
pub(crate) fn write_permission_request(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    permission_id: &str,
    turn_id: &str,
    tool_call_id: Option<&str>,
    title: &str,
    description: Option<&str>,
    options: &[PermissionOptions],
    option_ids: Option<&std::collections::BTreeMap<String, String>>,
    tool_input_evidence: Option<(&str, &str)>,
    expires_at: &str,
) {
    let perms = root.get_or_init::<_, yrs::MapRef>(txn, "pending_permissions");
    let pm = perms.get_or_init::<_, yrs::MapRef>(txn, permission_id);
    pm.insert(txn, "permission_id", permission_id.to_string());
    pm.insert(txn, "turn_id", turn_id.to_string());
    match tool_call_id {
        Some(t) => pm.insert(txn, "tool_call_id", t.to_string()),
        None => pm.insert(txn, "tool_call_id", yrs::Any::Null),
    };
    pm.insert(txn, "title", title.to_string());
    match description {
        Some(d) => pm.insert(txn, "description", d.to_string()),
        None => pm.insert(txn, "description", yrs::Any::Null),
    };
    let opts = pm.get_or_init::<_, yrs::ArrayRef>(txn, "options");
    for o in options {
        opts.push_back(txn, crate::state::permission::option_str(*o).to_string());
    }
    if let Some(option_ids) = option_ids {
        let option_ids_map = pm.get_or_init::<_, yrs::MapRef>(txn, "option_ids");
        let stale: Vec<String> = option_ids_map
            .iter(txn)
            .map(|(key, _)| key.to_string())
            .collect();
        for key in stale {
            option_ids_map.remove(txn, key.as_str());
        }
        for (kind, option_id) in option_ids {
            option_ids_map.insert(txn, kind.as_str(), option_id.clone());
        }
    } else {
        pm.remove(txn, "option_ids");
    }
    if let Some((tool_call_id, summary)) = tool_input_evidence {
        pm.insert(txn, "evidence_tool_call_id", tool_call_id.to_string());
        pm.insert(txn, "tool_input_summary", summary.to_string());
    } else {
        pm.remove(txn, "evidence_tool_call_id");
        pm.remove(txn, "tool_input_summary");
    }
    pm.insert(
        txn,
        "status",
        crate::state::permission::permission_status_str(PermissionStatus::Pending),
    );
    pm.insert(txn, "expires_at", expires_at.to_string());
    pm.insert(txn, "decision", yrs::Any::Null);
}

pub(crate) fn write_agent_status(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    status: &str,
    public_error: Option<&PublicError>,
    model: Option<&str>,
    context_window: Option<u32>,
    context_used: Option<u32>,
) {
    let agent = root.get_or_init::<_, yrs::MapRef>(txn, "agent");
    agent.insert(txn, "status", status.to_string());
    match public_error {
        Some(e) => write_public_error(txn, &agent, e),
        None => {
            agent.insert(txn, "public_error", yrs::Any::Null);
        }
    };
    // model/context_window/context_used 部分更新（跨任务契约 §1）：None 不
    // 覆盖既有值（同 SessionInfo 语义）——agent/status 通知可能只带状态。
    if let Some(m) = model {
        agent.insert(txn, "model", m.to_string());
    }
    if let Some(w) = context_window {
        agent.insert(txn, "context_window", w);
    }
    if let Some(u) = context_used {
        agent.insert(txn, "context_used", u);
    }
}

/// agent map 部分更新：model/effort（config_option_update，跨任务契约 §1）；
/// None 不覆盖既有值（同 SessionInfo/write_agent_status 语义）。
pub(crate) fn write_agent_config(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    model: Option<&str>,
    effort: Option<&str>,
    config_options: Option<&[SessionConfigOptionProjection]>,
) {
    let agent = root.get_or_init::<_, yrs::MapRef>(txn, "agent");
    if let Some(m) = model {
        agent.insert(txn, "model", m.to_string());
    }
    if let Some(e) = effort {
        agent.insert(txn, "effort", e.to_string());
    }
    if let Some(options) = config_options {
        write_session_config_catalog(txn, &agent, options);
    }
}

pub(crate) fn write_session_config_catalog(
    txn: &mut TransactionCtx<'_>,
    agent: &yrs::MapRef,
    options: &[SessionConfigOptionProjection],
) {
    let catalog = agent.get_or_init::<_, yrs::MapRef>(txn, "config_options");
    for key in catalog.keys(txn).map(str::to_string).collect::<Vec<_>>() {
        catalog.remove(txn, &key);
    }
    let order = agent.get_or_init::<_, yrs::ArrayRef>(txn, "config_option_order");
    for index in (0..order.len(txn)).rev() {
        order.remove(txn, index);
    }
    for option in options {
        order.push_back(txn, option.id.clone());
        let entry = catalog.insert(txn, option.id.clone(), yrs::MapPrelim::default());
        entry.insert(txn, "id", option.id.clone());
        entry.insert(txn, "name", option.name.clone());
        write_optional_string(txn, &entry, "description", option.description.as_deref());
        write_optional_string(
            txn,
            &entry,
            "category",
            option.category.map(|category| match category {
                peri_studio_proto::schema::SessionConfigCategory::Mode => "mode",
                peri_studio_proto::schema::SessionConfigCategory::Model => "model",
                peri_studio_proto::schema::SessionConfigCategory::ModelConfig => "model_config",
                peri_studio_proto::schema::SessionConfigCategory::ThoughtLevel => "thought_level",
            }),
        );
        entry.insert(txn, "current_value", option.current_value.clone());
        let choices = entry.get_or_init::<_, yrs::MapRef>(txn, "options");
        let choice_order = entry.get_or_init::<_, yrs::ArrayRef>(txn, "option_order");
        for choice in &option.options {
            choice_order.push_back(txn, choice.value.clone());
            let projected = choices.insert(txn, choice.value.clone(), yrs::MapPrelim::default());
            projected.insert(txn, "value", choice.value.clone());
            projected.insert(txn, "name", choice.name.clone());
            write_optional_string(
                txn,
                &projected,
                "description",
                choice.description.as_deref(),
            );
        }
    }
}

/// agent map 快照覆盖：context_window/context_used（usage_update，跨任务
/// 契约 §1：每次 LLM 调用结束发送，全量覆盖）。
pub(crate) struct AgentUsageWrite<'a> {
    pub(crate) context_window: u32,
    pub(crate) context_used: u32,
    pub(crate) input_tokens: Option<u32>,
    pub(crate) output_tokens: Option<u32>,
    pub(crate) cache_creation_tokens: Option<u32>,
    pub(crate) cache_read_tokens: Option<u32>,
    pub(crate) request_id: Option<&'a str>,
    pub(crate) model: Option<&'a str>,
    pub(crate) stop_reason: Option<&'a str>,
}

pub(crate) fn write_agent_usage(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    usage: AgentUsageWrite<'_>,
) {
    let agent = root.get_or_init::<_, yrs::MapRef>(txn, "agent");
    agent.insert(txn, "context_window", usage.context_window);
    agent.insert(txn, "context_used", usage.context_used);
    let latest = agent.get_or_init::<_, yrs::MapRef>(txn, "latest_usage");
    write_optional_u32(txn, &latest, "input_tokens", usage.input_tokens);
    write_optional_u32(txn, &latest, "output_tokens", usage.output_tokens);
    write_optional_u32(
        txn,
        &latest,
        "cache_creation_tokens",
        usage.cache_creation_tokens,
    );
    write_optional_u32(txn, &latest, "cache_read_tokens", usage.cache_read_tokens);
    write_optional_string(txn, &latest, "request_id", usage.request_id);
    write_optional_string(txn, &latest, "model", usage.model);
    write_optional_string(txn, &latest, "stop_reason", usage.stop_reason);
}

pub(crate) fn extension_negotiated(pair: &DocPair, extension: &str) -> bool {
    let txn = pair.session.transact();
    let Some(root) = chat_writer::root_map_read(&txn) else {
        return false;
    };
    let Some(agent) = root
        .get(&txn, "agent")
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
    else {
        return false;
    };
    match agent.get(&txn, "extensions") {
        Some(yrs::Out::YArray(extensions)) => extensions.iter(&txn).any(|value| {
            matches!(
                value,
                yrs::Out::Any(yrs::Any::String(current)) if current.as_ref() == extension
            )
        }),
        _ => false,
    }
}

pub(crate) fn write_input_prediction(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    epoch: u64,
    seq: u64,
    observed_at: &str,
    text: Option<&str>,
) -> bool {
    let agent = root.get_or_init::<_, yrs::MapRef>(txn, "agent");
    let negotiated = match agent.get(txn, "extensions") {
        Some(yrs::Out::YArray(extensions)) => extensions.iter(txn).any(|value| {
            matches!(
                value,
                yrs::Out::Any(yrs::Any::String(extension))
                    if extension.as_ref() == "peri.prediction"
            )
        }),
        _ => false,
    };
    if !negotiated {
        return false;
    }
    let Some(text) = text else {
        agent.remove(txn, "input_prediction");
        return true;
    };
    let prediction = agent.get_or_init::<_, yrs::MapRef>(txn, "input_prediction");
    prediction.insert(txn, "id", format!("prediction:{epoch}:{seq}"));
    prediction.insert(txn, "text", text.to_string());
    prediction.insert(txn, "created_at", observed_at.to_string());
    true
}

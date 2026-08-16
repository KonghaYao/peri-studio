//! ACPChannel agent plan / 命令目录 / 会话配置归一化（acp_channel.rs 拆分产物）。
//!
//! 拆分动机：原 acp_channel.rs 1824 行超阈值（≤500 行要求），按「解析主题」
//! 拆出本模块——AgentPlan 投影（`plan`/`plan_removed` 通知）、available
//! commands 目录（Phase 6 D1 条目级 kind 分类）、以及 select 型配置目录
//! （`config_option_update` 与 session/new 响应共用，跨任务契约）。
//!
//! 职责边界：本模块只含上述三类解析的常量、投影结构（[`AgentConfigSnapshot`]）
//! 与顶层函数；事件映射（map_raw/map_acp_update）在 acp_channel_map.rs，
//! 字段提取/截断 helper 在 acp_channel_parse.rs。所有函数语义与拆分前
//! 逐字符一致（仅可见性提升 pub(crate) 与文件级 use 调整）。

use std::collections::{BTreeMap, HashSet};

use serde_json::Value;

use peri_studio_proto::schema::{
    AgentPlanEntryProjection, AgentPlanEntryStatus, SessionConfigCategory,
    SessionConfigChoiceProjection, SessionConfigOptionProjection,
};

use super::acp_channel_parse::{truncate_at_char_boundary, MapError};

const AGENT_PLAN_MAX_ENTRIES: usize = 64;
const AGENT_PLAN_CONTENT_MAX_BYTES: usize = 1024;
const AGENT_PLAN_ACTIVE_FORM_MAX_BYTES: usize = 256;
pub(crate) const COMMAND_CATALOG_MAX_ITEMS: usize = 256;
const COMMAND_NAME_MAX_BYTES: usize = 128;
pub(crate) const COMMAND_DESCRIPTION_MAX_BYTES: usize = 1024;

pub(crate) fn parse_agent_plan(
    update: &serde_json::Map<String, Value>,
) -> Result<Vec<AgentPlanEntryProjection>, MapError> {
    let entries = update
        .get("entries")
        .and_then(Value::as_array)
        .ok_or(MapError::MissingField)?;
    if entries.len() > AGENT_PLAN_MAX_ENTRIES {
        return Err(MapError::Unsupported);
    }
    entries
        .iter()
        .map(|value| {
            let entry = value.as_object().ok_or(MapError::MissingField)?;
            let content = entry
                .get("content")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or(MapError::MissingField)?;
            if content.len() > AGENT_PLAN_CONTENT_MAX_BYTES {
                return Err(MapError::Unsupported);
            }
            let status = match entry.get("status").and_then(Value::as_str) {
                Some("pending") => AgentPlanEntryStatus::Pending,
                Some("in_progress") => AgentPlanEntryStatus::InProgress,
                Some("completed") => AgentPlanEntryStatus::Completed,
                _ => return Err(MapError::Unsupported),
            };
            let active_form = entry
                .get("_meta")
                .and_then(Value::as_object)
                .and_then(|meta| meta.get("activeForm"))
                .and_then(Value::as_str)
                .map(|value| value.split_whitespace().collect::<Vec<_>>().join(" "))
                .filter(|value| !value.is_empty());
            if active_form
                .as_ref()
                .is_some_and(|value| value.len() > AGENT_PLAN_ACTIVE_FORM_MAX_BYTES)
            {
                return Err(MapError::Unsupported);
            }
            Ok(AgentPlanEntryProjection {
                content: content.to_string(),
                status,
                active_form,
            })
        })
        .collect()
}

/// Normalize the standard ACP command catalog and the legacy string-array
/// shape into one bounded snapshot. Names are deduplicated case-insensitively
/// because slash dispatch is case-insensitive in Peri's client surfaces.
///
/// Phase 6 D1：`skill_names` / `mcp_skill_names` 从条目级 `_meta.periKind`
/// 推导（Phase 3 起 Peri 每条 availableCommands 条目携带 kind），update 级
/// `skillNames` / `mcpSkillNames` 镜像键已退役（Peri 侧停止写入）。缺省
/// （字符串形态条目 / 无 `_meta.periKind`）回退 `command` 分类，与 Peri 侧
/// 缺省回退一致。返回 `(names, descriptions, skill_names, mcp_skill_names)`。
pub(crate) fn parse_available_commands(
    values: &[Value],
) -> (
    Vec<String>,
    BTreeMap<String, String>,
    Vec<String>,
    Vec<String>,
) {
    let mut names = Vec::new();
    let mut descriptions = BTreeMap::new();
    let mut skill_names = Vec::new();
    let mut mcp_skill_names = Vec::new();
    let mut seen = HashSet::new();
    for value in values.iter().take(COMMAND_CATALOG_MAX_ITEMS) {
        let (raw_name, raw_description, raw_kind) = match value {
            Value::String(name) => (name.as_str(), "", None),
            Value::Object(command) => {
                let Some(name) = command.get("name").and_then(Value::as_str) else {
                    continue;
                };
                let description = command
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let kind = command
                    .get("_meta")
                    .and_then(Value::as_object)
                    .and_then(|meta| meta.get("periKind"))
                    .and_then(Value::as_str);
                (name, description, kind)
            }
            _ => continue,
        };
        let name = truncate_at_char_boundary(raw_name.trim(), COMMAND_NAME_MAX_BYTES);
        if name.is_empty()
            || name
                .chars()
                .any(|ch| ch.is_whitespace() || ch.is_control() || ch == '/')
        {
            continue;
        }
        if !seen.insert(name.to_lowercase()) {
            continue;
        }
        let normalized_description = raw_description
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let description =
            truncate_at_char_boundary(&normalized_description, COMMAND_DESCRIPTION_MAX_BYTES);
        if !description.is_empty() {
            descriptions.insert(name.clone(), description);
        }
        // 条目级 kind 分类（Phase 3 投影形态；缺省回退 command）。
        match raw_kind {
            Some("skill") => skill_names.push(name.clone()),
            Some("mcp_skill") => mcp_skill_names.push(name.clone()),
            _ => {}
        }
        names.push(name);
    }
    (names, descriptions, skill_names, mcp_skill_names)
}

/// 从 `alias (模型名)` 形式 label 提取括号内模型名（config_option_update，
/// 跨任务契约）；无括号/括号内为空 → 整个 label。
fn extract_model_name(label: &str) -> String {
    let Some(open) = label.rfind('(') else {
        return label.to_string();
    };
    let Some(rel) = label[open..].find(')') else {
        return label.to_string();
    };
    let inner = label[open + 1..open + rel].trim();
    if inner.is_empty() {
        label.to_string()
    } else {
        inner.to_string()
    }
}

/// 从 ACP `configOptions` 数组提取 `(model, effort)`（跨任务契约）：id 为
/// `model` 的 option → options 匹配项的 name 内模型名；id 为
/// `thinking_effort` 的 option → currentValue。任一缺失 → None（部分更新
/// 语义）。
///
/// wire 字段（agent-client-protocol schema v1）：option 顶层为
/// `currentValue`/`options`（flatten 的 SessionConfigSelect，camelCase），
/// options 元素为 `{ value, name }`。
///
/// 两条消费路径共用：`config_option_update` 通知（map_acp_update）与
/// session/new 响应体（coordinator，handle_new 不发通知、响应即唯一路径）。
const CONFIG_MAX_OPTIONS: usize = 16;
const CONFIG_MAX_CHOICES: usize = 64;
const CONFIG_ID_MAX_BYTES: usize = 128;
const CONFIG_LABEL_MAX_BYTES: usize = 256;
const CONFIG_DESCRIPTION_MAX_BYTES: usize = 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentConfigSnapshot {
    pub model: Option<String>,
    pub effort: Option<String>,
    pub options: Vec<SessionConfigOptionProjection>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigCatalogError {
    Invalid,
    TooLarge,
}

/// Strict, all-or-nothing normalization for ACP select config options. The
/// same function serves session new/load responses and update notifications,
/// so server validation and the browser projection cannot drift.
pub fn normalize_agent_config(
    values: &[serde_json::Value],
) -> Result<AgentConfigSnapshot, ConfigCatalogError> {
    if values.len() > CONFIG_MAX_OPTIONS {
        return Err(ConfigCatalogError::TooLarge);
    }
    let mut seen_ids = HashSet::new();
    let mut options = Vec::with_capacity(values.len());
    for value in values {
        let raw = value.as_object().ok_or(ConfigCatalogError::Invalid)?;
        if raw.get("type").and_then(Value::as_str) != Some("select") {
            return Err(ConfigCatalogError::Invalid);
        }
        let id = bounded_config_string(raw.get("id"), CONFIG_ID_MAX_BYTES)?;
        let name = bounded_config_string(raw.get("name"), CONFIG_LABEL_MAX_BYTES)?;
        if !seen_ids.insert(id.clone()) {
            return Err(ConfigCatalogError::Invalid);
        }
        let description =
            optional_bounded_config_string(raw.get("description"), CONFIG_DESCRIPTION_MAX_BYTES)?;
        let category = match raw.get("category").and_then(Value::as_str) {
            Some("mode") => Some(SessionConfigCategory::Mode),
            Some("model") => Some(SessionConfigCategory::Model),
            Some("model_config") => Some(SessionConfigCategory::ModelConfig),
            Some("thought_level") => Some(SessionConfigCategory::ThoughtLevel),
            _ => None,
        };
        let current_value = bounded_config_string(raw.get("currentValue"), CONFIG_ID_MAX_BYTES)?;
        let raw_choices = raw
            .get("options")
            .and_then(Value::as_array)
            .ok_or(ConfigCatalogError::Invalid)?;
        if raw_choices.is_empty() || raw_choices.len() > CONFIG_MAX_CHOICES {
            return Err(ConfigCatalogError::TooLarge);
        }
        let mut seen_values = HashSet::new();
        let mut choices = Vec::with_capacity(raw_choices.len());
        for raw_choice in raw_choices {
            let raw_choice = raw_choice.as_object().ok_or(ConfigCatalogError::Invalid)?;
            let choice_value = bounded_config_string(raw_choice.get("value"), CONFIG_ID_MAX_BYTES)?;
            if !seen_values.insert(choice_value.clone()) {
                return Err(ConfigCatalogError::Invalid);
            }
            choices.push(SessionConfigChoiceProjection {
                value: choice_value,
                name: bounded_config_string(raw_choice.get("name"), CONFIG_LABEL_MAX_BYTES)?,
                description: optional_bounded_config_string(
                    raw_choice.get("description"),
                    CONFIG_DESCRIPTION_MAX_BYTES,
                )?,
            });
        }
        if !seen_values.contains(&current_value) {
            return Err(ConfigCatalogError::Invalid);
        }
        options.push(SessionConfigOptionProjection {
            id,
            name,
            description,
            category,
            current_value,
            options: choices,
        });
    }
    let model = options
        .iter()
        .find(|option| option.id == "model")
        .and_then(|option| {
            option
                .options
                .iter()
                .find(|choice| choice.value == option.current_value)
                .map(|choice| extract_model_name(&choice.name))
        });
    let effort = options
        .iter()
        .find(|option| option.id == "thinking_effort")
        .map(|option| option.current_value.clone());
    Ok(AgentConfigSnapshot {
        model,
        effort,
        options,
    })
}

fn bounded_config_string(
    value: Option<&Value>,
    max_bytes: usize,
) -> Result<String, ConfigCatalogError> {
    let value = value
        .and_then(Value::as_str)
        .ok_or(ConfigCatalogError::Invalid)?;
    if value.is_empty() || value.len() > max_bytes {
        return Err(ConfigCatalogError::TooLarge);
    }
    Ok(value.to_string())
}

fn optional_bounded_config_string(
    value: Option<&Value>,
    max_bytes: usize,
) -> Result<Option<String>, ConfigCatalogError> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => bounded_config_string(Some(value), max_bytes).map(Some),
    }
}

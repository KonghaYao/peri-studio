//! 聚合器测试共享构造器与查询辅助（`aggregator_test.rs` 拆分）。
//!
//! 拆分动机：原 `aggregator_test.rs` 2589 行超限，按被测模块主题
//! （`aggregator_judge.rs` 判定族 / `aggregator_write*.rs` 写入族 /
//! `aggregator_write_control.rs` 控制扩展）一拆为九；本文件集中各主题
//! 测试共用的 Doc 构造、事件构造与投影查询 helper，各主题文件经
//! `use super::util::*;` 复用（helper 声明为 `pub(crate)`，规避兄弟
//! 模块 glob 导入的可见性限制）。

use serde_json::json;

use peri_studio_proto::schema::{
    ActiveTurnProjection, AgentActivityKind, AgentActivityStatus, PermissionOptions,
    ToolCallStatus, TurnStatus,
};

use yrs::{Array, Map, Transact, WriteTxn};

use crate::state::chat_writer;
use crate::state::doc_pair::DocPair;
use crate::state::factory::{Factory, ROOT};
use crate::state::normalized::{EventBody, NormalizedEvent};

pub(crate) fn pair() -> DocPair {
    Factory::new().create_chat_doc()
}

pub(crate) fn ev(chat: &str, seq: u64, body: EventBody) -> NormalizedEvent {
    NormalizedEvent {
        chat_id: chat.to_string(),
        seq,
        epoch: 0,
        ts: "2026-08-07T00:00:00Z".to_string(),
        provenance: Default::default(),
        source_agent_id: None,
        callback_entry_id: None,
        body,
    }
}

pub(crate) fn ev_subagent(chat: &str, seq: u64, agent: &str, body: EventBody) -> NormalizedEvent {
    NormalizedEvent {
        chat_id: chat.to_string(),
        seq,
        epoch: 0,
        ts: "2026-08-07T00:00:00Z".to_string(),
        provenance: Default::default(),
        source_agent_id: Some(agent.to_string()),
        callback_entry_id: None,
        body,
    }
}

pub(crate) fn ev_callback(
    chat: &str,
    seq: u64,
    callback_id: &str,
    body: EventBody,
) -> NormalizedEvent {
    NormalizedEvent {
        chat_id: chat.to_string(),
        seq,
        epoch: 0,
        ts: "2026-08-07T00:00:00Z".to_string(),
        provenance: Default::default(),
        source_agent_id: None,
        callback_entry_id: Some(callback_id.to_string()),
        body,
    }
}

pub(crate) fn callback_user_msg(callback_id: &str, text: &str) -> EventBody {
    EventBody::UserMessage {
        turn_id: String::new(),
        entry_id: callback_id.to_string(),
        text: text.to_string(),
        author_user_id: None,
        created_at: "2026-08-07T00:00:00Z".to_string(),
    }
}

pub(crate) fn question_requested(question_id: &str) -> EventBody {
    EventBody::QuestionRequested {
        question_id: question_id.to_string(),
        tool_id: None,
        tool_name: None,
        description: Some("Pick".into()),
        questions: vec![peri_studio_proto::schema::QuestionItemProjection {
            question: "Choose".into(),
            header: None,
            multi_select: false,
            options: vec![peri_studio_proto::schema::QuestionOptionProjection {
                label: "A".into(),
                description: None,
            }],
        }],
        expires_at: "2026-09-08T12:01:00Z".to_string(),
    }
}

pub(crate) fn active_turn_id(pair: &DocPair) -> Option<String> {
    let txn = pair.session.transact();
    chat_writer::root_map_read(&txn).and_then(|root| {
        root.get(&txn, "session")
            .and_then(|v| v.cast::<yrs::MapRef>().ok())
            .and_then(|m| m.get(&txn, "active_turn_id"))
            .and_then(|t| t.cast::<String>().ok())
    })
}

pub(crate) fn entry_order(pair: &DocPair) -> Vec<String> {
    let txn = pair.chat.transact();
    chat_writer::root_map_read(&txn)
        .and_then(|root| root.get(&txn, "entry_order"))
        .and_then(|v| v.cast::<yrs::ArrayRef>().ok())
        .map(|order| {
            (0..order.len(&txn))
                .filter_map(|i| {
                    order
                        .get(&txn, i)
                        .and_then(|v| v.cast::<String>().ok())
                })
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn pending_question_status(pair: &DocPair, question_id: &str) -> Option<String> {
    let txn = pair.session.transact();
    let root = chat_writer::root_map_read(&txn)?;
    let all = root.get(&txn, "pending_questions")?.cast::<yrs::MapRef>().ok()?;
    all.get(&txn, question_id)
        .and_then(|v| v.cast::<yrs::MapRef>().ok())
        .and_then(|item| item.get(&txn, "status"))
        .and_then(|s| s.cast::<String>().ok())
}

pub(crate) fn msg_delta(turn: &str, entry: &str, block: &str, text: &str) -> EventBody {
    EventBody::MessageDelta {
        turn_id: turn.to_string(),
        entry_id: entry.to_string(),
        block_id: block.to_string(),
        text: text.to_string(),
    }
}

pub(crate) fn user_msg(turn: &str, entry: &str, text: &str) -> EventBody {
    EventBody::UserMessage {
        turn_id: turn.to_string(),
        entry_id: entry.to_string(),
        text: text.to_string(),
        author_user_id: None,
        created_at: "2026-08-07T00:00:00Z".to_string(),
    }
}

/// v2 命令路径注入模拟（§6.5/prompt_delivery）：写 user entry（chat doc）+
/// 置 active_turn(Accepting)（session doc，§7.2），镜像 doc_manager
/// RegisterUserEntry 命令的会话侧效果（bump 版本、清除陈旧 input_prediction）。
/// 聚合器已拒绝非回放 UserMessage 事件（回声），user 消息只经服务端单写注入。
pub(crate) fn seed_user_msg(p: &mut DocPair, turn: &str, entry: &str, text: &str) {
    {
        let mut txn = p.chat_txn();
        let root = txn.get_or_insert_map(ROOT);
        chat_writer::create_user_entry(
            &mut txn,
            &root,
            turn,
            entry,
            text,
            None,
            None,
            "2026-08-07T00:00:00Z",
        );
        chat_writer::bump_projection_version(&mut txn, &root);
    }
    {
        let mut txn = p.session_txn();
        let root = txn.get_or_insert_map(ROOT);
        chat_writer::set_active_turn(
            &mut txn,
            &root,
            Some(&ActiveTurnProjection {
                turn_id: turn.to_string(),
                turn_status: TurnStatus::Accepting,
                updated_at: "2026-08-07T00:00:00Z".into(),
            }),
        );
        chat_writer::clear_input_prediction(&mut txn, &root);
        chat_writer::bump_projection_version(&mut txn, &root);
    }
}

pub(crate) fn tool_started(turn: &str, id: &str) -> EventBody {
    EventBody::ToolCallStarted {
        turn_id: turn.to_string(),
        tool_call_id: id.to_string(),
        name: "shell".to_string(),
        status: ToolCallStatus::Pending,
        arguments: Some(json!({"cmd": "ls"})),
        created_at: "2026-08-07T00:00:00Z".to_string(),
    }
}

pub(crate) fn turn_terminal(turn: &str, status: TurnStatus) -> EventBody {
    EventBody::TurnTerminal {
        turn_id: turn.to_string(),
        status,
        completed_at: "2026-08-07T00:00:01Z".to_string(),
        public_error: None,
    }
}

pub(crate) fn activity(
    kind: AgentActivityKind,
    status: AgentActivityStatus,
    correlation_id: Option<&str>,
) -> EventBody {
    EventBody::AgentActivity {
        kind,
        status,
        correlation_id: correlation_id.map(str::to_string),
        label: Some("Research agent".into()),
        is_background: Some(true),
        metrics: std::collections::BTreeMap::from([("tool_count".into(), 3)]),
        attributes: std::collections::BTreeMap::from([("task_kind".into(), "agent".into())]),
    }
}

pub(crate) fn enable_agent_activity(pair: &mut DocPair) {
    let mut txn = pair.session.transact_mut();
    let root = txn.get_or_insert_map(ROOT);
    let agent = root.get_or_init::<_, yrs::MapRef>(&mut txn, "agent");
    let extensions = agent.get_or_init::<_, yrs::ArrayRef>(&mut txn, "extensions");
    extensions.push_back(&mut txn, "peri.agentActivity");
}

pub(crate) fn enable_input_prediction(pair: &mut DocPair) {
    let mut txn = pair.session.transact_mut();
    let root = txn.get_or_insert_map(ROOT);
    let agent = root.get_or_init::<_, yrs::MapRef>(&mut txn, "agent");
    let extensions = agent.get_or_init::<_, yrs::ArrayRef>(&mut txn, "extensions");
    extensions.push_back(&mut txn, "peri.prediction");
}

pub(crate) fn enable_replay(pair: &mut DocPair) {
    let mut txn = pair.session.transact_mut();
    let root = txn.get_or_insert_map(ROOT);
    let agent = root.get_or_init::<_, yrs::MapRef>(&mut txn, "agent");
    let extensions = agent.get_or_init::<_, yrs::ArrayRef>(&mut txn, "extensions");
    extensions.push_back(&mut txn, "peri.replay");
}

pub(crate) fn entry_origin(pair: &DocPair, entry_id: &str) -> (Option<String>, Option<bool>) {
    let txn = pair.chat.transact();
    let root = chat_writer::root_map_read(&txn).unwrap();
    let entry = root
        .get(&txn, "entries")
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
        .and_then(|entries| entries.get(&txn, entry_id))
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
        .unwrap();
    (
        entry
            .get(&txn, "origin")
            .and_then(|value| value.cast::<String>().ok()),
        entry
            .get(&txn, "replay_verified")
            .and_then(|value| value.cast::<bool>().ok()),
    )
}

pub(crate) fn projected_prediction(pair: &DocPair) -> Option<(String, String)> {
    let txn = pair.session.transact();
    let root = chat_writer::root_map_read(&txn)?;
    let agent = root.get(&txn, "agent")?.cast::<yrs::MapRef>().ok()?;
    let prediction = agent
        .get(&txn, "input_prediction")?
        .cast::<yrs::MapRef>()
        .ok()?;
    Some((
        prediction.get(&txn, "id")?.cast::<String>().ok()?,
        prediction.get(&txn, "text")?.cast::<String>().ok()?,
    ))
}

pub(crate) fn permission_requested(id: &str, turn: &str) -> EventBody {
    EventBody::PermissionRequested {
        permission_id: id.to_string(),
        turn_id: turn.to_string(),
        tool_call_id: None,
        tool: None,
        title: "允许执行".to_string(),
        description: None,
        options: vec![PermissionOptions::AllowOnce],
        option_ids: Default::default(),
        expires_at: "2026-08-07T00:05:00Z".to_string(),
    }
}

/// 统计 chat doc 中的 entry 数。
pub(crate) fn entry_count(pair: &DocPair) -> usize {
    let txn = pair.chat.transact();
    chat_writer::root_map_read(&txn)
        .and_then(|root| root.get(&txn, "entries"))
        .and_then(|v| v.cast::<yrs::MapRef>().ok())
        .map(|m| m.len(&txn) as usize)
        .unwrap_or(0)
}

pub(crate) fn tool_call_count(pair: &DocPair) -> usize {
    let txn = pair.chat.transact();
    chat_writer::root_map_read(&txn)
        .and_then(|root| root.get(&txn, "tool_calls"))
        .and_then(|v| v.cast::<yrs::MapRef>().ok())
        .map(|m| m.len(&txn) as usize)
        .unwrap_or(0)
}

pub(crate) fn tool_call(pair: &DocPair, id: &str) -> peri_studio_proto::schema::ToolCallProjection {
    let txn = pair.chat.transact();
    chat_writer::tool_call_projection(&txn, id).expect("tool call projection")
}

pub(crate) fn entry_has_tool_block(pair: &DocPair, entry_id: &str, tool_call_id: &str) -> bool {
    let txn = pair.chat.transact();
    chat_writer::root_map_read(&txn)
        .and_then(|root| root.get(&txn, "entries"))
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
        .and_then(|entries| entries.get(&txn, entry_id))
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
        .and_then(|entry| entry.get(&txn, "blocks"))
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
        .map(|blocks| {
            blocks.iter(&txn).any(|(_, value)| {
                value
                    .cast::<yrs::MapRef>()
                    .ok()
                    .and_then(|block| block.get(&txn, "tool_call_id"))
                    .and_then(|value| value.cast::<String>().ok())
                    .as_deref()
                    == Some(tool_call_id)
            })
        })
        .unwrap_or(false)
}

pub(crate) fn permission_count(pair: &DocPair) -> usize {
    let txn = pair.session.transact();
    chat_writer::root_map_read(&txn)
        .and_then(|root| root.get(&txn, "pending_permissions"))
        .and_then(|v| v.cast::<yrs::MapRef>().ok())
        .map(|m| m.len(&txn) as usize)
        .unwrap_or(0)
}

pub(crate) fn permission_has_option_ids(pair: &DocPair, permission_id: &str) -> bool {
    let txn = pair.session.transact();
    chat_writer::root_map_read(&txn)
        .and_then(|root| root.get(&txn, "pending_permissions"))
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
        .and_then(|permissions| permissions.get(&txn, permission_id))
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
        .is_some_and(|permission| permission.get(&txn, "option_ids").is_some())
}

pub(crate) fn permission_string(
    pair: &DocPair,
    permission_id: &str,
    field: &str,
) -> Option<String> {
    let txn = pair.session.transact();
    chat_writer::root_map_read(&txn)?
        .get(&txn, "pending_permissions")?
        .cast::<yrs::MapRef>()
        .ok()?
        .get(&txn, permission_id)?
        .cast::<yrs::MapRef>()
        .ok()?
        .get(&txn, field)?
        .cast::<String>()
        .ok()
}

pub(crate) fn active_turn_status(pair: &DocPair) -> Option<TurnStatus> {
    let txn = pair.session.transact();
    let sm = chat_writer::root_map_read(&txn)?
        .get(&txn, "session")?
        .cast::<yrs::MapRef>()
        .ok()?;
    sm.get(&txn, "active_turn_status")
        .and_then(|s| s.cast::<String>().ok())
        .map(|s| match s.as_str() {
            "accepting" => TurnStatus::Accepting,
            "running" => TurnStatus::Running,
            "awaitingPermission" => TurnStatus::AwaitingPermission,
            "cancelling" => TurnStatus::Cancelling,
            "completed" => TurnStatus::Completed,
            "cancelled" => TurnStatus::Cancelled,
            "interrupted" => TurnStatus::Interrupted,
            "failed" => TurnStatus::Failed,
            _ => TurnStatus::Accepting,
        })
}

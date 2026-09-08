//! AskUserQuestion CAS（pending → resolved/expired），与 `permission.rs` 平行。
//!
//! 聚合层 `QuestionResolved`/`QuestionExpired` 与控制面 `ResolveQuestion`/
//! `ExpireQuestion` 共用同一原语；**仅 CAS 成功** 后 channel 才向 instance 发
//! `control_response`（WP-C / O-001）。

use yrs::{Array, Map, Transact, WriteTxn};

use peri_studio_proto::schema::{
    QuestionAnswer, QuestionItemProjection, QuestionProjection, QuestionStatus,
};

use crate::state::chat_writer;
use crate::state::doc_pair::DocPair;
use crate::state::factory::ROOT;
use crate::state::view_store::TransactionCtx;

/// 与 [`crate::state::permission::CasOutcome`] 同形，便于 doc_manager 分支复用。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuestionCasOutcome {
    Migrated,
    Duplicate,
    Expired,
    Unknown,
}

pub fn register(pair: &mut DocPair, value: &QuestionProjection) -> bool {
    let mut txn = pair.session_txn();
    let root = txn.get_or_insert_map(ROOT);
    let all = root.get_or_init::<_, yrs::MapRef>(&mut txn, "pending_questions");
    if all.get(&txn, &value.question_id).is_some() {
        return false;
    }
    write_question_map(&mut txn, &all, value);
    true
}

pub fn upsert(pair: &mut DocPair, value: &QuestionProjection) {
    let mut txn = pair.session_txn();
    let root = txn.get_or_insert_map(ROOT);
    let all = root.get_or_init::<_, yrs::MapRef>(&mut txn, "pending_questions");
    write_question_map(&mut txn, &all, value);
}

/// 聚合层 upsert（`QuestionRequested` / replay idempotent）。
pub fn upsert_pending(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    question_id: &str,
    questions: &[QuestionItemProjection],
    description: Option<&str>,
    expires_at: &str,
) {
    let value = projection_from_requested(question_id, description, questions, expires_at);
    let all = root.get_or_init::<_, yrs::MapRef>(txn, "pending_questions");
    write_question_map(txn, &all, &value);
}

/// 在同一 control 事务内 CAS migrate（投影 replay / 内部事件）。
pub fn cas_respond_in_txn(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    question_id: &str,
    answers: &[QuestionAnswer],
) -> QuestionCasOutcome {
    cas_migrate(txn, root, question_id, Some(answers))
}

pub fn cas_expire_in_txn(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    question_id: &str,
) -> QuestionCasOutcome {
    cas_migrate(txn, root, question_id, None)
}

pub fn respond(
    pair: &mut DocPair,
    question_id: &str,
    answers: &[QuestionAnswer],
) -> QuestionCasOutcome {
    let mut txn = pair.session_txn();
    let root = txn.get_or_insert_map(ROOT);
    cas_migrate(&mut txn, &root, question_id, Some(answers))
}

pub fn expire(pair: &mut DocPair, question_id: &str) -> QuestionCasOutcome {
    let mut txn = pair.session_txn();
    let root = txn.get_or_insert_map(ROOT);
    cas_migrate(&mut txn, &root, question_id, None)
}

pub fn context(pair: &DocPair, question_id: &str) -> Option<String> {
    let txn = pair.session.transact();
    let root = chat_writer::root_map_read(&txn)?;
    let all = root
        .get(&txn, "pending_questions")?
        .cast::<yrs::MapRef>()
        .ok()?;
    let item = all.get(&txn, question_id)?.cast::<yrs::MapRef>().ok()?;
    item.get(&txn, "status")
        .and_then(|value| value.cast::<String>().ok())
}

pub fn answers_match_stored(
    pair: &DocPair,
    question_id: &str,
    answers: &[QuestionAnswer],
) -> bool {
    let txn = pair.session.transact();
    let Some(root) = chat_writer::root_map_read(&txn) else {
        return false;
    };
    let Some(all) = root
        .get(&txn, "pending_questions")
        .and_then(|v| v.cast::<yrs::MapRef>().ok())
    else {
        return false;
    };
    let Some(item) = all
        .get(&txn, question_id)
        .and_then(|v| v.cast::<yrs::MapRef>().ok())
    else {
        return false;
    };
    let Some(raw) = item
        .get(&txn, "answer")
        .and_then(|v| v.cast::<String>().ok())
    else {
        return false;
    };
    match serde_json::from_str::<Vec<QuestionAnswer>>(&raw) {
        Ok(stored) => stored == answers,
        Err(_) => false,
    }
}

pub fn bump_projection(pair: &mut DocPair) {
    let mut txn = pair.session_txn();
    let root = txn.get_or_insert_map(ROOT);
    chat_writer::bump_projection_version(&mut txn, &root);
}

pub fn pending_count(pair: &DocPair) -> usize {
    let txn = pair.session.transact();
    let Some(root) = chat_writer::root_map_read(&txn) else {
        return 0;
    };
    let Some(all) = root.get(&txn, "pending_questions") else {
        return 0;
    };
    let Ok(all) = all.cast::<yrs::MapRef>() else {
        return 0;
    };
    all.iter(&txn)
        .filter(|(_, v)| {
            <yrs::Out as Clone>::clone(v)
                .cast::<yrs::MapRef>()
                .ok()
                .and_then(|item| {
                    item.get(&txn, "status")
                        .and_then(|s| s.cast::<String>().ok())
                })
                .is_some_and(|s| s == "pending")
        })
        .count()
}

fn cas_migrate(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    question_id: &str,
    answers: Option<&[QuestionAnswer]>,
) -> QuestionCasOutcome {
    let all = root.get_or_init::<_, yrs::MapRef>(txn, "pending_questions");
    let Some(item) = all
        .get(txn, question_id)
        .and_then(|v| v.cast::<yrs::MapRef>().ok())
    else {
        return QuestionCasOutcome::Unknown;
    };
    let status = item
        .get(txn, "status")
        .and_then(|v| v.cast::<String>().ok())
        .unwrap_or_default();
    match status.as_str() {
        "pending" => {
            if let Some(answers) = answers {
                item.insert(txn, "status", "resolved");
                item.insert(
                    txn,
                    "answer",
                    serde_json::to_string(answers).unwrap_or_else(|_| "[]".to_string()),
                );
            } else {
                item.insert(txn, "status", "expired");
            }
            QuestionCasOutcome::Migrated
        }
        "resolved" => QuestionCasOutcome::Duplicate,
        "expired" => match answers {
            Some(_) => QuestionCasOutcome::Expired,
            None => QuestionCasOutcome::Duplicate,
        },
        _ => QuestionCasOutcome::Unknown,
    }
}

fn write_question_map(
    txn: &mut TransactionCtx<'_>,
    all: &yrs::MapRef,
    value: &QuestionProjection,
) {
    let item = all.get_or_init::<_, yrs::MapRef>(txn, value.question_id.as_str());
    item.insert(txn, "question_id", value.question_id.clone());
    item.insert(txn, "status", value.status.as_str());
    match &value.description {
        Some(d) => item.insert(txn, "description", d.clone()),
        None => item.insert(txn, "description", yrs::Any::Null),
    };
    item.insert(txn, "expires_at", value.expires_at.clone());
    match &value.answer {
        Some(a) => item.insert(txn, "answer", a.clone()),
        None => item.insert(txn, "answer", yrs::Any::Null),
    };
    let q_order = item.get_or_init::<_, yrs::ArrayRef>(txn, "question_order");
    while q_order.len(txn) > 0 {
        q_order.remove(txn, 0);
    }
    let questions = item.get_or_init::<_, yrs::MapRef>(txn, "questions");
    for (idx, q) in value.questions.iter().enumerate() {
        q_order.push_back(txn, idx.to_string());
        write_question_item(txn, &questions, idx, q);
    }
}

fn write_question_item(
    txn: &mut TransactionCtx<'_>,
    questions: &yrs::MapRef,
    idx: usize,
    q: &QuestionItemProjection,
) {
    let key = idx.to_string();
    let item = questions.get_or_init::<_, yrs::MapRef>(txn, key.as_str());
    item.insert(txn, "question", q.question.clone());
    match &q.header {
        Some(h) => item.insert(txn, "header", h.clone()),
        None => item.insert(txn, "header", yrs::Any::Null),
    };
    item.insert(txn, "multi_select", q.multi_select);
    let opt_order = item.get_or_init::<_, yrs::ArrayRef>(txn, "option_order");
    while opt_order.len(txn) > 0 {
        opt_order.remove(txn, 0);
    }
    let options = item.get_or_init::<_, yrs::MapRef>(txn, "options");
    for (oi, opt) in q.options.iter().enumerate() {
        let ok = oi.to_string();
        opt_order.push_back(txn, ok.clone());
        let om = options.get_or_init::<_, yrs::MapRef>(txn, ok.as_str());
        om.insert(txn, "label", opt.label.clone());
        match &opt.description {
            Some(d) => om.insert(txn, "description", d.clone()),
            None => om.insert(txn, "description", yrs::Any::Null),
        };
    }
}

pub fn projection_from_requested(
    question_id: &str,
    description: Option<&str>,
    questions: &[QuestionItemProjection],
    expires_at: &str,
) -> QuestionProjection {
    QuestionProjection {
        question_id: question_id.to_string(),
        status: QuestionStatus::Pending,
        questions: questions.to_vec(),
        description: description.map(str::to_string),
        expires_at: expires_at.to_string(),
        answer: None,
    }
}

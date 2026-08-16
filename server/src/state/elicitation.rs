//! Typed ACP form elicitation projection and response CAS.

use peri_studio_proto::action::ElicitationResponseAction;
use peri_studio_proto::schema::ElicitationProjection;
use yrs::{Array, Map, Transact, WriteTxn};

use crate::state::chat_writer;
use crate::state::doc_pair::DocPair;
use crate::state::factory::ROOT;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ElicitationCasOutcome {
    Migrated,
    ReplaySame,
    Conflict,
    Expired,
    Unknown,
}

pub fn register(pair: &mut DocPair, value: &ElicitationProjection) -> bool {
    let mut txn = pair.session_txn();
    let root = txn.get_or_insert_map(ROOT);
    let all = root.get_or_init::<_, yrs::MapRef>(&mut txn, "pending_elicitations");
    if all.get(&txn, &value.elicitation_id).is_some() {
        return false;
    }
    let item = all.insert(
        &mut txn,
        value.elicitation_id.clone(),
        yrs::MapPrelim::default(),
    );
    item.insert(&mut txn, "elicitation_id", value.elicitation_id.clone());
    item.insert(&mut txn, "message", value.message.clone());
    item.insert(&mut txn, "status", value.status.as_str());
    item.insert(&mut txn, "response_action", yrs::Any::Null);
    item.insert(&mut txn, "created_at", value.created_at.clone());
    item.insert(&mut txn, "updated_at", value.updated_at.clone());
    let field_order = item.get_or_init::<_, yrs::ArrayRef>(&mut txn, "field_order");
    let fields = item.get_or_init::<_, yrs::MapRef>(&mut txn, "fields");
    for field in &value.fields {
        field_order.push_back(&mut txn, field.id.clone());
        let projected = fields.insert(&mut txn, field.id.clone(), yrs::MapPrelim::default());
        projected.insert(&mut txn, "id", field.id.clone());
        projected.insert(&mut txn, "title", field.title.clone());
        match &field.description {
            Some(description) => projected.insert(&mut txn, "description", description.clone()),
            None => projected.insert(&mut txn, "description", yrs::Any::Null),
        };
        projected.insert(&mut txn, "kind", field.kind.as_str());
        projected.insert(&mut txn, "required", field.required);
        let option_order = projected.get_or_init::<_, yrs::ArrayRef>(&mut txn, "option_order");
        let options = projected.get_or_init::<_, yrs::MapRef>(&mut txn, "options");
        for option in &field.options {
            option_order.push_back(&mut txn, option.value.clone());
            let projected_option =
                options.insert(&mut txn, option.value.clone(), yrs::MapPrelim::default());
            projected_option.insert(&mut txn, "value", option.value.clone());
            projected_option.insert(&mut txn, "label", option.label.clone());
            match &option.description {
                Some(description) => {
                    projected_option.insert(&mut txn, "description", description.clone())
                }
                None => projected_option.insert(&mut txn, "description", yrs::Any::Null),
            };
        }
    }
    true
}

pub fn begin_response(
    pair: &mut DocPair,
    elicitation_id: &str,
    action: ElicitationResponseAction,
    updated_at: &str,
) -> ElicitationCasOutcome {
    let mut txn = pair.session_txn();
    let root = txn.get_or_insert_map(ROOT);
    let all = root.get_or_init::<_, yrs::MapRef>(&mut txn, "pending_elicitations");
    let Some(item) = all
        .get(&txn, elicitation_id)
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
    else {
        return ElicitationCasOutcome::Unknown;
    };
    let status = item
        .get(&txn, "status")
        .and_then(|value| value.cast::<String>().ok())
        .unwrap_or_default();
    let existing = item
        .get(&txn, "response_action")
        .and_then(|value| value.cast::<String>().ok());
    let action = response_action_str(action);
    match status.as_str() {
        "pending" => {
            item.insert(&mut txn, "status", "responding");
            item.insert(&mut txn, "response_action", action);
            item.insert(&mut txn, "updated_at", updated_at.to_string());
            ElicitationCasOutcome::Migrated
        }
        "responding" | "resolved" if existing.as_deref() == Some(action) => {
            ElicitationCasOutcome::ReplaySame
        }
        "responding" | "resolved" => ElicitationCasOutcome::Conflict,
        "expired" => ElicitationCasOutcome::Expired,
        _ => ElicitationCasOutcome::Unknown,
    }
}

pub fn complete(pair: &mut DocPair, elicitation_id: &str, updated_at: &str) -> bool {
    let mut txn = pair.session_txn();
    let root = txn.get_or_insert_map(ROOT);
    let all = root.get_or_init::<_, yrs::MapRef>(&mut txn, "pending_elicitations");
    let Some(item) = all
        .get(&txn, elicitation_id)
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
    else {
        return false;
    };
    if item
        .get(&txn, "status")
        .and_then(|value| value.cast::<String>().ok())
        .as_deref()
        != Some("responding")
    {
        return false;
    }
    item.insert(&mut txn, "status", "resolved");
    item.insert(&mut txn, "updated_at", updated_at.to_string());
    true
}

pub fn expire_all_pending(pair: &mut DocPair, updated_at: &str) -> usize {
    let mut txn = pair.session_txn();
    let root = txn.get_or_insert_map(ROOT);
    let all = root.get_or_init::<_, yrs::MapRef>(&mut txn, "pending_elicitations");
    let ids = all.keys(&txn).map(str::to_string).collect::<Vec<_>>();
    let mut count = 0;
    for id in ids {
        let Some(item) = all
            .get(&txn, &id)
            .and_then(|value| value.cast::<yrs::MapRef>().ok())
        else {
            continue;
        };
        let status = item
            .get(&txn, "status")
            .and_then(|value| value.cast::<String>().ok());
        if matches!(status.as_deref(), Some("pending" | "responding")) {
            item.insert(&mut txn, "status", "expired");
            item.insert(&mut txn, "updated_at", updated_at.to_string());
            count += 1;
        }
    }
    count
}

pub fn context(
    pair: &DocPair,
    elicitation_id: &str,
) -> Option<(String, Option<ElicitationResponseAction>)> {
    let txn = pair.session.transact();
    let root = chat_writer::root_map_read(&txn)?;
    let all = root
        .get(&txn, "pending_elicitations")?
        .cast::<yrs::MapRef>()
        .ok()?;
    let item = all.get(&txn, elicitation_id)?.cast::<yrs::MapRef>().ok()?;
    let status = item
        .get(&txn, "status")
        .and_then(|value| value.cast::<String>().ok())?;
    let action = item
        .get(&txn, "response_action")
        .and_then(|value| value.cast::<String>().ok())
        .and_then(parse_response_action);
    Some((status, action))
}

fn response_action_str(action: ElicitationResponseAction) -> &'static str {
    match action {
        ElicitationResponseAction::Accept => "accept",
        ElicitationResponseAction::Decline => "decline",
        ElicitationResponseAction::Cancel => "cancel",
    }
}

fn parse_response_action(value: String) -> Option<ElicitationResponseAction> {
    match value.as_str() {
        "accept" => Some(ElicitationResponseAction::Accept),
        "decline" => Some(ElicitationResponseAction::Decline),
        "cancel" => Some(ElicitationResponseAction::Cancel),
        _ => None,
    }
}

pub fn bump_projection(pair: &mut DocPair) {
    let mut txn = pair.session_txn();
    let root = txn.get_or_insert_map(ROOT);
    chat_writer::bump_projection_version(&mut txn, &root);
}

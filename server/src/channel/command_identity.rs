//! Canonical equality evidence for reconnecting commands.

use peri_studio_proto::action::{PromptChatPayload, RespondElicitationPayload};

use crate::persist::metadata::{payload_hash, MetadataError};

/// Hash the exact typed prompt identity without persisting a second copy of the
/// user body. Every admission and reconnect path must call this same function.
pub(super) fn prompt_payload_fingerprint(
    payload: &PromptChatPayload,
) -> Result<String, MetadataError> {
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct CanonicalPromptPayload<'a> {
        action_type: &'static str,
        chat_id: &'a str,
        message: &'a str,
        effort: Option<&'a str>,
    }

    payload_hash(&CanonicalPromptPayload {
        action_type: "chat/prompt",
        chat_id: &payload.chat_id,
        message: &payload.message,
        effort: payload.effort.as_deref(),
    })
}

/// Hash the exact typed form response. The outbox stores only this digest and
/// request identity; user answers never enter recovery metadata.
pub(super) fn elicitation_response_fingerprint(
    payload: &RespondElicitationPayload,
) -> Result<String, MetadataError> {
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct CanonicalElicitationResponse<'a> {
        action_type: &'static str,
        chat_id: &'a str,
        elicitation_id: &'a str,
        action: peri_studio_proto::action::ElicitationResponseAction,
        answers: &'a std::collections::BTreeMap<String, peri_studio_proto::action::ElicitationAnswer>,
    }

    payload_hash(&CanonicalElicitationResponse {
        action_type: "elicitation/respond",
        chat_id: &payload.chat_id,
        elicitation_id: &payload.elicitation_id,
        action: payload.action,
        answers: &payload.answers,
    })
}

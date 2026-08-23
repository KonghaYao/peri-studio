//! Global health gate for client operations that create committed side effects.
//!
//! This is deliberately independent from token authorization: authorization
//! answers *who* may mutate, while admission answers *whether the recovered
//! server is currently able to make a durable commitment*.

use peri_studio_proto::action::ActionEnvelope;
use peri_studio_proto::frame::Frame;
use peri_studio_proto::resource::{
    ResourceErrorCode, ResourceFailure, ResourceQuery, ResourceResult,
};

use super::gateway::action_error_committed_rejected;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Commitment {
    ReadOnly,
    Committed,
}

pub(super) struct MutationAdmission;

impl MutationAdmission {
    pub(super) fn classify(frame: &Frame) -> Commitment {
        match frame {
            Frame::ResourceQuery(ResourceQuery::GitAction { .. }) => Commitment::Committed,
            Frame::Action(action) if !is_read_only_action(action) => Commitment::Committed,
            _ => Commitment::ReadOnly,
        }
    }

    pub(super) fn rejection(frame: &Frame, server_healthy: bool) -> Option<Frame> {
        if server_healthy || Self::classify(frame) == Commitment::ReadOnly {
            return None;
        }
        match frame {
            Frame::Action(action) => {
                Some(Frame::ActionError(action_error_committed_rejected(action)))
            }
            Frame::ResourceQuery(query @ ResourceQuery::GitAction { .. }) => {
                Some(Frame::ResourceResult(ResourceResult {
                    request_id: query.request_id().to_string(),
                    result: None,
                    error: Some(ResourceFailure {
                        code: ResourceErrorCode::Unavailable,
                        message: "server degraded/restarting; retry later".to_string(),
                        retryable: true,
                    }),
                }))
            }
            _ => None,
        }
    }
}

fn is_read_only_action(action: &ActionEnvelope) -> bool {
    matches!(
        action,
        ActionEnvelope::PersistedSessionPromptStatus { .. }
            | ActionEnvelope::RewindCandidates { .. }
            | ActionEnvelope::RewindPreview { .. }
    )
}

//! 对产生已提交副作用的客户端操作实施全局健康门禁。
//!
//! 它刻意独立于令牌授权：授权回答“谁可以修改”，本门禁回答“恢复后的服务
//! 当前是否有能力作出持久承诺”。

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
                        suggested_limit: None,
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

use std::collections::HashSet;

use peri_studio_proto::ack::{AckStatus, ActionAck, ActionError, ErrorCode};
use peri_studio_proto::resource::{
    ActionResourceResult, FsMutationResult, ResourceErrorCode, ResourceFailure,
};

use super::resource_fs_mutation_service::FsMutationPayload;
use crate::control::InstanceError;

pub(crate) fn committed_ack(
    command_id: String,
    result: ActionResourceResult,
    duplicate: bool,
) -> ActionAck {
    ActionAck {
        command_id,
        status: if duplicate {
            AckStatus::Duplicate
        } else {
            AckStatus::Committed
        },
        turn_id: None,
        chat_id: None,
        project_id: None,
        instance_id: None,
        session_id: None,
        acp_session_id: None,
        committed_projection_version: None,
        resource_result: Some(result),
    }
}

pub(super) fn validate_mutation(payload: &FsMutationPayload) -> Result<(), ResourceFailure> {
    match payload {
        FsMutationPayload::CreateDir(payload) => {
            validate_project(&payload.project_id)?;
            validate_path(&payload.path)?;
            if payload.if_none_match != "*" {
                return Err(invalid_mutation());
            }
        }
        FsMutationPayload::Move(payload) => {
            validate_project(&payload.project_id)?;
            validate_path(&payload.source)?;
            validate_path(&payload.target)?;
            if payload.source == payload.target
                || payload.target.starts_with(&format!("{}/", payload.source))
                || payload.source_if_match.is_empty()
                || payload.target_if_match.is_some()
                || payload.target_if_none_match.as_deref() != Some("*")
            {
                return Err(invalid_mutation());
            }
        }
        FsMutationPayload::Delete(payload) => {
            validate_project(&payload.project_id)?;
            validate_path(&payload.path)?;
            if payload.if_match.is_empty()
                || payload.use_trash
                || (!payload.recursive && payload.confirm_token.is_some())
            {
                return Err(invalid_mutation());
            }
        }
    }
    Ok(())
}

pub(super) fn validate_path(path: &str) -> Result<(), ResourceFailure> {
    if path.is_empty()
        || path.len() > 4096
        || path.starts_with('/')
        || path.ends_with('/')
        || path.contains('\\')
        || path.contains('\0')
        || path.contains("//")
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        Err(failure(
            ResourceErrorCode::InvalidPath,
            "filesystem mutation path is invalid",
            false,
        ))
    } else {
        Ok(())
    }
}

pub(super) fn normalize_mutation_result(mut result: FsMutationResult) -> FsMutationResult {
    let mut seen = HashSet::new();
    result
        .affected_paths
        .retain(|path| seen.insert(path.clone()));
    result
}

pub(super) fn mutation_instance_failure(error: InstanceError) -> ResourceFailure {
    match error {
        InstanceError::UnknownInstance(_) | InstanceError::Offline => failure(
            ResourceErrorCode::InstanceOffline,
            "project instance is offline",
            true,
        ),
        InstanceError::ResourceUnsupported => failure(
            ResourceErrorCode::ResourceUnsupported,
            "project instance does not support filesystem mutations",
            false,
        ),
        InstanceError::Timeout | InstanceError::ConnectionGone => failure(
            ResourceErrorCode::DeliveryUnknown,
            "filesystem mutation delivery is unknown",
            false,
        ),
        _ => failure(
            ResourceErrorCode::Unavailable,
            "filesystem mutation failed",
            true,
        ),
    }
}

pub(super) fn normalize_instance_failure(error: ResourceFailure) -> ResourceFailure {
    let (message, retryable) = match error.code {
        ResourceErrorCode::InvalidPath | ResourceErrorCode::UnrepresentableName => {
            ("filesystem mutation path is invalid", false)
        }
        ResourceErrorCode::OutsideWorkspace => {
            ("filesystem mutation is outside the workspace", false)
        }
        ResourceErrorCode::NotFound => ("filesystem entry was not found", false),
        ResourceErrorCode::NotDirectory => ("filesystem entry is not a directory", false),
        ResourceErrorCode::PermissionDenied => ("filesystem mutation is not permitted", false),
        ResourceErrorCode::VersionConflict => {
            ("filesystem entry changed; refresh and try again", false)
        }
        ResourceErrorCode::ResourceUnsupported => (
            "project instance does not support filesystem mutations",
            false,
        ),
        ResourceErrorCode::DeliveryUnknown => (
            "filesystem mutation outcome is unknown; refresh to verify",
            false,
        ),
        ResourceErrorCode::Timeout | ResourceErrorCode::Unavailable => {
            ("filesystem mutation is temporarily unavailable", true)
        }
        _ => ("filesystem mutation failed", error.retryable),
    };
    failure(error.code, message, retryable)
}

pub(super) fn resource_action_error(command_id: &str, failure: ResourceFailure) -> ActionError {
    let code = match failure.code {
        ResourceErrorCode::Forbidden
        | ResourceErrorCode::PermissionDenied
        | ResourceErrorCode::OutsideWorkspace => ErrorCode::Forbidden,
        ResourceErrorCode::ProjectNotFound
        | ResourceErrorCode::InvalidRequest
        | ResourceErrorCode::InvalidPath
        | ResourceErrorCode::UnrepresentableName
        | ResourceErrorCode::NotFound
        | ResourceErrorCode::NotDirectory
        | ResourceErrorCode::ResourceUnsupported => ErrorCode::InvalidState,
        ResourceErrorCode::InstanceOffline => ErrorCode::InstanceOffline,
        ResourceErrorCode::VersionConflict => ErrorCode::VersionConflict,
        ResourceErrorCode::DeliveryUnknown => ErrorCode::DeliveryUnknown,
        ResourceErrorCode::RateLimited => ErrorCode::RateLimited,
        _ => ErrorCode::AgentUnavailable,
    };
    action_error(command_id, code, &failure.message, failure.retryable)
}

pub(super) fn action_error(
    command_id: &str,
    code: ErrorCode,
    message: &str,
    retryable: bool,
) -> ActionError {
    ActionError {
        command_id: command_id.to_string(),
        code,
        message: message.to_string(),
        retryable,
        retry_after_ms: None,
    }
}

pub(super) fn failure(code: ResourceErrorCode, message: &str, retryable: bool) -> ResourceFailure {
    ResourceFailure {
        code,
        message: message.to_string(),
        retryable,
        suggested_limit: None,
    }
}

fn validate_project(project_id: &str) -> Result<(), ResourceFailure> {
    if project_id.is_empty() {
        Err(invalid_mutation())
    } else {
        Ok(())
    }
}

fn invalid_mutation() -> ResourceFailure {
    failure(
        ResourceErrorCode::InvalidRequest,
        "filesystem mutation is invalid",
        false,
    )
}

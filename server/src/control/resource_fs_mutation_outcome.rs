use serde::{Deserialize, Serialize};

use peri_studio_proto::ack::{ActionError, ErrorCode};
use peri_studio_proto::resource::ActionResourceResult;

use super::resource_fs_mutation_validation::action_error;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct DurableFsMutationOutcome {
    result: Option<ActionResourceResult>,
    error: Option<ActionError>,
}

impl DurableFsMutationOutcome {
    pub(super) fn from_outcome(outcome: &Result<ActionResourceResult, ActionError>) -> Self {
        match outcome {
            Ok(result) => Self {
                result: Some(result.clone()),
                error: None,
            },
            Err(error) => Self {
                result: None,
                error: Some(error.clone()),
            },
        }
    }

    pub(super) fn into_outcome(self) -> Result<ActionResourceResult, ActionError> {
        match (self.result, self.error) {
            (Some(result), None) => Ok(result),
            (None, Some(error)) => Err(error),
            _ => Err(action_error(
                "",
                ErrorCode::InvalidState,
                "filesystem mutation outcome is invalid",
                false,
            )),
        }
    }
}

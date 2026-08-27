//! ACP 工具 patch 的关联、终态例外与内容幂等判定。

use yrs::Transact;

use peri_studio_proto::schema::{
    ActiveTurnProjection, ToolCallProjection, ToolCallStatus, TurnStatus,
};

use crate::state::{
    chat_writer,
    doc_pair::DocPair,
    normalized::{EventBody, ToolCallPatch, ToolJsonPatch},
};

use super::aggregator::{Aggregator, ApplyReason};

impl Aggregator {
    pub(super) fn judge_tool_patch(
        &self,
        pair: &mut DocPair,
        active: Option<&ActiveTurnProjection>,
        turn_id: &str,
        tool_call_id: &str,
        patch: &ToolCallPatch,
    ) -> Result<(), ApplyReason> {
        if tool_call_id.is_empty() {
            return Err(ApplyReason::UnknownToolCall);
        }
        let existing = {
            let txn = pair.chat.transact();
            chat_writer::tool_call_projection(&txn, tool_call_id)
        };
        let resolved_turn = (!turn_id.is_empty())
            .then_some(turn_id)
            .or_else(|| existing.as_ref().map(|tool| tool.turn_id.as_str()))
            .or(pair.stream.replay_turn.as_deref())
            .or_else(|| active.map(|turn| turn.turn_id.as_str()));
        if resolved_turn.is_none_or(str::is_empty) {
            return Err(ApplyReason::UnknownTurn);
        }

        let incoming_terminal = patch.status.is_some_and(tool_terminal);
        let active_is_terminal = active.is_some_and(|turn| {
            matches!(
                turn.turn_status,
                TurnStatus::Completed
                    | TurnStatus::Failed
                    | TurnStatus::Cancelled
                    | TurnStatus::Interrupted
            )
        });
        if !pair.stream.replay_active && active_is_terminal {
            // turn 终态后仅允许已知工具补交终态/证据；普通 running patch 仍拒绝。
            if existing.is_none() || (!incoming_terminal && !patch_has_evidence(patch)) {
                return Err(ApplyReason::TurnTerminalGuard);
            }
        } else if !pair.stream.replay_active {
            self.judge_turn_guard(
                active,
                &EventBody::ToolCallPatched {
                    turn_id: turn_id.to_string(),
                    tool_call_id: tool_call_id.to_string(),
                    patch: patch.clone(),
                },
            )?;
        }

        if let Some(tool) = &existing {
            if !patch_changes(tool, patch) {
                return Err(ApplyReason::DuplicateIdempotent);
            }
            // AwaitingPermission 会在 writer 内冻结非法状态跃迁，但终态帧
            // 携带的输出证据仍需合并，不能把整帧拒绝。
        }
        Ok(())
    }
}

fn tool_terminal(status: ToolCallStatus) -> bool {
    matches!(
        status,
        ToolCallStatus::Completed | ToolCallStatus::Error | ToolCallStatus::Cancelled
    )
}

fn patch_has_evidence(patch: &ToolCallPatch) -> bool {
    patch.name.is_some()
        || patch.kind.is_some()
        || !matches!(patch.arguments, ToolJsonPatch::Unchanged)
        || !matches!(patch.content, ToolJsonPatch::Unchanged)
        || !matches!(patch.locations, ToolJsonPatch::Unchanged)
        || !matches!(patch.result, ToolJsonPatch::Unchanged)
        || patch.public_error.is_some()
}

fn patch_changes(tool: &ToolCallProjection, patch: &ToolCallPatch) -> bool {
    if patch.name.as_ref().is_some_and(|name| name != &tool.name)
        || patch.kind.is_some_and(|kind| kind != tool.kind)
        || patch.status.is_some_and(|status| status != tool.status)
        || patch
            .public_error
            .as_ref()
            .is_some_and(|error| tool.public_error.as_ref() != Some(error))
        || patch
            .completed_at
            .as_ref()
            .is_some_and(|at| tool.completed_at.as_ref() != Some(at))
    {
        return true;
    }
    json_patch_changes(&tool.arguments, tool.arguments_omitted, &patch.arguments)
        || content_patch_changes(tool.content.as_ref(), tool.content_omitted, patch)
        || json_patch_changes(&tool.locations, tool.locations_omitted, &patch.locations)
        || json_patch_changes(&tool.result, tool.result_omitted, &patch.result)
}

fn content_patch_changes(
    current: Option<&serde_json::Value>,
    omitted: Option<bool>,
    patch: &ToolCallPatch,
) -> bool {
    if patch.append_content {
        // chunk 的相同文本也可能是合法连续片段；帧级重复由 epoch/seq 水位去重。
        return matches!(
            patch.content,
            ToolJsonPatch::Set { .. } | ToolJsonPatch::Omitted { .. }
        );
    }
    json_patch_changes(&current.cloned(), omitted, &patch.content)
}

fn json_patch_changes(
    current: &Option<serde_json::Value>,
    omitted: Option<bool>,
    patch: &ToolJsonPatch,
) -> bool {
    match patch {
        ToolJsonPatch::Unchanged => false,
        ToolJsonPatch::Clear => current.is_some() || omitted == Some(true),
        ToolJsonPatch::Set { value } => current.as_ref() != Some(value),
        ToolJsonPatch::Omitted { .. } => omitted != Some(true),
    }
}

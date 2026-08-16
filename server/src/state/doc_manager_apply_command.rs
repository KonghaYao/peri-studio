//! 命令应用（`doc_manager.rs` 拆分，§8.2 提交点纪律）。
//!
//! 职责边界：[`apply_command`]（DocCommand 应用：命令分派 → 写 doc →
//! persist 落盘/广播 → gap 上报，§6.4 事务顺序）与 entry 侧命令分组
//! [`apply_entry_group`]（entry/权限/elicitation 命令组）；turn 侧命令组
//! 见 `doc_manager_apply_turn.rs`（[`apply_turn_group`]）。
//!
//! 拆分动机（结构拆分，行为不变）：原 `doc_manager.rs` 2014 行超限，`match`
//! 分支按主题提取为两个同步分组函数（分支体逐字保留，参数仅 `pair/agg/cmd`，
//! 无 await），分派与 persist 收尾保持原语义。

use std::sync::Arc;

use tokio::sync::{mpsc, RwLock};
use tracing::trace;
use yrs::WriteTxn;

use peri_studio_proto::schema::{ActiveTurnProjection, ToolCallStatus, TurnStatus};

use crate::state::aggregator::{Aggregator, ApplyReason, ApplyResult};
use crate::state::chat_writer;
use crate::state::doc_manager::{DocCommand, DocUpdate, SubmitError, SubmitResult, UpdateSink};
use crate::state::doc_pair::DocPair;
use crate::state::permission::{self, CasOutcome};
use crate::state::registry::RegistryState;

use super::doc_manager_apply_event::{
    bump_control_projection, command_kind, is_terminal_turn, migrate_permission_tool,
    read_session_active_turn,
};
use super::doc_manager_apply_turn::apply_turn_group;
use super::doc_manager_persist::{persist_and_broadcast, report_gap};

#[allow(clippy::too_many_arguments)]
pub(crate) async fn apply_command(

    chat_id: &str,
    pair: &mut DocPair,
    agg: &mut Aggregator,
    cmd: DocCommand,
    chat_updates: &mut mpsc::UnboundedReceiver<Vec<u8>>,
    control_updates: &mut mpsc::UnboundedReceiver<Vec<u8>>,
    sink: &Arc<dyn UpdateSink>,
    broadcast: &Arc<RwLock<Vec<mpsc::UnboundedSender<DocUpdate>>>>,
    registry: &RegistryState,
    persist_retry: &mut Vec<DocUpdate>,
) -> SubmitResult {
    let result = match &cmd {
        DocCommand::ObserveStreamFrame { .. }
        | DocCommand::RegisterUserEntry { .. }
        | DocCommand::RegisterPendingPromptEntry { .. }
        | DocCommand::SetPromptEntryDelivery { .. }
        | DocCommand::ResolvePermission { .. }
        | DocCommand::ExpirePermission { .. }
        | DocCommand::ExpirePendingPermissions
        | DocCommand::RegisterElicitation { .. }
        | DocCommand::BeginElicitationResponse { .. }
        | DocCommand::CompleteElicitationResponse { .. }
        | DocCommand::ExpirePendingElicitations { .. } => apply_entry_group(pair, agg, &cmd),
        _ => {
            // 短路拒绝（结构拆分时从 apply_turn_group 提升，保持 HEAD 语义：
            // 直接返回 Rejected，不执行 persist 收尾）。条件为纯读
            // pair.stream 状态，提前判定不改变任何投影行为。
            match &cmd {
                DocCommand::BeginLoadReplay { .. } if pair.stream.replay_active => {
                    return SubmitResult::Rejected(SubmitError::InvalidState);
                }
                DocCommand::ResumeAfterGap if pair.stream.uncalibratable => {
                    return SubmitResult::Rejected(SubmitError::InvalidState);
                }
                _ => {}
            }
            apply_turn_group(pair, agg, &cmd)
        }
    };

    let ok = persist_and_broadcast(
        chat_id,
        chat_updates,
        control_updates,
        sink,
        broadcast,
        registry,
        persist_retry,
    )
    .await;
    // gap 上报（§9.4）：与 apply_event/flush_batch 对齐——命令路径同样可能
    // 置位 gap_dirty（BeginLoadReplay 显式重建、ResumeAfterGap 追平恢复），
    // 须在本命令处理周期内写回 registry，不依赖后续事件到达。
    report_gap(chat_id, pair, registry).await;
    trace!(
        chat_id,
        cmd = command_kind(&cmd),
        applied = result.applied,
        "command applied"
    );
    if !ok {
        SubmitResult::PersistFailed
    } else {
        SubmitResult::Applied(result)
    }
}

fn apply_entry_group(pair: &mut DocPair, agg: &mut Aggregator, cmd: &DocCommand) -> ApplyResult {
    match cmd {
        DocCommand::ObserveStreamFrame { epoch, seq } => {
            agg.observe_stream_frame(pair, *epoch, *seq)
        }
        DocCommand::RegisterUserEntry {
            turn_id,
            entry_id,
            text,
            author_user_id,
            source_command_id,
            created_at,
        } => {
            let mut txn = pair.chat_txn();
            let root = txn.get_or_insert_map(crate::state::factory::ROOT);
            let registration = chat_writer::create_user_entry(
                &mut txn,
                &root,
                turn_id,
                entry_id,
                text,
                author_user_id.as_deref(),
                Some(source_command_id),
                created_at,
            );
            let applied = match registration {
                chat_writer::UserEntryRegistration::Created
                | chat_writer::UserEntryRegistration::Correlated => ApplyResult {
                    applied: true,
                    reason: None,
                },
                chat_writer::UserEntryRegistration::Duplicate => ApplyResult {
                    applied: false,
                    reason: Some(ApplyReason::DuplicateIdempotent),
                },
                chat_writer::UserEntryRegistration::SourceCommandConflict => ApplyResult {
                    applied: false,
                    reason: Some(ApplyReason::SourceCommandConflict),
                },
            };
            if applied.applied {
                chat_writer::bump_projection_version(&mut txn, &root);
            }
            drop(txn);
            // control 侧：active_turn 注册（§7.2 accepting）+ 输入预测失效。
            if applied.reason != Some(ApplyReason::SourceCommandConflict) {
                let mut txn = pair.session_txn();
                let root = txn.get_or_insert_map(crate::state::factory::ROOT);
                let active = ActiveTurnProjection {
                    turn_id: turn_id.clone(),
                    turn_status: TurnStatus::Accepting,
                    updated_at: created_at.clone(),
                };
                chat_writer::set_active_turn(&mut txn, &root, Some(&active));
                chat_writer::clear_input_prediction(&mut txn, &root);
                chat_writer::bump_projection_version(&mut txn, &root);
            }
            applied
        }
        DocCommand::ResolvePermission {
            permission_id,
            decision,
        } => {
            let context = permission::context(pair, permission_id);
            if context
                .as_ref()
                .is_some_and(|(status, _, _)| status == "pending")
            {
                let linked_tool = context.as_ref().and_then(|(_, id, _)| id.as_deref());
                migrate_permission_tool(
                    pair,
                    linked_tool,
                    match decision {
                        peri_studio_proto::action::PermissionDecision::Allow
                            if linked_tool.is_some_and(|id| {
                                permission::pending_count_for_tool(pair, id) > 1
                            }) =>
                        {
                            ToolCallStatus::AwaitingPermission
                        }
                        peri_studio_proto::action::PermissionDecision::Allow => ToolCallStatus::Running,
                        peri_studio_proto::action::PermissionDecision::Deny => {
                            ToolCallStatus::Cancelled
                        }
                    },
                );
            }
            match permission::resolve(pair, permission_id, *decision) {
                CasOutcome::Migrated => {
                    let no_pending_left = permission::pending_count(pair) == 0;
                    let mut txn = pair.session_txn();
                    let root = txn.get_or_insert_map(crate::state::factory::ROOT);
                    if *decision == peri_studio_proto::action::PermissionDecision::Deny {
                        chat_writer::set_active_turn_status_if(
                            &mut txn,
                            &root,
                            "awaitingPermission",
                            "cancelled",
                        );
                    } else if no_pending_left {
                        chat_writer::set_active_turn_status_if(
                            &mut txn,
                            &root,
                            "awaitingPermission",
                            "running",
                        );
                    }
                    chat_writer::bump_projection_version(&mut txn, &root);
                    ApplyResult {
                        applied: true,
                        reason: None,
                    }
                }
                CasOutcome::Duplicate => ApplyResult {
                    applied: false,
                    reason: Some(
                        if context.as_ref().and_then(|(_, _, stored)| *stored) == Some(*decision) {
                            ApplyReason::PermissionDecisionReplay
                        } else {
                            ApplyReason::DuplicateIdempotent
                        },
                    ),
                },
                CasOutcome::Expired => ApplyResult {
                    applied: false,
                    reason: None,
                },
                CasOutcome::Unknown => ApplyResult {
                    applied: false,
                    reason: Some(ApplyReason::UnknownPermission),
                },
            }
        }
        DocCommand::RegisterPendingPromptEntry {
            turn_id,
            entry_id,
            text,
            author_user_id,
            source_command_id,
            payload_fingerprint,
            created_at,
        } => {
            let mut txn = pair.chat_txn();
            let root = txn.get_or_insert_map(crate::state::factory::ROOT);
            let registration = chat_writer::create_pending_prompt_entry(
                &mut txn,
                &root,
                turn_id,
                entry_id,
                text,
                author_user_id.as_deref(),
                source_command_id,
                payload_fingerprint,
                created_at,
            );
            let applied = match registration {
                chat_writer::UserEntryRegistration::Created
                | chat_writer::UserEntryRegistration::Correlated => ApplyResult {
                    applied: true,
                    reason: None,
                },
                chat_writer::UserEntryRegistration::Duplicate => ApplyResult {
                    applied: false,
                    reason: Some(ApplyReason::DuplicateIdempotent),
                },
                chat_writer::UserEntryRegistration::SourceCommandConflict => ApplyResult {
                    applied: false,
                    reason: Some(ApplyReason::SourceCommandConflict),
                },
            };
            if applied.applied {
                chat_writer::bump_projection_version(&mut txn, &root);
            }
            drop(txn);
            if applied.reason != Some(ApplyReason::SourceCommandConflict) {
                let mut txn = pair.session_txn();
                let root = txn.get_or_insert_map(crate::state::factory::ROOT);
                let active = ActiveTurnProjection {
                    turn_id: turn_id.clone(),
                    turn_status: TurnStatus::Accepting,
                    updated_at: created_at.clone(),
                };
                chat_writer::set_active_turn(&mut txn, &root, Some(&active));
                chat_writer::clear_input_prediction(&mut txn, &root);
                chat_writer::bump_projection_version(&mut txn, &root);
            }
            applied
        }
        DocCommand::SetPromptEntryDelivery {
            entry_id,
            delivery_state,
            delivery_error_code,
            completed_at,
        } => {
            let (active_turn_id, active_turn_status) = read_session_active_turn(pair);
            let mut txn = pair.chat_txn();
            let root = txn.get_or_insert_map(crate::state::factory::ROOT);
            let entry_turn_id = chat_writer::prompt_entry_turn_id(&txn, &root, entry_id);
            let entry_applied = chat_writer::set_prompt_entry_delivery(
                &mut txn,
                &root,
                entry_id,
                delivery_state,
                delivery_error_code.as_deref(),
                completed_at.as_deref(),
            );
            if entry_applied {
                chat_writer::bump_projection_version(&mut txn, &root);
            }
            drop(txn);

            // A definite pre-dispatch failure terminates the exact active turn
            // without fabricating an assistant entry. Duplicate Chat evidence
            // must still be able to repair a control update lost in a crash.
            let should_fail_turn = delivery_state == "failed_not_delivered"
                && entry_turn_id.is_some()
                && entry_turn_id == active_turn_id
                && !is_terminal_turn(&active_turn_status);
            if should_fail_turn {
                let mut txn = pair.session_txn();
                let root = txn.get_or_insert_map(crate::state::factory::ROOT);
                let active = ActiveTurnProjection {
                    turn_id: entry_turn_id.expect("checked"),
                    turn_status: TurnStatus::Failed,
                    updated_at: completed_at
                        .clone()
                        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                };
                chat_writer::set_active_turn(&mut txn, &root, Some(&active));
                chat_writer::bump_projection_version(&mut txn, &root);
            }
            let applied = entry_applied || should_fail_turn;
            ApplyResult {
                applied,
                reason: (!applied).then_some(ApplyReason::DuplicateIdempotent),
            }
        }
        DocCommand::ExpirePermission { permission_id } => {
            let context = permission::context(pair, permission_id);
            if context
                .as_ref()
                .is_some_and(|(status, _, _)| status == "pending")
            {
                migrate_permission_tool(
                    pair,
                    context.as_ref().and_then(|(_, id, _)| id.as_deref()),
                    ToolCallStatus::Cancelled,
                );
            }
            match permission::expire(pair, permission_id) {
                CasOutcome::Migrated => {
                    let no_pending_left = permission::pending_count(pair) == 0;
                    let mut txn = pair.session_txn();
                    let root = txn.get_or_insert_map(crate::state::factory::ROOT);
                    if no_pending_left {
                        chat_writer::set_active_turn_status_if(
                            &mut txn,
                            &root,
                            "awaitingPermission",
                            "cancelled",
                        );
                    }
                    chat_writer::bump_projection_version(&mut txn, &root);
                    ApplyResult {
                        applied: true,
                        reason: None,
                    }
                }
                CasOutcome::Duplicate => ApplyResult {
                    applied: false,
                    reason: Some(ApplyReason::DuplicateIdempotent),
                },
                CasOutcome::Expired => ApplyResult {
                    applied: false,
                    reason: None,
                },
                CasOutcome::Unknown => ApplyResult {
                    applied: false,
                    reason: Some(ApplyReason::UnknownPermission),
                },
            }
        }
        DocCommand::ExpirePendingPermissions => {
            for tool_call_id in permission::pending_tool_ids(pair) {
                migrate_permission_tool(
                    pair,
                    Some(tool_call_id.as_str()),
                    ToolCallStatus::Cancelled,
                );
            }
            let migrated = permission::expire_all_pending(pair);
            if migrated > 0 {
                bump_control_projection(pair);
                ApplyResult {
                    applied: true,
                    reason: None,
                }
            } else {
                ApplyResult {
                    applied: false,
                    reason: None,
                }
            }
        }
        DocCommand::RegisterElicitation {
            elicitation,
            epoch,
            seq,
        } => {
            let stream = agg.observe_stream_frame(pair, *epoch, *seq);
            if !stream.applied {
                // HEAD 语义为 `return SubmitResult::Applied(stream)`（短路
                // 不 persist）；拆分后统一走收尾（stream 即 ApplyResult），
                // persist 空批次无副作用，对外返回值逐位一致。
                return stream;
            }
            let applied = crate::state::elicitation::register(pair, elicitation);
            if applied {
                crate::state::elicitation::bump_projection(pair);
            }
            ApplyResult {
                applied,
                reason: (!applied).then_some(ApplyReason::DuplicateIdempotent),
            }
        }
        DocCommand::BeginElicitationResponse {
            elicitation_id,
            action,
            updated_at,
        } => match crate::state::elicitation::begin_response(
            pair,
            elicitation_id,
            *action,
            updated_at,
        ) {
            crate::state::elicitation::ElicitationCasOutcome::Migrated => {
                crate::state::elicitation::bump_projection(pair);
                ApplyResult {
                    applied: true,
                    reason: None,
                }
            }
            crate::state::elicitation::ElicitationCasOutcome::ReplaySame => ApplyResult {
                applied: false,
                reason: Some(ApplyReason::ElicitationResponseReplay),
            },
            crate::state::elicitation::ElicitationCasOutcome::Conflict => ApplyResult {
                applied: false,
                reason: Some(ApplyReason::ElicitationResponseConflict),
            },
            crate::state::elicitation::ElicitationCasOutcome::Expired => ApplyResult {
                applied: false,
                reason: Some(ApplyReason::ElicitationExpired),
            },
            crate::state::elicitation::ElicitationCasOutcome::Unknown => ApplyResult {
                applied: false,
                reason: Some(ApplyReason::UnknownElicitation),
            },
        },
        DocCommand::CompleteElicitationResponse {
            elicitation_id,
            updated_at,
        } => {
            let applied = crate::state::elicitation::complete(pair, elicitation_id, updated_at);
            if applied {
                crate::state::elicitation::bump_projection(pair);
            }
            ApplyResult {
                applied,
                reason: (!applied).then_some(ApplyReason::DuplicateIdempotent),
            }
        }
        DocCommand::ExpirePendingElicitations { updated_at } => {
            let migrated = crate::state::elicitation::expire_all_pending(pair, updated_at);
            if migrated > 0 {
                crate::state::elicitation::bump_projection(pair);
            }
            ApplyResult {
                applied: migrated > 0,
                reason: None,
            }
        }
        // entry 组外命令由 apply_command 分派到 apply_turn_group；Registry 系
        // 命令在 submit_command 已路由到 registry 写者，二者均到不了这里。
        _ => unreachable!("entry group 外命令不应到达：分派层保证"),
    }
}

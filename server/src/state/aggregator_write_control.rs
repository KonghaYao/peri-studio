//! 聚合器写入族·control 侧（`aggregator.rs` 拆分，§6.4 事务顺序）。
//!
//! 职责边界：[`Aggregator::write_control_side`]——从 `write` 提取的 control
//! Doc 写入：permission CAS（resolve/expire 原语自开事务）、session 列表
//! diff 投影、agent 状态/配置/用量/活动/预测/计划/能力与会话元信息写入。
//! 须在 chat 事务 drop 后执行（§6.4 固定顺序）。
//!
//! 拆分动机（结构拆分，行为不变）：原 `aggregator.rs` 2201 行超限，按主题
//! 拆分；本文件为 `write` 函数按事务边界拆出的后半（CAS 类写入 + control
//! 事务），逻辑逐字保留。

use yrs::{Map, Transact, WriteTxn};

use peri_studio_proto::action::PermissionDecision;
use peri_studio_proto::schema::{ActiveTurnProjection, ToolCallStatus, TurnStatus};

use crate::state::chat_writer;
use crate::state::doc_pair::DocPair;
use crate::state::factory::ROOT;
use crate::state::normalized::{EventBody, NormalizedEvent};
use crate::state::permission::{self, CasOutcome};
use crate::state::permission_evidence::summarize_tool_input;
use crate::state::question::{self, QuestionCasOutcome};
use crate::state::session_list;

use super::aggregator::Aggregator;
use super::aggregator_write_catalog::{
    write_agent_activity, write_agent_plan, write_capabilities, write_chat_info, AgentActivityWrite,
};
use super::aggregator_write_question::write_question_requested;
use super::aggregator_write_helpers::{
    write_agent_config, write_agent_status, write_agent_usage, write_input_prediction,
    write_permission_request, AgentUsageWrite,
};

impl Aggregator {
    // control 侧写入：CAS 类自开事务（permission 原语内部管理），其余在
    // 一次 control 事务内；须在 chat 事务 drop 后（§6.4 固定顺序）。
    pub(crate) fn write_control_side(
        &self,
        pair: &mut DocPair,
        ev: &NormalizedEvent,
        replay_active: bool,
    ) {
        if matches!(
            &ev.body,
            EventBody::PeriTaskStarted { .. }
                | EventBody::PeriTaskCompleted { .. }
                | EventBody::PeriTaskCancelled { .. }
        ) {
            let active_turn_id = self
                .read_active_turn(pair)
                .map(|active| active.turn_id);
            let mut txn = pair.session_txn();
            let root = txn.get_or_insert_map(ROOT);
            if self.apply_peri_task_event(
                &mut txn,
                &root,
                ev,
                active_turn_id.as_deref(),
            ) {
                chat_writer::bump_projection_version(&mut txn, &root);
            }
            return;
        }
        if ev.subagent_scoped() {
            return;
        }
        // control 侧写入：CAS 类自开事务（permission 原语内部管理），其余在
        // 一次 control 事务内；须在 chat 事务 drop 后（§6.4 固定顺序）。
        match &ev.body {
            EventBody::PermissionResolved {
                permission_id,
                decision,
            } => {
                // CAS：pending → resolved 原子一次（§7.4 规则 4）；Migrated 时
                // 由原语写入 decision 与状态，聚合器补 bump。
                if permission::resolve(pair, permission_id, *decision) == CasOutcome::Migrated {
                    // §7.2 状态推进：决议后无其他 pending → awaitingPermission
                    // → running（参考实现 resolve(allow) 语义）。计数在写事务
                    // 前完成（yrs 同 doc 事务互斥）。
                    let no_pending_left = permission::pending_count(pair) == 0;
                    let mut txn = pair.session_txn();
                    let root = txn.get_or_insert_map(ROOT);
                    if *decision == PermissionDecision::Deny {
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
                }
            }
            EventBody::PermissionExpired { permission_id } => {
                if permission::expire(pair, permission_id) == CasOutcome::Migrated {
                    // §7.2 状态推进：无其他 pending → awaitingPermission →
                    // cancelled（参考实现 expire 语义：未决议权限过期即 turn
                    // 取消）。
                    let no_pending_left = permission::pending_count(pair) == 0;
                    let mut txn = pair.session_txn();
                    let root = txn.get_or_insert_map(ROOT);
                    if no_pending_left {
                        // 未决议权限全部过期 → 该 turn 取消（参考实现 expire
                        // 语义）；仅当状态仍为 awaitingPermission 时推进。
                        chat_writer::set_active_turn_status_if(
                            &mut txn,
                            &root,
                            "awaitingPermission",
                            "cancelled",
                        );
                    }
                    chat_writer::bump_projection_version(&mut txn, &root);
                }
            }
            EventBody::QuestionRequested {
                question_id,
                description,
                questions,
                expires_at,
                ..
            } => {
                let mut txn = pair.session_txn();
                let root = txn.get_or_insert_map(ROOT);
                write_question_requested(
                    &mut txn,
                    &root,
                    question_id,
                    questions,
                    description.as_deref(),
                    expires_at,
                );
                chat_writer::bump_projection_version(&mut txn, &root);
            }
            EventBody::QuestionResolved {
                question_id,
                answers,
            } => {
                if question::respond(pair, question_id, answers) == QuestionCasOutcome::Migrated {
                    let mut txn = pair.session_txn();
                    let root = txn.get_or_insert_map(ROOT);
                    chat_writer::bump_projection_version(&mut txn, &root);
                }
            }
            EventBody::QuestionExpired { question_id } => {
                if question::expire(pair, question_id) == QuestionCasOutcome::Migrated {
                    let mut txn = pair.session_txn();
                    let root = txn.get_or_insert_map(ROOT);
                    chat_writer::bump_projection_version(&mut txn, &root);
                }
            }
            EventBody::SessionListResponse { entries } => {
                // 预读（写事务前完成，避免并发事务 panic，§7.4）。
                let (current, loaded) = {
                    let rt = pair.session.transact();
                    match chat_writer::root_map_read(&rt) {
                        Some(rr) => (
                            session_list::read_current(&rt, &rr),
                            session_list::read_loaded(&rt, &rr),
                        ),
                        None => (std::collections::HashMap::new(), false),
                    }
                };
                let d = session_list::diff(&current, entries);
                if session_list::should_write_after_list_response(loaded, &d) {
                    let mut txn = pair.session_txn();
                    let root = txn.get_or_insert_map(ROOT);
                    if session_list::diff_has_map_changes(&d) {
                        session_list::apply_diff(&mut txn, &root, &d);
                    }
                    if !loaded {
                        session_list::mark_loaded(&mut txn, &root);
                    }
                    chat_writer::bump_projection_version(&mut txn, &root);
                }
            }
            _ => {
                let permission_evidence = match &ev.body {
                    EventBody::PermissionRequested {
                        tool_call_id: Some(tool_call_id),
                        ..
                    } => {
                        let txn = pair.chat.transact();
                        chat_writer::tool_call_projection(&txn, tool_call_id)
                            .and_then(|tool| summarize_tool_input(tool.arguments.as_ref()))
                            .map(|summary| (tool_call_id.clone(), summary))
                    }
                    _ => None,
                };
                let mut txn = pair.session_txn();
                let root = txn.get_or_insert_map(ROOT);
                match &ev.body {
                    EventBody::SessionListResponse { .. } => {
                        unreachable!("SessionListResponse 已在外层分支处理")
                    }
                    EventBody::QuestionRequested { .. }
                    | EventBody::QuestionResolved { .. }
                    | EventBody::QuestionExpired { .. } => {
                        unreachable!("Question 事件已在外层分支处理")
                    }
                    EventBody::UserMessage {
                        turn_id,
                        created_at,
                        ..
                    } => {
                        if turn_id.is_empty() && ev.callback_semantics().is_some() {
                            // callback 流不注册 active_turn（§6.5 例外）。
                        } else {
                        chat_writer::clear_input_prediction(&mut txn, &root);
                        // active_turn 注册（§7.2：turn 从 accepting 开始）。
                        let active = ActiveTurnProjection {
                            turn_id: turn_id.clone(),
                            turn_status: TurnStatus::Accepting,
                            updated_at: created_at.clone(),
                        };
                        chat_writer::set_active_turn(&mut txn, &root, Some(&active));
                        chat_writer::bump_projection_version(&mut txn, &root);
                        }
                    }
                    EventBody::PermissionRequested {
                        permission_id,
                        turn_id,
                        tool_call_id,
                        title,
                        description,
                        options,
                        option_ids,
                        expires_at,
                        ..
                    } => {
                        write_permission_request(
                            &mut txn,
                            &root,
                            permission_id,
                            turn_id,
                            tool_call_id.as_deref(),
                            title,
                            description.as_deref(),
                            options,
                            option_ids.as_deref(),
                            permission_evidence.as_ref().map(|(tool_call_id, summary)| {
                                (tool_call_id.as_str(), summary.as_str())
                            }),
                            expires_at,
                        );
                        // §7.2 状态推进：权限请求发出 → 宿主等待决议
                        // （accepting/running → awaitingPermission；参考状态机
                        // accepting → running ⇄ awaitingPermission）。仅当请求
                        // 关联当前 active turn 时推进（防御：无关 turn 的请求
                        // 不改状态）。
                        let active_tid = root
                            .get(&txn, "session")
                            .and_then(|v| v.cast::<yrs::MapRef>().ok())
                            .and_then(|m| m.get(&txn, "active_turn_id"))
                            .and_then(|t| t.cast::<String>().ok());
                        if active_tid.as_deref() == Some(turn_id.as_str())
                            && !chat_writer::set_active_turn_status_if(
                                &mut txn,
                                &root,
                                "accepting",
                                "awaitingPermission",
                            )
                            && !chat_writer::set_active_turn_status_if(
                                &mut txn,
                                &root,
                                "running",
                                "awaitingPermission",
                            )
                        {
                            // 既非 accepting 也非 running：无状态推进（防御）。
                        }
                        chat_writer::bump_projection_version(&mut txn, &root);
                    }
                    EventBody::AgentStatus {
                        status,
                        public_error,
                        model,
                        context_window,
                        context_used,
                    } => {
                        write_agent_status(
                            &mut txn,
                            &root,
                            status,
                            public_error.as_ref(),
                            model.as_deref(),
                            *context_window,
                            *context_used,
                        );
                        chat_writer::bump_projection_version(&mut txn, &root);
                    }
                    EventBody::AgentConfig {
                        model,
                        effort,
                        config_options,
                    } => {
                        // model/effort 部分更新（跨任务契约）：None 不覆盖。
                        write_agent_config(
                            &mut txn,
                            &root,
                            model.as_deref(),
                            effort.as_deref(),
                            config_options.as_deref(),
                        );
                        chat_writer::bump_projection_version(&mut txn, &root);
                    }
                    EventBody::AgentUsage {
                        context_window,
                        context_used,
                        input_tokens,
                        output_tokens,
                        cache_creation_tokens,
                        cache_read_tokens,
                        request_id,
                        model,
                        stop_reason,
                    } => {
                        write_agent_usage(
                            &mut txn,
                            &root,
                            AgentUsageWrite {
                                context_window: *context_window,
                                context_used: *context_used,
                                input_tokens: *input_tokens,
                                output_tokens: *output_tokens,
                                cache_creation_tokens: *cache_creation_tokens,
                                cache_read_tokens: *cache_read_tokens,
                                request_id: request_id.as_deref(),
                                model: model.as_deref(),
                                stop_reason: stop_reason.as_deref(),
                            },
                        );
                        chat_writer::bump_projection_version(&mut txn, &root);
                    }
                    EventBody::AgentActivity {
                        kind,
                        status,
                        correlation_id,
                        label,
                        is_background,
                        metrics,
                        attributes,
                    } => {
                        if write_agent_activity(
                            &mut txn,
                            &root,
                            ev.epoch,
                            ev.seq,
                            &ev.ts,
                            AgentActivityWrite {
                                kind: *kind,
                                status: *status,
                                correlation_id: correlation_id.as_deref(),
                                label: label.as_deref(),
                                is_background: *is_background,
                                metrics,
                                attributes,
                            },
                        ) {
                            chat_writer::bump_projection_version(&mut txn, &root);
                        }
                    }
                    EventBody::InputPrediction { text } => {
                        if write_input_prediction(
                            &mut txn,
                            &root,
                            ev.epoch,
                            ev.seq,
                            &ev.ts,
                            text.as_deref(),
                        ) {
                            chat_writer::bump_projection_version(&mut txn, &root);
                        }
                    }
                    EventBody::AgentPlan { entries } => {
                        write_agent_plan(&mut txn, &root, entries);
                        chat_writer::bump_projection_version(&mut txn, &root);
                    }
                    EventBody::Capabilities {
                        capabilities,
                        descriptions,
                        skill_names,
                        mcp_skill_names,
                    } => {
                        write_capabilities(
                            &mut txn,
                            &root,
                            capabilities,
                            descriptions,
                            skill_names,
                            mcp_skill_names,
                        );
                        chat_writer::bump_projection_version(&mut txn, &root);
                    }
                    EventBody::SessionInfo {
                        title,
                        status,
                        active_turn_id,
                    } => {
                        write_chat_info(
                            &mut txn,
                            &root,
                            title.as_deref(),
                            *status,
                            active_turn_id.as_deref(),
                        );
                        chat_writer::bump_projection_version(&mut txn, &root);
                    }
                    EventBody::TurnTerminal {
                        turn_id,
                        status,
                        completed_at,
                        ..
                    } => {
                        let active = ActiveTurnProjection {
                            turn_id: turn_id.clone(),
                            turn_status: *status,
                            updated_at: completed_at.clone(),
                        };
                        chat_writer::set_active_turn(&mut txn, &root, Some(&active));
                        chat_writer::bump_projection_version(&mut txn, &root);
                    }
                    EventBody::MessageDelta { .. } | EventBody::ReasoningDelta { .. } => {
                        // §7.2 状态推进：内容增量到达 → accepting → running
                        // （参考实现：首条内容增量即 turn 开始运行）。回放
                        // 模式跳过（回放 turn 由 EndLoadReplay 终态化）。
                        if !replay_active
                            && chat_writer::set_active_turn_status_if(
                                &mut txn,
                                &root,
                                "accepting",
                                "running",
                            )
                        {
                            chat_writer::bump_projection_version(&mut txn, &root);
                        }
                    }
                    EventBody::ToolCallStarted { status, .. } => {
                        if !replay_active
                            && *status == ToolCallStatus::Running
                            && chat_writer::set_active_turn_status_if(
                                &mut txn,
                                &root,
                                "accepting",
                                "running",
                            )
                        {
                            chat_writer::bump_projection_version(&mut txn, &root);
                        }
                    }
                    EventBody::ToolCallUpdated { status, .. } => {
                        if !replay_active
                            && *status == Some(ToolCallStatus::Running)
                            && chat_writer::set_active_turn_status_if(
                                &mut txn,
                                &root,
                                "accepting",
                                "running",
                            )
                        {
                            chat_writer::bump_projection_version(&mut txn, &root);
                        }
                    }
                    EventBody::ToolCallPatched { patch, .. } => {
                        if !replay_active
                            && patch.status == Some(ToolCallStatus::Running)
                            && chat_writer::set_active_turn_status_if(
                                &mut txn,
                                &root,
                                "accepting",
                                "running",
                            )
                        {
                            chat_writer::bump_projection_version(&mut txn, &root);
                        }
                    }
                    EventBody::ToolCallCompleted { .. }
                    | EventBody::PermissionResolved { .. }
                    | EventBody::PermissionExpired { .. } => {
                        // 纯 chat 事件或已在外层单独处理（CAS）：无 control
                        // 写入。
                    }
                    EventBody::PeriTaskStarted { .. }
                    | EventBody::PeriTaskCompleted { .. }
                    | EventBody::PeriTaskCancelled { .. } => {
                        unreachable!("Peri task 已在外层分支处理")
                    }
                }
            }
        }
    }
}

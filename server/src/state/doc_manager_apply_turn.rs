//! 命令应用·turn 侧（`doc_manager.rs` 拆分，§7.2/§7.3/§8.5）。
//!
//! 职责边界：[`apply_turn_group`]（turn 终态/取消/中断、标题、agent 会话
//! 与扩展、load 回放命令组，§7.2/§7.3/§8.5）。
//!
//! 拆分动机（结构拆分，行为不变）：原 `doc_manager.rs` 2014 行超限，
//! `apply_command` 的 turn 侧 match 分支按主题提取为本文件的分组函数
//! （分支体逐字保留，参数仅 `pair/agg/cmd`，无 await）。

use yrs::{Array, Map, WriteTxn};

use peri_studio_proto::schema::{ActiveTurnProjection, EntryStatus, TurnStatus};

use crate::state::aggregator::{Aggregator, ApplyReason, ApplyResult};
use crate::state::chat_writer;
use crate::state::doc_manager::DocCommand;
use crate::state::doc_pair::DocPair;

use super::doc_manager_apply_event::{is_terminal_turn, read_session_active_turn};

pub(crate) fn apply_turn_group(pair: &mut DocPair, _agg: &mut Aggregator, cmd: &DocCommand) -> ApplyResult {
    match cmd {
        DocCommand::MarkTurnInterrupted { turn_id } => {
            // 读 active_turn：匹配且非终态 → 置 interrupted（§7.3）。
            let (active_tid, active_status) = read_session_active_turn(pair);
            let should_interrupt = active_tid.as_deref() == Some(turn_id.as_str())
                && !is_terminal_turn(&active_status);
            if !should_interrupt {
                ApplyResult {
                    applied: false,
                    reason: Some(ApplyReason::TurnTerminalGuard),
                }
            } else {
                let mut txn = pair.session_txn();
                let root = txn.get_or_insert_map(crate::state::factory::ROOT);
                let active = ActiveTurnProjection {
                    turn_id: turn_id.clone(),
                    turn_status: TurnStatus::Interrupted,
                    updated_at: chrono::Utc::now().to_rfc3339(),
                };
                chat_writer::set_active_turn(&mut txn, &root, Some(&active));
                chat_writer::bump_projection_version(&mut txn, &root);
                drop(txn);
                // chat 侧：assistant entry 置 cancelled（§7.2 中断收敛）。
                let mut txn = pair.chat_txn();
                let root = txn.get_or_insert_map(crate::state::factory::ROOT);
                chat_writer::migrate_entry_terminal(
                    &mut txn,
                    &root,
                    &format!("{turn_id}:assistant"),
                    EntryStatus::Cancelled,
                    &chrono::Utc::now().to_rfc3339(),
                    None,
                );
                chat_writer::cancel_nonterminal_tools_for_turn(&mut txn, &root, turn_id);
                chat_writer::bump_projection_version(&mut txn, &root);
                ApplyResult {
                    applied: true,
                    reason: None,
                }
            }
        }
        DocCommand::MarkTurnCancelling { turn_id } => {
            // 读 active_turn：匹配且非终态 → 置 cancelling（§7.2）。仅改
            // 状态字段（turn_id/updated_at 保持；终态由后续事件/命令覆盖）。
            let (active_tid, active_status) = read_session_active_turn(pair);
            let should_cancel = active_tid.as_deref() == Some(turn_id.as_str())
                && !is_terminal_turn(&active_status);
            if !should_cancel {
                ApplyResult {
                    applied: false,
                    reason: Some(ApplyReason::TurnTerminalGuard),
                }
            } else {
                let mut txn = pair.session_txn();
                let root = txn.get_or_insert_map(crate::state::factory::ROOT);
                let sm = root.get_or_init::<_, yrs::MapRef>(&mut txn, "session");
                sm.insert(&mut txn, "active_turn_status", "cancelling");
                chat_writer::bump_projection_version(&mut txn, &root);
                ApplyResult {
                    applied: true,
                    reason: None,
                }
            }
        }
        DocCommand::SetTurnTerminal {
            turn_id,
            status,
            completed_at,
        } => {
            // 终态守卫（§7.2）：active_turn 存在、turn_id 匹配且非终态才迁移。
            let (active_tid, active_status) = read_session_active_turn(pair);
            let requested_status = chat_writer::turn_status_str(*status);
            let same_turn = active_tid.as_deref() == Some(turn_id.as_str());
            if same_turn && active_status == requested_status {
                ApplyResult {
                    applied: false,
                    reason: Some(ApplyReason::DuplicateIdempotent),
                }
            } else if !same_turn || is_terminal_turn(&active_status) {
                ApplyResult {
                    applied: false,
                    reason: Some(ApplyReason::TerminalProjectionConflict),
                }
            } else {
                // control 侧：active_turn 终态迁移（§7.2）。
                let mut txn = pair.session_txn();
                let root = txn.get_or_insert_map(crate::state::factory::ROOT);
                let active = ActiveTurnProjection {
                    turn_id: turn_id.clone(),
                    turn_status: *status,
                    updated_at: completed_at.clone(),
                };
                chat_writer::set_active_turn(&mut txn, &root, Some(&active));
                chat_writer::bump_projection_version(&mut txn, &root);
                drop(txn);
                // chat 侧：assistant entry 终态迁移（§7.2 状态映射）。
                let entry_status = match status {
                    TurnStatus::Completed => EntryStatus::Completed,
                    TurnStatus::Failed => EntryStatus::Error,
                    TurnStatus::Cancelled | TurnStatus::Interrupted => EntryStatus::Cancelled,
                    _ => EntryStatus::Completed,
                };
                let mut txn = pair.chat_txn();
                let root = txn.get_or_insert_map(crate::state::factory::ROOT);
                chat_writer::migrate_entry_terminal(
                    &mut txn,
                    &root,
                    &format!("{turn_id}:assistant"),
                    entry_status,
                    completed_at,
                    None,
                );
                if matches!(status, TurnStatus::Cancelled | TurnStatus::Interrupted) {
                    chat_writer::cancel_nonterminal_tools_for_turn(&mut txn, &root, turn_id);
                }
                chat_writer::bump_projection_version(&mut txn, &root);
                ApplyResult {
                    applied: true,
                    reason: None,
                }
            }
        }
        DocCommand::UpdateTitle { title } => {
            let mut txn = pair.session_txn();
            let root = txn.get_or_insert_map(crate::state::factory::ROOT);
            let sm = root.get_or_init::<_, yrs::MapRef>(&mut txn, "session");
            sm.insert(&mut txn, "title", title.clone());
            chat_writer::bump_projection_version(&mut txn, &root);
            ApplyResult {
                applied: true,
                reason: None,
            }
        }
        DocCommand::CancelStaleAssistantEntry { turn_id, entry_id } => {
            let mut txn = pair.chat_txn();
            let root = txn.get_or_insert_map(crate::state::factory::ROOT);
            chat_writer::migrate_entry_terminal(
                &mut txn,
                &root,
                entry_id,
                EntryStatus::Cancelled,
                &chrono::Utc::now().to_rfc3339(),
                None,
            );
            chat_writer::bump_projection_version(&mut txn, &root);
            let _ = turn_id;
            ApplyResult {
                applied: true,
                reason: None,
            }
        }
        DocCommand::SetChatTerminal { status } => {
            let mut txn = pair.session_txn();
            let root = txn.get_or_insert_map(crate::state::factory::ROOT);
            let control = root.get_or_init::<_, yrs::MapRef>(&mut txn, "chat");
            control.insert(
                &mut txn,
                "status",
                crate::state::aggregator::chat_status_str(*status),
            );
            chat_writer::bump_projection_version(&mut txn, &root);
            ApplyResult {
                applied: true,
                reason: None,
            }
        }
        DocCommand::SetAgentSessionId { acp_session_id } => {
            // agent 投影写回（§5.4 agent map；binding 建立/恢复路径）。
            let mut txn = pair.session_txn();
            let root = txn.get_or_insert_map(crate::state::factory::ROOT);
            let am = root.get_or_init::<_, yrs::MapRef>(&mut txn, "agent");
            am.insert(&mut txn, "acp_session_id", acp_session_id.clone());
            chat_writer::bump_projection_version(&mut txn, &root);
            ApplyResult {
                applied: true,
                reason: None,
            }
        }
        DocCommand::SetAgentConfig {
            model,
            effort,
            config_options,
        } => {
            // agent 投影 model/effort（§5.4 agent map；部分更新——None
            // 不覆盖，与 AgentConfig 事件投影语义一致）。
            let mut txn = pair.session_txn();
            let root = txn.get_or_insert_map(crate::state::factory::ROOT);
            let am = root.get_or_init::<_, yrs::MapRef>(&mut txn, "agent");
            if let Some(m) = model {
                am.insert(&mut txn, "model", m.clone());
            }
            if let Some(e) = effort {
                am.insert(&mut txn, "effort", e.clone());
            }
            if let Some(options) = config_options {
                crate::state::aggregator::write_session_config_catalog(&mut txn, &am, options);
            }
            chat_writer::bump_projection_version(&mut txn, &root);
            ApplyResult {
                applied: true,
                reason: None,
            }
        }
        DocCommand::SetAgentExtensions { extensions } => {
            let mut txn = pair.session_txn();
            let root = txn.get_or_insert_map(crate::state::factory::ROOT);
            let agent = root.get_or_init::<_, yrs::MapRef>(&mut txn, "agent");
            let values = agent.get_or_init::<_, yrs::ArrayRef>(&mut txn, "extensions");
            for index in (0..values.len(&txn)).rev() {
                values.remove(&mut txn, index);
            }
            for extension in extensions {
                values.push_back(&mut txn, extension.clone());
            }
            chat_writer::bump_projection_version(&mut txn, &root);
            ApplyResult {
                applied: true,
                reason: None,
            }
        }
        DocCommand::EndLoadReplay => {
            // 全部回放 turn 终态化（历史 agent 消息无 TurnTerminal 事件）+
            // 退出回放模式。
            let completed_at = chrono::Utc::now().to_rfc3339();
            let turns = std::mem::take(&mut pair.stream.replay_turns);
            if !turns.is_empty() {
                let mut txn = pair.chat_txn();
                let root = txn.get_or_insert_map(crate::state::factory::ROOT);
                for turn_id in &turns {
                    chat_writer::migrate_entry_terminal(
                        &mut txn,
                        &root,
                        &format!("{turn_id}:assistant"),
                        EntryStatus::Completed,
                        &completed_at,
                        None,
                    );
                }
                chat_writer::bump_projection_version(&mut txn, &root);
            }
            // 回放 turn 的 control doc 投影终态化（§8.5）：回放期间
            // active_turn 重建为 accepting，但回放 turn 无真实
            // TurnTerminal 事件（进程重启打断）——不终态化则前端
            // isTurnActive("accepting") 恒真：恢复会话永久显示
            // 「Agent 正在工作」+ 输入框 loading。CAS 仅迁移
            // accepting → interrupted，不覆盖 load 后真实新 turn。
            if !turns.is_empty() {
                let mut txn = pair.session_txn();
                let root = txn.get_or_insert_map(crate::state::factory::ROOT);
                if chat_writer::set_active_turn_status_if(
                    &mut txn,
                    &root,
                    "accepting",
                    "interrupted",
                ) {
                    chat_writer::bump_projection_version(&mut txn, &root);
                }
            }
            pair.stream.replay_active = false;
            pair.stream.replay_turn = None;
            ApplyResult {
                applied: true,
                reason: None,
            }
        }
        DocCommand::BeginLoadReplay { acp_session_id } => {
            // replay_active 短路拒绝已提升到 apply_command 分派层
            // （SubmitResult::Rejected(InvalidState)，不执行 persist 收尾）。
            // §8.5 会话切换是替换当前视图，不是把目标历史追加到旧会话。
            // 通过覆盖根结构键产生可同步的 Yjs 更新；所有写入仍在本 chat
            // 单写者内，后续回放事件只会落入新结构。
            //
            // 清空语义对齐 Chat/Session 双 Doc 参考实现（clearChatDocContent
            // + clearSessionDocContent）：
            // - chat doc：entries/tool_calls 覆盖空结构；
            // - session doc：`session` map 换新（会话元信息与 active turn
            //   清空，load 成功后由 SessionInfo/set_active_turn 重建）；
            //   `agent` 保留（实例级状态 capabilities 不清——清空会永久丢）；
            //   `pending_permissions` 换空；
            //   `sessions` 保留（防侧边栏闪空）。
            {
                let mut txn = pair.chat_txn();
                let root = txn.get_or_insert_map(crate::state::factory::ROOT);
                root.insert(&mut txn, "entry_order", yrs::ArrayPrelim::default());
                root.insert(&mut txn, "entries", yrs::MapPrelim::default());
                root.insert(&mut txn, "tool_calls", yrs::MapPrelim::default());
                chat_writer::bump_projection_version(&mut txn, &root);
            }
            {
                let mut txn = pair.session_txn();
                let root = txn.get_or_insert_map(crate::state::factory::ROOT);
                // session map 换新：清全部会话元信息 + active turn 内嵌字段。
                let sm = root.get_or_init::<_, yrs::MapRef>(&mut txn, "session");
                for key in [
                    "session_id",
                    "title",
                    "status",
                    "active_turn_id",
                    "active_turn_status",
                    "active_turn_updated_at",
                    "created_at",
                    "updated_at",
                ] {
                    sm.remove(&mut txn, key);
                }
                // agent 保留：仅删旧会话绑定（acp_session_id 在 load 成功后
                // 由 switch_session 路径重建）。
                if let Some(am) = root
                    .get(&txn, "agent")
                    .and_then(|v| v.cast::<yrs::MapRef>().ok())
                {
                    am.remove(&mut txn, "acp_session_id");
                }
                root.insert(&mut txn, "pending_permissions", yrs::MapPrelim::default());
                root.insert(&mut txn, "pending_elicitations", yrs::MapPrelim::default());
                chat_writer::bump_projection_version(&mut txn, &root);
            }

            // 流状态：清除不可校准缺口（§8.5「不可校准只能经 load 消除」）与
            // 缺口计数——回放帧从新会话起点开始，旧流的缺口状态不再适用；
            // epoch/last_seq 水位保持（回放帧仍走正常判序）。
            pair.stream.uncalibratable = false;
            pair.stream.gap_count = 0;
            pair.stream.gap_dirty = true;

            // 新会话绑定（§8.5）：agent 投影的 acp_session_id 随切换更新
            // （参考实现 load 成功路径 `registry.forEachByRcsSession` 更新
            // acpSessionId 的等价物——BeginLoadReplay 即切换提交点，与
            // coordinator 的预绑定同步；load 失败由 restore_session 路径
            // 恢复旧值）。
            {
                let mut txn = pair.session_txn();
                let root = txn.get_or_insert_map(crate::state::factory::ROOT);
                let am = root.get_or_init::<_, yrs::MapRef>(&mut txn, "agent");
                am.insert(&mut txn, "acp_session_id", acp_session_id.clone());
                chat_writer::bump_projection_version(&mut txn, &root);
            }
            pair.stream.replay_active = true;
            pair.stream.replay_turn = None;
            pair.stream.replay_turns.clear();
            ApplyResult {
                applied: true,
                reason: None,
            }
        }
        DocCommand::ResumeAfterGap => {
            // uncalibratable 短路拒绝已提升到 apply_command 分派层
            // （SubmitResult::Rejected(InvalidState)，不执行 persist 收尾）。
            // 聚合器事实源判定（§8.5）：不可校准缺口只能经 load 显式重建
            // 消除——拒绝恢复（relay 不迁移 ChatState，chat 保持 gap 呈现，
            // TUI 提示「载入以校准」）；可校准 → 置 gap_dirty，尾部 report_gap
            // 清除 registry gap 标记并解除 ChatGap degraded 条件（断链置的
            // `Some(0)` 占位在此被 None 覆盖，与聚合器追平语义一致）。
            pair.stream.gap_dirty = true;
            ApplyResult {
                applied: true,
                reason: None,
            }
        }
        _ => unreachable!("registry 命令已路由到 registry 写者"),
    }
}

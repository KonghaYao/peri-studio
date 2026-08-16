//! DocManager apply_event 测试·投递判定与回放（§8.5 命令路径上的
//! 事件应用）：delivery failed/unknown 对 active_turn 的终态化判定
//! （不误伤更新的 turn）、`session/load` 回放命令流（BeginLoadReplay →
//! 历史 chunk 归位 → EndLoadReplay 终态化）、回放首帧增量合成占位
//! turn（REPLAY_NEEDS_TURN）、turn_terminal 仅对同一持久化结果幂等。

use std::sync::Arc;

use tokio::time::Duration as TokioDuration;

use peri_studio_proto::conn::DocId;

use crate::state::doc_manager::{DocCommand, DocManager, SubmitResult};

use super::util::*;

#[tokio::test]
async fn failed_not_delivered_terminalizes_the_exact_projected_turn() {
    let sink = MemSink::default();
    let mgr = DocManager::new(cfg(), Arc::new(sink.clone()));
    open(&mgr, "s1").await;
    assert!(matches!(
        mgr.submit_command(
            "s1",
            DocCommand::RegisterPendingPromptEntry {
                turn_id: "turn-1".into(),
                entry_id: "turn-1:user".into(),
                text: "never dispatched".into(),
                author_user_id: None,
                source_command_id: "11111111-1111-1111-1111-111111111111".into(),
                payload_fingerprint: "fingerprint".into(),
                created_at: "2026-08-14T00:00:00Z".into(),
            },
        )
        .await,
        SubmitResult::Applied(result) if result.applied
    ));
    assert_eq!(
        projected_active_turn_status(&sink, "s1").await.as_deref(),
        Some("accepting")
    );

    assert!(matches!(
        mgr.submit_command(
            "s1",
            DocCommand::SetPromptEntryDelivery {
                entry_id: "turn-1:user".into(),
                delivery_state: "failed_not_delivered".into(),
                delivery_error_code: Some("AGENT_UNAVAILABLE".into()),
                completed_at: Some("2026-08-14T00:00:01Z".into()),
            },
        )
        .await,
        SubmitResult::Applied(result) if result.applied
    ));
    assert_eq!(
        projected_active_turn_status(&sink, "s1").await.as_deref(),
        Some("failed"),
        "a definite non-delivery verdict must not leave the UI turn active"
    );
}

#[tokio::test]
async fn delivery_unknown_does_not_claim_the_active_turn_has_stopped() {
    let sink = MemSink::default();
    let mgr = DocManager::new(cfg(), Arc::new(sink.clone()));
    open(&mgr, "s1").await;
    let _ = mgr
        .submit_command(
            "s1",
            DocCommand::RegisterPendingPromptEntry {
                turn_id: "turn-1".into(),
                entry_id: "turn-1:user".into(),
                text: "possibly dispatched".into(),
                author_user_id: None,
                source_command_id: "11111111-1111-1111-1111-111111111111".into(),
                payload_fingerprint: "fingerprint".into(),
                created_at: "2026-08-14T00:00:00Z".into(),
            },
        )
        .await;
    let _ = mgr
        .submit_command(
            "s1",
            DocCommand::SetPromptEntryDelivery {
                entry_id: "turn-1:user".into(),
                delivery_state: "delivery_unknown".into(),
                delivery_error_code: Some("DELIVERY_UNKNOWN".into()),
                completed_at: None,
            },
        )
        .await;
    assert_eq!(
        projected_active_turn_status(&sink, "s1").await.as_deref(),
        Some("accepting")
    );
}

#[tokio::test]
async fn old_failed_prompt_does_not_terminalize_a_newer_active_turn() {
    let sink = MemSink::default();
    let mgr = DocManager::new(cfg(), Arc::new(sink.clone()));
    open(&mgr, "s1").await;
    for (turn_id, command_id) in [
        ("turn-1", "11111111-1111-1111-1111-111111111111"),
        ("turn-2", "22222222-2222-2222-2222-222222222222"),
    ] {
        let result = mgr
            .submit_command(
                "s1",
                DocCommand::RegisterPendingPromptEntry {
                    turn_id: turn_id.into(),
                    entry_id: format!("{turn_id}:user"),
                    text: format!("message for {turn_id}"),
                    author_user_id: None,
                    source_command_id: command_id.into(),
                    payload_fingerprint: format!("fingerprint-{turn_id}"),
                    created_at: "2026-08-14T00:00:00Z".into(),
                },
            )
            .await;
        assert!(matches!(result, SubmitResult::Applied(result) if result.applied));
    }

    let result = mgr
        .submit_command(
            "s1",
            DocCommand::SetPromptEntryDelivery {
                entry_id: "turn-1:user".into(),
                delivery_state: "failed_not_delivered".into(),
                delivery_error_code: Some("AGENT_UNAVAILABLE".into()),
                completed_at: Some("2026-08-14T00:00:01Z".into()),
            },
        )
        .await;
    assert!(matches!(result, SubmitResult::Applied(result) if result.applied));
    assert_eq!(
        projected_active_turn(&sink, "s1").await,
        Some(("turn-2".into(), "accepting".into())),
        "a late verdict may only terminalize the exact active turn"
    );
}

// ---------------------------------------------------------------------------
// session/load 回放模式（§8.5 显式重建）：BeginLoadReplay → 历史 chunk 按
// 回放序归位（load:{seq}）→ EndLoadReplay 全部终态化
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn load_replay_command_flow_projects_and_terminates_history() {
    use yrs::updates::decoder::Decode as _;
    use yrs::{Array, GetString, Map, ReadTxn, Transact};

    // 镜像从 MemSink 落盘记录重放（含 writer 启动基线）。
    let sink = MemSink::default();
    let mgr = DocManager::new(cfg(), Arc::new(sink.clone()));
    open(&mgr, "s1").await;

    // 先写入当前会话内容；load 是替换当前会话，旧 Yjs 内容不得与回放混合。
    let r = mgr
        .submit_command(
            "s1",
            DocCommand::RegisterUserEntry {
                turn_id: "old-turn".into(),
                entry_id: "old-turn:user".into(),
                text: "旧会话内容".into(),
                author_user_id: None,
                source_command_id: "old-command".into(),
                created_at: "2026-08-10T00:00:00Z".into(),
            },
        )
        .await;
    assert!(matches!(r, SubmitResult::Applied(a) if a.applied));

    // 回放模式开始（coordinator 在 session/load 请求前提交）。
    let r = mgr
        .submit_command(
            "s1",
            DocCommand::BeginLoadReplay {
                acp_session_id: "acp-1".into(),
            },
        )
        .await;
    assert!(matches!(r, SubmitResult::Applied(a) if a.applied));

    // 历史回放流（真实 peri 重放形态：无 turnId 的 user/agent chunk）。
    assert!(matches!(
        mgr.submit_event(replay_user("s1", 1, "历史问题1")).await,
        SubmitResult::Applied(_)
    ));
    assert!(matches!(
        mgr.submit_event(replay_delta("s1", 2, "历史回答1")).await,
        SubmitResult::Applied(_)
    ));
    assert!(matches!(
        mgr.submit_event(replay_user("s1", 3, "历史问题2")).await,
        SubmitResult::Applied(_)
    ));
    assert!(matches!(
        mgr.submit_event(replay_delta("s1", 4, "历史回答2")).await,
        SubmitResult::Applied(_)
    ));

    // 回放结束（load 响应到达后提交）：全部回放 turn 终态化。
    let r = mgr.submit_command("s1", DocCommand::EndLoadReplay).await;
    assert!(matches!(r, SubmitResult::Applied(a) if a.applied));

    // 批次 flush（delta 类入队即返回，需推进批次窗口）。
    tokio::time::advance(TokioDuration::from_millis(20)).await;
    tokio::task::yield_now().await;

    // 重放落盘记录 → 镜像 chat doc，验证条目归位与终态。
    let mirror = yrs::Doc::new();
    let updates = sink.updates.lock().await;
    for (doc, update) in updates.iter() {
        if *doc == DocId::chat("s1") {
            let parsed = yrs::Update::decode_v1(update).unwrap();
            let mut txn = mirror.transact_mut();
            txn.apply_update(parsed).unwrap();
        }
    }
    drop(updates);
    let txn = mirror.transact();
    let root = txn.get_map("root").expect("root map");
    let entries = root
        .get(&txn, "entries")
        .expect("entries map")
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(entries.iter(&txn).count(), 4, "2 user + 2 assistant");
    // 文本在 entry 的 blocks map；block_id 约定：user 条目 `{entry_id}:text`
    // （create_user_entry），assistant 回放条目 = 内容块种类（`text`，§7.2
    // 归位）——统一按 block_order 首块读取。
    let entry_text = |m: &yrs::MapRef| -> String {
        let order = m
            .get(&txn, "block_order")
            .unwrap()
            .cast::<yrs::ArrayRef>()
            .unwrap();
        let bid = order.get(&txn, 0).unwrap().cast::<String>().unwrap();
        m.get(&txn, "blocks")
            .unwrap()
            .cast::<yrs::MapRef>()
            .unwrap()
            .get(&txn, &bid)
            .unwrap()
            .cast::<yrs::MapRef>()
            .unwrap()
            .get(&txn, "text")
            .unwrap()
            .cast::<yrs::TextRef>()
            .unwrap()
            .get_string(&txn)
    };
    let get_entry = |id: &str| {
        entries
            .get(&txn, id)
            .unwrap_or_else(|| panic!("entry {id} missing"))
            .cast::<yrs::MapRef>()
            .unwrap()
    };
    // 归位 turn：load:1 / load:3（seq 水位驱动）。
    let u1 = get_entry("load:1:user");
    assert_eq!(entry_text(&u1), "历史问题1");
    let a1 = get_entry("load:1:assistant");
    assert_eq!(entry_text(&a1), "历史回答1");
    assert_eq!(
        a1.get(&txn, "status").unwrap().cast::<String>().unwrap(),
        "completed"
    );
    let u2 = get_entry("load:3:user");
    assert_eq!(entry_text(&u2), "历史问题2");
    let a2 = get_entry("load:3:assistant");
    assert_eq!(entry_text(&a2), "历史回答2");
    assert_eq!(
        a2.get(&txn, "status").unwrap().cast::<String>().unwrap(),
        "completed"
    );

    // control doc（session doc）：EndLoadReplay 必须把回放 turn 的
    // active_turn 终态化（accepting → interrupted）——否则前端
    // isTurnActive("accepting") 恒真，恢复会话永久显示「Agent 正在
    // 工作」+ 输入框 loading（§8.5 回放 turn 无真实 TurnTerminal）。
    let session_mirror = yrs::Doc::new();
    let updates = sink.updates.lock().await;
    for (doc, update) in updates.iter() {
        if *doc == DocId::session("s1") {
            let parsed = yrs::Update::decode_v1(update).unwrap();
            let mut txn = session_mirror.transact_mut();
            txn.apply_update(parsed).unwrap();
        }
    }
    drop(updates);
    let txn = session_mirror.transact();
    let session = txn
        .get_map("root")
        .expect("root map")
        .get(&txn, "session")
        .expect("session map")
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        session
            .get(&txn, "active_turn_status")
            .unwrap()
            .cast::<String>()
            .unwrap(),
        "interrupted",
        "回放 turn 必须终态化，否则恢复会话显示「Agent 正在工作」"
    );
}

// ---------------------------------------------------------------------------
// 回放首帧即为 agent 增量（§8.5 REPLAY_NEEDS_TURN）：合成空文本 user 占位
// turn，杜绝空 id 垃圾条目
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn load_replay_first_frame_is_delta_synthesizes_placeholder() {
    use yrs::updates::decoder::Decode as _;
    use yrs::{Array, GetString, Map, ReadTxn, Transact};

    let sink = MemSink::default();
    let mgr = DocManager::new(cfg(), Arc::new(sink.clone()));
    open(&mgr, "s1").await;
    let _ = mgr
        .submit_command(
            "s1",
            DocCommand::BeginLoadReplay {
                acp_session_id: "acp-1".into(),
            },
        )
        .await;
    // 历史首帧即 agent 增量（真实 peri 重放形态：无 turnId）。
    assert!(matches!(
        mgr.submit_event(replay_delta("s1", 1, "历史回答（无前置问题）"))
            .await,
        SubmitResult::Applied(_)
    ));
    let _ = mgr.submit_command("s1", DocCommand::EndLoadReplay).await;
    tokio::time::advance(TokioDuration::from_millis(20)).await;
    tokio::task::yield_now().await;

    let mirror = yrs::Doc::new();
    let updates = sink.updates.lock().await;
    for (doc, update) in updates.iter() {
        if *doc == DocId::chat("s1") {
            let parsed = yrs::Update::decode_v1(update).unwrap();
            let mut txn = mirror.transact_mut();
            txn.apply_update(parsed).unwrap();
        }
    }
    drop(updates);
    let txn = mirror.transact();
    let root = txn.get_map("root").expect("root map");
    let entries = root
        .get(&txn, "entries")
        .expect("entries map")
        .cast::<yrs::MapRef>()
        .unwrap();
    // 占位 user + assistant 两条 entry；无空 id 条目。
    let keys: Vec<String> = entries.keys(&txn).map(|k| k.to_string()).collect();
    assert_eq!(keys.len(), 2, "占位 user + assistant 增量");
    assert!(
        keys.iter().all(|k| !k.is_empty()),
        "回放合成不得产生空 id 条目：{keys:?}"
    );
    // 归位 turn = 首帧 seq（`load:1`）。
    let a = entries
        .get(&txn, "load:1:assistant")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let order = a
        .get(&txn, "block_order")
        .unwrap()
        .cast::<yrs::ArrayRef>()
        .unwrap();
    let bid = order.get(&txn, 0).unwrap().cast::<String>().unwrap();
    let text = a
        .get(&txn, "blocks")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap()
        .get(&txn, &bid)
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap()
        .get(&txn, "text")
        .unwrap()
        .cast::<yrs::TextRef>()
        .unwrap()
        .get_string(&txn);
    assert_eq!(text, "历史回答（无前置问题）");
    assert_eq!(
        a.get(&txn, "status").unwrap().cast::<String>().unwrap(),
        "completed",
        "EndLoadReplay 终态化合成 turn"
    );
}

#[tokio::test(start_paused = true)]
async fn turn_terminal_is_idempotent_only_for_the_same_persisted_outcome() {
    let mgr = DocManager::new(cfg(), Arc::new(MemSink::default()));
    open(&mgr, "s1").await;
    let register = DocCommand::RegisterUserEntry {
        turn_id: "t1".into(),
        entry_id: "t1:user".into(),
        text: "hi".into(),
        author_user_id: None,
        source_command_id: "command-1".into(),
        created_at: "2026-08-14T00:00:00Z".into(),
    };
    assert!(matches!(
        mgr.submit_command("s1", register).await,
        SubmitResult::Applied(result) if result.applied
    ));
    let terminal = |status| DocCommand::SetTurnTerminal {
        turn_id: "t1".into(),
        status,
        completed_at: "2026-08-14T00:00:01Z".into(),
    };
    assert!(matches!(
        mgr.submit_command(
            "s1",
            terminal(peri_studio_proto::schema::TurnStatus::Completed),
        )
        .await,
        SubmitResult::Applied(result) if result.applied
    ));
    assert!(matches!(
        mgr.submit_command(
            "s1",
            terminal(peri_studio_proto::schema::TurnStatus::Completed),
        )
        .await,
        SubmitResult::Applied(result)
            if !result.applied
                && result.reason
                    == Some(crate::state::aggregator::ApplyReason::DuplicateIdempotent)
    ));
    assert!(matches!(
        mgr.submit_command(
            "s1",
            terminal(peri_studio_proto::schema::TurnStatus::Failed),
        )
        .await,
        SubmitResult::Applied(result)
            if !result.applied
                && result.reason
                    == Some(crate::state::aggregator::ApplyReason::TerminalProjectionConflict)
    ));
}


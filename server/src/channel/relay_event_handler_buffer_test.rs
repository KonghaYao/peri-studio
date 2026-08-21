//! RelayEventHandler on_buffer_sync 测试（relay_event_handler_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 1181 行超阈值，按「入口方法」分主题。
//!
//! 职责边界：本模块只覆盖 on_buffer_sync 路径——敏感帧回放拒绝（oauth）、
//! epoch 失配整批拒绝、乱序丢帧、连续段投递、断链后补推追平恢复（§7.3），
//! 以及 epoch 变化的不可校准缺口保持（§4.5.1）。on_instance_event 各主题与
//! on_instance_disconnect 分属其他模块；公共 helper 见 relay_event_handler_test_util。
use super::*;
#[tokio::test]
async fn buffer_sync_rejects_sensitive_oauth_replay() {
    let env = env().await;
    env.chats
        .set_extensions(S1, &["peri.oauth".to_string()])
        .await;
    let sync = InstanceBufferSync {
        chat_id: S1.to_string(),
        epoch: 0,
        from_seq: 1,
        frames: vec![BufferedFrame {
            seq: 1,
            frame: json!({
                "jsonrpc": "2.0",
                "method": "peri/oauth",
                "params": {
                    "schemaVersion": 1,
                    "flowId": "flow-1",
                    "serverName": "github",
                    "status": "authorization_needed",
                    "authorizationUrl": "https://example.test/oauth?state=secret"
                }
            }),
        }],
    };
    assert!(matches!(
        env.relay.on_buffer_sync("local", &sync).await,
        ConsumeResult::BatchRejected {
            reason: "all_frames_rejected"
        }
    ));
    assert!(env
        .relay
        .oauth_authorization("command-1", S1, "flow-1")
        .await
        .is_err());
}

#[tokio::test]
async fn buffer_sync_epoch_mismatch_rejects_batch() {
    let env = env().await;
    let sync = InstanceBufferSync {
        chat_id: S1.into(),
        epoch: 1, // hello 登记 0
        from_seq: 1,
        frames: vec![BufferedFrame {
            seq: 1,
            frame: json!({
                "type": "agent_message_chunk",
                "sessionId": "acp-1",
                "payload": {"turnId": "t1", "entryId": "e", "blockId": "b", "text": "x"}
            }),
        }],
    };
    let r = env.relay.on_buffer_sync("local", &sync).await;
    assert!(matches!(
        r,
        ConsumeResult::BatchRejected {
            reason: "buffer_sync_epoch_mismatch"
        }
    ));
}

#[tokio::test]
async fn buffer_sync_out_of_order_frames_dropped() {
    let env = env().await;
    // from_seq=1，但帧 seq 从 2 开始（跳号）→ 乱序丢弃计数。
    let sync = InstanceBufferSync {
        chat_id: S1.into(),
        epoch: 0,
        from_seq: 1,
        frames: vec![BufferedFrame {
            seq: 2,
            frame: json!({
                "type": "agent_message_chunk",
                "sessionId": "acp-1",
                "payload": {"turnId": "t1", "entryId": "e", "blockId": "b", "text": "x"}
            }),
        }],
    };
    let r = env.relay.on_buffer_sync("local", &sync).await;
    assert!(matches!(
        r,
        ConsumeResult::BatchRejected {
            reason: "all_frames_rejected"
        }
    ));
}

#[tokio::test]
async fn buffer_sync_contiguous_delivered() {
    let env = env().await;
    let sync = InstanceBufferSync {
        chat_id: S1.into(),
        epoch: 0,
        from_seq: 5,
        frames: vec![
            BufferedFrame {
                seq: 5,
                frame: json!({
                    "type": "agent_message_chunk",
                    "sessionId": "acp-1",
                    "payload": {"turnId": "t1", "entryId": "e", "blockId": "b", "text": "a"}
                }),
            },
            BufferedFrame {
                seq: 6,
                frame: json!({
                    "type": "agent_message_chunk",
                    "sessionId": "acp-1",
                    "payload": {"turnId": "t1", "entryId": "e", "blockId": "b", "text": "b"}
                }),
            },
        ],
    };
    let r = env.relay.on_buffer_sync("local", &sync).await;
    match r {
        ConsumeResult::Delivered { applied, .. } => assert!(applied),
        other => panic!("expected delivered, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// 断链追平恢复（§7.3/§8.5）：断链 → ChatState Gap + registry gap 占位 →
// buffer_sync 补推 → 恢复 Accepting + gap 清除；不可校准（epoch 变化，
// §4.5.1）→ 保持 Gap（只能经 session/load 显式重建消除）
// ---------------------------------------------------------------------------

#[tokio::test]
async fn buffer_sync_after_disconnect_recovers_chat_from_gap() {
    let env = env().await;
    // 活动 turn 基线（§6.5 服务端单写注入：user entry + active_turn）+
    // 流基线事件消费 seq 1（非回放 user 回声已被聚合器拒绝，用无 turn
    // 依赖的 agent/status；补推帧 seq=2 必须与水位连续）。
    inject_user_entry(&env, S1).await;
    let r = env
        .relay
        .on_instance_event(
            "local",
            &ev(
                1,
                json!({"jsonrpc": "2.0", "method": "agent/status", "params": {"status": "busy"}}),
            ),
        )
        .await;
    assert!(matches!(r, ConsumeResult::Delivered { applied: true, .. }));
    env.chats.set_active_turn(S1, "t1").await;
    // 断链 → ChatState Gap + registry gap 占位 Some(0)（缺口数量由补推时
    // 聚合器精确计算，§8.2/§7.3）。
    env.relay.on_instance_disconnect("local").await.unwrap();
    assert_eq!(
        env.chats.entry(S1).await.unwrap().state,
        crate::control::ChatState::Gap
    );
    assert_eq!(
        registry_chat_gap(&env).await,
        Some(Some(0.0)),
        "断链 → registry gap 占位"
    );
    // 补推（from_seq = server last_seq + 1 = 2）：delta 帧——断链后
    // active_turn 已 interrupted，聚合器拒该帧（applied=false）；relay
    // 以投递成功计数（delta 入队即返），恢复判定在 writer 内以聚合器
    // 事实源进行（ResumeAfterGap 可校准 → 追平）。
    let sync = InstanceBufferSync {
        chat_id: S1.into(),
        epoch: 0,
        from_seq: 2,
        frames: vec![BufferedFrame {
            seq: 2,
            frame: json!({
                "type": "agent_message_chunk",
                "sessionId": "acp-1",
                "payload": {"turnId": "t1", "entryId": "e", "blockId": "b", "text": "x"}
            }),
        }],
    };
    let r = env.relay.on_buffer_sync("local", &sync).await;
    assert!(matches!(r, ConsumeResult::Delivered { .. }), "补推投递成功");
    // 恢复：ChatState Gap → Accepting（可开新 turn）+ registry gap 清除。
    assert_eq!(
        env.chats.entry(S1).await.unwrap().state,
        crate::control::ChatState::Accepting,
        "补推追平 → 恢复 Accepting（§7.3）"
    );
    assert_eq!(
        registry_chat_gap(&env).await,
        Some(None),
        "追平 → registry gap 标记清除"
    );
}

#[tokio::test]
async fn buffer_sync_uncalibratable_keeps_gap() {
    let env = env().await;
    // 活动 turn 基线（§6.5 服务端单写注入）+ 流基线事件消费 seq 1
    // （非回放 user 回声已被聚合器拒绝，用无 turn 依赖的 agent/status）。
    inject_user_entry(&env, S1).await;
    let r = env
        .relay
        .on_instance_event(
            "local",
            &ev(
                1,
                json!({"jsonrpc": "2.0", "method": "agent/status", "params": {"status": "busy"}}),
            ),
        )
        .await;
    assert!(matches!(r, ConsumeResult::Delivered { applied: true, .. }));
    env.chats.set_active_turn(S1, "t1").await;
    // daemon 重启：新 hello 幂等替换 chat_epochs（s1 → 1，§4.5.1）——
    // relay epoch 校验放行 epoch=1 帧。
    let hello = InstanceHello {
        protocol_version: peri_studio_proto::version::PROTOCOL_VERSION,
        token: "tok".into(),
        hostname: "local".into(),
        caps: json!({}),
        buffered: None,
        buffer_lost: None,
        stream_epochs: Some([(S1.to_string(), 1u64)].into_iter().collect()),
        nonce: "BBBB".into(),
    };
    let (tx, _rx) = mpsc::channel(8);
    env.instance
        .on_hello("local", "tok-m", InstanceConn { tx }, &hello)
        .await;
    // epoch 变化帧：聚合器置不可校准缺口并拒绝投影（§4.5.1；补推契约
    // 失效——历史缓冲无法校准）。
    let mut e = ev(
        2,
        json!({"type": "user_message_chunk", "sessionId": "acp-1", "payload": {"turnId": "t2", "entryId": "t2:user", "text": "hi"}}),
    );
    e.epoch = 1;
    let r = env.relay.on_instance_event("local", &e).await;
    assert!(
        matches!(r, ConsumeResult::Delivered { applied: false, .. }),
        "epoch 变化帧应被聚合器拒绝（uncalibratable）"
    );
    // 断链 → Gap + registry gap 占位。
    env.relay.on_instance_disconnect("local").await.unwrap();
    assert_eq!(
        env.chats.entry(S1).await.unwrap().state,
        crate::control::ChatState::Gap
    );
    // 补推（epoch=1, from_seq=2）：帧被聚合器拒（UncalibratableGap）——
    // relay 以投递成功计数仍会尝试恢复，但 writer 内 ResumeAfterGap 检查
    // stream.uncalibratable → Rejected → 不迁移、不误标追平。
    let sync = InstanceBufferSync {
        chat_id: S1.into(),
        epoch: 1,
        from_seq: 2,
        frames: vec![BufferedFrame {
            seq: 2,
            frame: json!({
                "type": "agent_message_chunk",
                "sessionId": "acp-1",
                "payload": {"turnId": "t2", "entryId": "e", "blockId": "b", "text": "x"}
            }),
        }],
    };
    let r = env.relay.on_buffer_sync("local", &sync).await;
    assert!(
        matches!(r, ConsumeResult::Delivered { .. }),
        "补推帧投递（聚合器拒绝，relay 不感知）"
    );
    // 保持 Gap + gap 占位（不可校准缺口只能经 session/load 显式重建消除）。
    assert_eq!(
        env.chats.entry(S1).await.unwrap().state,
        crate::control::ChatState::Gap,
        "uncalibratable 拒绝恢复"
    );
    assert_eq!(
        registry_chat_gap(&env).await,
        Some(Some(0.0)),
        "gap 标记保留（不得误标为已追平）"
    );
}

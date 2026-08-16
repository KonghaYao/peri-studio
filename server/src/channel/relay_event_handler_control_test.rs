//! RelayEventHandler control 投影测试（relay_event_handler_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 1181 行超阈值，按「on_instance_event 的处理对象」分主题。
//!
//! 职责边界：本模块只覆盖 on_instance_event 中带「control doc 投影」的帧——
//! session/update available_commands、peri/agent_activity、peri/prediction_ready、
//! peri/oauth（含回放拒绝与 URL 不透写）。epoch/binding 防御、RPC 确认、投递/
//! 丢弃计数等无投影路径留在父模块；buffer 补推、permission、disconnect 分属
//! 各自模块。公共 helper 见 relay_event_handler_test_util。
use super::*;
#[tokio::test]
async fn official_available_commands_reach_the_durable_control_projection() {
    let env = env().await;
    assert!(matches!(
        env.doc
            .submit_command(
                S1,
                DocCommand::SetAgentExtensions {
                    extensions: vec!["peri.skillNames".into()],
                },
            )
            .await,
        SubmitResult::Applied(_)
    ));
    let event = ev(
        1,
        json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": "acp-1",
                "update": {
                    "sessionUpdate": "available_commands_update",
                    "availableCommands": [
                        {"name": "compact", "description": "Compress context"},
                        {"name": "auto-fix", "description": "Fix an issue",
                         "_meta": {"periKind": "skill", "periLevel": 1}}
                    ]
                }
            }
        }),
    );
    assert!(matches!(
        env.relay.on_instance_event("local", &event).await,
        ConsumeResult::Delivered { applied: true, .. }
    ));

    let (snapshot, _) = env
        .sink
        .snapshot(&peri_studio_proto::conn::DocId::session(S1))
        .await
        .expect("session snapshot");
    use yrs::updates::decoder::Decode as _;
    use yrs::{Map as _, ReadTxn as _, Transact as _};
    let mirror = yrs::Doc::new();
    mirror
        .transact_mut()
        .apply_update(yrs::Update::decode_v1(&snapshot).unwrap())
        .unwrap();
    let txn = mirror.transact();
    let root = txn.get_map("root").unwrap();
    let agent = root
        .get(&txn, "agent")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let catalog = agent
        .get(&txn, "command_catalog")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let skill = catalog
        .get(&txn, "auto-fix")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(skill.get(&txn, "kind"), Some("skill".into()));
    assert_eq!(skill.get(&txn, "description"), Some("Fix an issue".into()));
}

#[tokio::test]
async fn peri_oauth_requires_echoed_capability_and_never_projects_the_url() {
    let env = env().await;
    let secret_url = "https://example.test/oauth?state=must-not-persist";
    let event = ev(
        1,
        json!({
            "jsonrpc": "2.0",
            "method": "peri/oauth",
            "params": {
                "schemaVersion": 1,
                "flowId": "flow-1",
                "serverName": "github",
                "status": "authorization_needed",
                "authorizationUrl": secret_url
            }
        }),
    );
    assert!(matches!(
        env.relay.on_instance_event("local", &event).await,
        ConsumeResult::Dropped {
            reason: "oauth_event_rejected"
        }
    ));

    env.chats
        .set_extensions(S1, &["peri.oauth".to_string()])
        .await;
    let negotiated_event = ev(2, event.frame.clone());
    let result = env
        .relay
        .on_instance_event("local", &negotiated_event)
        .await;
    let ConsumeResult::OAuthStatus { frame, .. } = result else {
        panic!("expected safe OAuth status")
    };
    assert_eq!(frame.flow_id, "flow-1");
    assert!(!serde_json::to_string(&frame).unwrap().contains(secret_url));

    let authorization = env
        .relay
        .oauth_authorization("command-1", S1, "flow-1")
        .await
        .unwrap();
    assert_eq!(authorization.authorization_url.as_str(), secret_url);
    let (chat_snapshot, _) = env
        .sink
        .snapshot(&peri_studio_proto::conn::DocId::chat(S1))
        .await
        .unwrap();
    let (session_snapshot, _) = env
        .sink
        .snapshot(&peri_studio_proto::conn::DocId::session(S1))
        .await
        .unwrap();
    assert!(!String::from_utf8_lossy(&chat_snapshot).contains(secret_url));
    assert!(!String::from_utf8_lossy(&session_snapshot).contains(secret_url));
}

#[tokio::test]
async fn negotiated_peri_activity_reaches_only_the_safe_durable_projection() {
    let env = env().await;
    assert!(matches!(
        env.doc
            .submit_command(
                S1,
                DocCommand::SetAgentExtensions {
                    extensions: vec!["peri.agentActivity".into()],
                },
            )
            .await,
        SubmitResult::Applied(_)
    ));
    let event = ev(
        1,
        json!({
            "jsonrpc": "2.0",
            "method": "peri/agent_activity",
            "params": {
                "sessionId": "acp-1",
                "activity": {
                    "schemaVersion": 1,
                    "kind": "compact",
                    "status": "completed",
                    "correlationId": "0123456789abcdef01234567",
                    "label": "Context compacted",
                    "metrics": {"token_before": 8000, "token_after": 2500},
                    "attributes": {"strategy": "smart", "trigger": "auto"}
                }
            }
        }),
    );
    assert!(matches!(
        env.relay.on_instance_event("local", &event).await,
        ConsumeResult::Delivered {
            applied: true,
            kind,
            ..
        } if kind == "agent_activity"
    ));

    let (snapshot, _) = env
        .sink
        .snapshot(&peri_studio_proto::conn::DocId::session(S1))
        .await
        .expect("session snapshot");
    use yrs::updates::decoder::Decode as _;
    use yrs::{Map as _, ReadTxn as _, Transact as _};
    let mirror = yrs::Doc::new();
    mirror
        .transact_mut()
        .apply_update(yrs::Update::decode_v1(&snapshot).unwrap())
        .unwrap();
    let txn = mirror.transact();
    let root = txn.get_map("root").unwrap();
    let agent = root
        .get(&txn, "agent")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let activities = agent
        .get(&txn, "activities")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let activity = activities
        .get(&txn, "compact:0123456789abcdef01234567")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(activity.get(&txn, "kind"), Some("compact".into()));
    assert_eq!(activity.get(&txn, "status"), Some("completed".into()));
    assert!(activity.get(&txn, "messages_json").is_none());
    assert!(activity.get(&txn, "summary").is_none());
    assert!(activity.get(&txn, "raw_output").is_none());
}

#[tokio::test]
async fn negotiated_peri_prediction_reaches_the_safe_control_projection() {
    let env = env().await;
    assert!(matches!(
        env.doc
            .submit_command(
                S1,
                DocCommand::SetAgentExtensions {
                    extensions: vec!["peri.prediction".into()],
                },
            )
            .await,
        SubmitResult::Applied(_)
    ));
    let event = ev(
        1,
        json!({
            "jsonrpc": "2.0",
            "method": "peri/prediction_ready",
            "params": {
                "sessionId": "acp-1",
                "text": "检查失败测试",
                "actions": [
                    {"kind": "placeholder", "text": "检查失败测试"},
                    {"kind": "summary", "text": "internal summary"}
                ]
            }
        }),
    );
    assert!(matches!(
        env.relay.on_instance_event("local", &event).await,
        ConsumeResult::Delivered {
            applied: true,
            kind,
            ..
        } if kind == "input_prediction"
    ));

    let (snapshot, _) = env
        .sink
        .snapshot(&peri_studio_proto::conn::DocId::session(S1))
        .await
        .expect("session snapshot");
    use yrs::updates::decoder::Decode as _;
    use yrs::{Map as _, ReadTxn as _, Transact as _};
    let mirror = yrs::Doc::new();
    mirror
        .transact_mut()
        .apply_update(yrs::Update::decode_v1(&snapshot).unwrap())
        .unwrap();
    let txn = mirror.transact();
    let root = txn.get_map("root").unwrap();
    let agent = root
        .get(&txn, "agent")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let prediction = agent
        .get(&txn, "input_prediction")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(prediction.get(&txn, "text"), Some("检查失败测试".into()));
    assert_eq!(
        prediction.len(&txn),
        3,
        "raw actions must never be projected"
    );
}

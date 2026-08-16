use chrono::Utc;

use crate::control::{ChatRecord, ChatState};

use super::select_poll_targets;

fn record(
    state: ChatState,
    instance_id: &str,
    cwd: &str,
    session_id: Option<&str>,
    runtime_confirmed: bool,
) -> ChatRecord {
    let now = Utc::now();
    ChatRecord {
        state,
        instance_id: instance_id.into(),
        title: String::new(),
        session_id: session_id.map(str::to_string),
        cwd: cwd.into(),
        workspace_id: None,
        created_at: now,
        updated_at: now,
        runtime_confirmed,
    }
}

#[test]
fn poll_targets_are_live_bound_and_deduplicated_by_exact_instance_and_cwd() {
    let chats = Vec::from([
        (
            "live-a".into(),
            record(ChatState::Accepting, "local", "/repo", Some("acp-a"), true),
        ),
        (
            "live-b".into(),
            record(ChatState::Gap, "local", "/repo", Some("acp-b"), true),
        ),
        (
            "other-cwd".into(),
            record(ChatState::Accepting, "local", "/other", Some("acp-c"), true),
        ),
        (
            "other-instance".into(),
            record(ChatState::Accepting, "remote", "/repo", Some("acp-d"), true),
        ),
        (
            "terminal".into(),
            record(ChatState::Ended, "local", "/ended", Some("acp-e"), true),
        ),
        (
            "unbound".into(),
            record(ChatState::Accepting, "local", "/new", None, true),
        ),
        (
            // 无存活证据的 chat（server 重启重建/进程已退出）：不作为
            // 轮询通道，查询必然失败（§8.3）。
            "unconfirmed".into(),
            record(ChatState::Accepting, "local", "/repo2", Some("acp-f"), false),
        ),
    ]);

    let targets = select_poll_targets(chats);
    assert_eq!(targets.len(), 3);
    assert!(!targets.contains_key(&("local".into(), "/repo2".into())));
    assert!(matches!(
        targets
            .get(&("local".into(), "/repo".into()))
            .map(String::as_str),
        Some("live-a" | "live-b")
    ));
    assert_eq!(
        targets
            .get(&("local".into(), "/other".into()))
            .map(String::as_str),
        Some("other-cwd")
    );
    assert_eq!(
        targets
            .get(&("remote".into(), "/repo".into()))
            .map(String::as_str),
        Some("other-instance")
    );
}

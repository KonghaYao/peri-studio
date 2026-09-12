//! ChatRegistry 单测（设计稿 §16 测试 28–30）。

use std::sync::Arc;
use std::time::Duration;

use crate::control::StoreSink;
use crate::state::doc_manager::{BatchConfig, DocManager};

use super::*;

/// 真实 RegistryState（经 DocManager 全局 registry 写者，§5.2 单写）：
/// `set_chat_status` 等写回依赖存活写者与 Registry Doc 条目，channel
/// receiver 被 drop 的假句柄会在写回时 `ChannelClosed`/`NotFound`。
async fn test_registry() -> (RegistryState, Arc<DocManager>) {
    let sink = Arc::new(StoreSink::new());
    let doc = Arc::new(DocManager::new(BatchConfig::default(), sink.clone()));
    let registry = doc.registry();
    (registry, doc)
}

#[tokio::test]
async fn register_and_bind_resolve() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    reg.register("s1", "m1", Some("title"), "/", None)
        .await
        .unwrap();
    let e = reg.entry("s1").await.unwrap();
    assert_eq!(e.state, ChatState::Accepting);
    assert_eq!(e.instance_id, "m1");

    reg.bind("s1", "acp-1", true).await.unwrap();
    assert_eq!(reg.resolve("acp-1").await.as_deref(), Some("s1"));
    assert_eq!(reg.session_id("s1").await.as_deref(), Some("acp-1"));
    // 幂等 bind。
    reg.bind("s1", "acp-1", true).await.unwrap();
    // binding 冲突。
    assert!(matches!(
        reg.bind("s2", "acp-1", true).await,
        Err(ChatError::BindingConflict(_))
    ));
}

#[tokio::test]
async fn live_workspace_scan_uses_runtime_state_not_session_hints() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    reg.register("active", "m1", None, "/", Some("project-a"))
        .await
        .unwrap();
    reg.bind("active", "acp-a", true).await.unwrap();
    reg.register("other", "m1", None, "/", Some("project-b"))
        .await
        .unwrap();
    reg.bind("other", "acp-b", true).await.unwrap();
    assert!(reg.has_live_workspace("project-a").await);
    assert!(!reg.has_live_workspace("missing").await);
    reg.transition("active", ChatState::Closed).await.unwrap();
    assert!(!reg.has_live_workspace("project-a").await);
    assert!(reg.has_live_workspace("project-b").await);
}

#[tokio::test]
async fn bind_before_frames_dropped_semantics() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    reg.register("s1", "m1", None, "/", None).await.unwrap();
    // binding 前 resolve 未命中（§6.2：binding 前帧一律丢弃）。
    assert_eq!(reg.resolve("acp-x").await, None);
    reg.bind("s1", "acp-x", true).await.unwrap();
    assert_eq!(reg.resolve("acp-x").await.as_deref(), Some("s1"));
}

/// §8.5 会话切换：进程内 load 后 switch_session 更新 chat 当前会话。
#[tokio::test]
async fn switch_session_updates_current_and_bindings() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    reg.register("s1", "m1", None, "/", None).await.unwrap();
    reg.bind("s1", "acp-1", true).await.unwrap();
    assert_eq!(reg.session_id("s1").await.as_deref(), Some("acp-1"));

    // load 切换：同 chat 内换到 acp-2（会话是进程内实体，进程不重建）。
    reg.switch_session("s1", "acp-2").await.unwrap();
    assert_eq!(reg.session_id("s1").await.as_deref(), Some("acp-2"));
    // 新旧会话 binding 均指向该 chat（relay 逐帧校验：任一 sessionId 的
    // 帧都属于本进程，§8.5）。
    assert_eq!(reg.resolve("acp-1").await.as_deref(), Some("s1"));
    assert_eq!(reg.resolve("acp-2").await.as_deref(), Some("s1"));

    // 幂等重切同会话：仍成功且无副作用。
    reg.switch_session("s1", "acp-2").await.unwrap();
    assert_eq!(reg.session_id("s1").await.as_deref(), Some("acp-2"));

    // 冲突：目标会话已被**另一 chat** 绑定 → BindingConflict（并发 load
    // 同会话的防御，§8.5）。
    reg.register("s2", "m1", None, "/", None).await.unwrap();
    reg.bind("s2", "acp-9", true).await.unwrap();
    assert!(matches!(
        reg.switch_session("s2", "acp-1").await,
        Err(ChatError::BindingConflict(_))
    ));
    assert_eq!(reg.session_id("s2").await.as_deref(), Some("acp-9"));
}

#[tokio::test]
async fn terminal_transition_releases_binding() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    reg.register("s1", "m1", None, "/", None).await.unwrap();
    reg.bind("s1", "acp-1", true).await.unwrap();
    assert_eq!(reg.resolve("acp-1").await.as_deref(), Some("s1"));
    // 终态（关闭/崩溃/结束）→ 释放 binding（§8.5 激活语义：会话可再次
    // 被激活/加载，不因 chat 关闭而永久占用）。
    reg.transition("s1", ChatState::Closed).await.unwrap();
    assert_eq!(reg.resolve("acp-1").await, None, "终态后绑定必须释放");
    // 非终态迁移不释放（binding 在活跃生命周期内保持）。
    reg.register("s2", "m1", None, "/", None).await.unwrap();
    reg.bind("s2", "acp-2", true).await.unwrap();
    reg.transition("s2", ChatState::Gap).await.unwrap();
    assert_eq!(reg.resolve("acp-2").await.as_deref(), Some("s2"));
    assert!(
        !reg.entry("s2").await.unwrap().runtime_confirmed,
        "Gap 必须撤销存活证据"
    );
    assert!(
        !reg.has_live_acp_session("acp-2").await,
        "Gap 不得阻止归档：进程已不在"
    );
}

#[tokio::test]
async fn live_acp_session_ignores_unconfirmed_binding() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    reg.register("s1", "m1", None, "/", None).await.unwrap();
    reg.bind("s1", "acp-1", false).await.unwrap();
    assert!(!reg.has_live_acp_session("acp-1").await);
    reg.bind("s1", "acp-1", true).await.unwrap();
    assert!(reg.has_live_acp_session("acp-1").await);
}

/// 恢复 open 接管语义（§8.3 恢复场景）：视图重建 + 对账 missing 的 stale
/// binding 无存活证据（runtime_confirmed=false），恢复 open 必须接管到新
/// runtime chat，而不是 BindingConflict 杀掉新 spawn 的进程（SIGTERM 根因
/// 回归：视图重建 bind(confirmed=false) + reconcile 后 bindings 保留）。
#[tokio::test]
async fn bind_recovering_takes_over_unconfirmed_binding() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    // 视图重建：旧 chat 未确认绑定（server 重启，hub.rs rebuild_chat_views）。
    reg.register("old", "m1", None, "/", None).await.unwrap();
    reg.bind("old", "acp-1", false).await.unwrap();
    assert!(!reg.entry("old").await.unwrap().runtime_confirmed);
    // 对账 missing：确认位保持 false，binding 条目保留（§8.3）。
    reg.reconcile_alive("m1", &[]).await.unwrap();
    assert!(!reg.entry("old").await.unwrap().runtime_confirmed);
    assert_eq!(reg.resolve("acp-1").await.as_deref(), Some("old"));

    // 恢复 open 的新 runtime chat 接管该会话（pre-bind，confirmed=true）。
    reg.register("new", "m1", None, "/", None).await.unwrap();
    reg.bind_recovering("new", "acp-1", true).await.unwrap();
    assert_eq!(reg.resolve("acp-1").await.as_deref(), Some("new"));
    assert_eq!(reg.session_id("new").await.as_deref(), Some("acp-1"));
    assert!(reg.entry("new").await.unwrap().runtime_confirmed);
    // 旧 chat 不再拥有该会话（session_id 引用已清，prompt 不误投）。
    assert_eq!(reg.session_id("old").await.as_deref(), None);
}

/// 有存活证据的 binding 不可被恢复 open 接管（并发打开保护，§6.2：同一
/// ACP 会话不得同时有两个活进程）。
#[tokio::test]
async fn bind_recovering_rejects_confirmed_binding() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    reg.register("live", "m1", None, "/", None).await.unwrap();
    reg.bind("live", "acp-1", true).await.unwrap();

    reg.register("new", "m1", None, "/", None).await.unwrap();
    assert!(matches!(
        reg.bind_recovering("new", "acp-1", true).await,
        Err(ChatError::BindingConflict(_))
    ));
    assert_eq!(reg.resolve("acp-1").await.as_deref(), Some("live"));
    assert_eq!(reg.session_id("new").await.as_deref(), None);
}

/// 已注销 chat（bindings 残留但 chats 条目被删）的 binding 可被接管。
#[tokio::test]
async fn bind_recovering_takes_over_gone_chat_binding() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    reg.register("gone", "m1", None, "/", None).await.unwrap();
    reg.bind("gone", "acp-1", false).await.unwrap();
    // chats 条目被删除（chat store 清理等），bindings 残留。
    reg.inner.chats.write().await.remove("gone");

    reg.register("new", "m1", None, "/", None).await.unwrap();
    reg.bind_recovering("new", "acp-1", true).await.unwrap();
    assert_eq!(reg.resolve("acp-1").await.as_deref(), Some("new"));
}

/// 终态 chat 的残留 binding 可被接管（防御：正常终态路径已释放 binding，
/// 但残留条目不得阻塞恢复）。
#[tokio::test]
async fn bind_recovering_takes_over_terminal_binding() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    reg.register("ended", "m1", None, "/", None).await.unwrap();
    reg.bind("ended", "acp-1", true).await.unwrap();
    reg.transition("ended", ChatState::Closed).await.unwrap();
    assert_eq!(reg.resolve("acp-1").await, None, "终态正常释放 binding");

    // 直接构造残留终态 binding（异常路径防御）。
    reg.bind("ended", "acp-1", true).await.unwrap();
    reg.register("new", "m1", None, "/", None).await.unwrap();
    reg.bind_recovering("new", "acp-1", true).await.unwrap();
    assert_eq!(reg.resolve("acp-1").await.as_deref(), Some("new"));
}

/// 幂等：同 chat 重复 bind_recovering 刷新确认位（与 bind 一致，只升不降）。
#[tokio::test]
async fn bind_recovering_idempotent_refreshes_confirmation() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    reg.register("s1", "m1", None, "/", None).await.unwrap();
    reg.bind_recovering("s1", "acp-1", false).await.unwrap();
    assert!(!reg.entry("s1").await.unwrap().runtime_confirmed);
    // 同 chat 重复调用：确认位升级。
    reg.bind_recovering("s1", "acp-1", true).await.unwrap();
    assert!(reg.entry("s1").await.unwrap().runtime_confirmed);
    assert_eq!(reg.resolve("acp-1").await.as_deref(), Some("s1"));
}

#[tokio::test]
async fn pending_close_offline() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    reg.register("s1", "m1", None, "/", None).await.unwrap();
    reg.request_close_offline("s1").await.unwrap();
    assert_eq!(
        reg.entry("s1").await.unwrap().state,
        ChatState::PendingClose
    );
    assert!(reg.pending_close_chats().await.contains(&"s1".to_string()));
    // close 完成后清 pending_close（§7.6）。
    reg.transition("s1", ChatState::Closed).await.unwrap();
    assert!(reg.pending_close_chats().await.is_empty());
}

#[tokio::test]
async fn reconcile_alive_report() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    reg.register("s1", "m1", None, "/", None).await.unwrap(); // 存活
    reg.register("s2", "m1", None, "/", None).await.unwrap(); // instance 未报（missing）
    reg.register("s3", "m1", None, "/", None).await.unwrap();
    reg.transition("s3", ChatState::Closed).await.unwrap(); // 终态（意外存活）

    let report = reg
        .reconcile_alive("m1", &["s1".to_string(), "s3".to_string()])
        .await
        .unwrap();
    assert_eq!(report.alive, vec!["s1".to_string()]);
    assert!(report.missing.contains(&"s2".to_string()));
    // s3 终态但 instance 声称存活 → 意外存活 + kill 裁决（§7.5）。
    assert!(report.unexpected_alive.contains(&"s3".to_string()));
    assert!(report.to_kill.contains(&"s3".to_string()));
}

#[tokio::test]
async fn reconcile_alive_pending_close_kill() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    reg.register("s1", "m1", None, "/", None).await.unwrap();
    reg.request_close_offline("s1").await.unwrap();
    // instance 重连后对账：pending_close 补发 kill（§7.6）。
    let report = reg.reconcile_alive("m1", &[]).await.unwrap();
    assert!(report.to_kill.contains(&"s1".to_string()));
}

/// §8.3 对账维护 `runtime_confirmed`：instance 上报存活 → 确认（可复用为
/// live runtime）；已登记但未上报（missing）→ 清除确认并迁移 **Gap**（不再
/// 呈现「运行中」；Gap 非终态，打开时走 spawn + `session/load`，不作为
/// 轮询通道）。alive 分支不恢复状态（断链场景等补推帧经 recover_from_gap
/// 校准追平，§7.3）。
#[tokio::test]
async fn reconcile_alive_maintains_runtime_confirmation() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    // 恢复场景：视图重建 bind 不构成存活证据（confirmed=false）。
    reg.register("s1", "m1", None, "/", None).await.unwrap();
    reg.bind("s1", "acp-1", false).await.unwrap();
    assert!(!reg.entry("s1").await.unwrap().runtime_confirmed);

    // instance 上报 s1 存活 → 补确认（状态保持 register 时的 Accepting）。
    let report = reg
        .reconcile_alive("m1", &["s1".to_string()])
        .await
        .unwrap();
    assert_eq!(report.alive, vec!["s1".to_string()]);
    assert!(report.missing.is_empty());
    assert!(reg.entry("s1").await.unwrap().runtime_confirmed);
    assert_eq!(reg.entry("s1").await.unwrap().state, ChatState::Accepting);

    // 运行中 chat：进程退出后 instance 心跳不再上报 → missing 清除确认
    // 并置 Gap（不显示运行中）。
    reg.register("s2", "m1", None, "/", None).await.unwrap();
    reg.bind("s2", "acp-2", true).await.unwrap();
    let report = reg.reconcile_alive("m1", &[]).await.unwrap();
    assert!(report.missing.contains(&"s2".to_string()));
    assert!(!reg.entry("s2").await.unwrap().runtime_confirmed);
    assert_eq!(reg.entry("s2").await.unwrap().state, ChatState::Gap);
    // s1 本轮未上报同样被清除并置 Gap。
    assert!(!reg.entry("s1").await.unwrap().runtime_confirmed);
    assert_eq!(reg.entry("s1").await.unwrap().state, ChatState::Gap);

    // 清除后再次上报 → 重新确认（幂等往复）；状态保持 Gap（alive 分支
    // 不恢复状态，由帧追平恢复，§7.3）。
    reg.reconcile_alive("m1", &["s2".to_string()])
        .await
        .unwrap();
    assert!(reg.entry("s2").await.unwrap().runtime_confirmed);
    assert_eq!(reg.entry("s2").await.unwrap().state, ChatState::Gap);
    assert!(!reg.entry("s1").await.unwrap().runtime_confirmed);
}

/// 终态 chat 在对账 missing 时保持终态（防御：binding 已释放，不得被 Gap
/// 覆盖回非终态）。
#[tokio::test]
async fn reconcile_alive_missing_keeps_terminal_state() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    reg.register("ended", "m1", None, "/", None).await.unwrap();
    reg.transition("ended", ChatState::Closed).await.unwrap();

    let report = reg.reconcile_alive("m1", &[]).await.unwrap();
    assert!(report.missing.contains(&"ended".to_string()));
    assert_eq!(
        reg.entry("ended").await.unwrap().state,
        ChatState::Closed,
        "终态不得被对账覆盖"
    );
}

#[tokio::test]
async fn terminal_transition_guard() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    reg.register("s1", "m1", None, "/", None).await.unwrap();
    reg.transition("s1", ChatState::Ended).await.unwrap();
    // 终态不可逆（防御：不覆盖）。
    reg.transition("s1", ChatState::Gap).await.unwrap();
    assert_eq!(reg.entry("s1").await.unwrap().state, ChatState::Ended);
}

#[tokio::test]
async fn active_turn_tracking() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    reg.register("s1", "m1", None, "/", None).await.unwrap();
    reg.set_active_turn("s1", "t1").await;
    assert_eq!(reg.active_turn("s1").await.as_deref(), Some("t1"));
    reg.clear_active_turn("s1").await;
    assert_eq!(reg.active_turn("s1").await, None);
}

#[tokio::test]
async fn active_turn_change_subscription_tracks_exact_turn() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    reg.set_active_turn("s1", "t1").await;
    let mut changes = reg.subscribe_active_turn_changes("s1", "t1").await;

    reg.set_active_turn("s1", "t2").await;
    assert!(
        tokio::time::timeout(Duration::from_millis(50), changes.changed())
            .await
            .expect("replacing the subscribed turn must wake waiters")
            .is_err(),
        "the replaced turn sender must close"
    );
    assert_eq!(reg.active_turn("s1").await.as_deref(), Some("t2"));

    let mut stale = reg.subscribe_active_turn_changes("s1", "t1").await;
    assert!(
        tokio::time::timeout(Duration::from_millis(50), stale.changed())
            .await
            .expect("an already inactive exact turn must not miss its wakeup")
            .is_err()
    );
}

#[tokio::test]
async fn active_turn_subscription_after_clear_is_already_closed() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    reg.set_active_turn("s1", "t1").await;
    reg.clear_active_turn("s1").await;

    let mut changes = reg.subscribe_active_turn_changes("s1", "t1").await;
    assert!(
        tokio::time::timeout(Duration::from_millis(50), changes.changed())
            .await
            .expect("subscribing after clear must not wait for another timeout")
            .is_err()
    );
}

/// #3 增量窗口计时（issue #3）：touch_active_turn 续命 / active_turn_idle
/// 空闲时长语义；无登记表项 → None（调用方按「无活动窗口」处理）。
#[tokio::test]
async fn active_turn_touch_and_idle() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    // 无登记 → idle None；touch 无登记表项 → 幂等无害。
    assert_eq!(reg.active_turn_idle("s1").await, None);
    reg.touch_active_turn("s1").await;
    assert_eq!(reg.active_turn_idle("s1").await, None);
    // 登记 → idle 为微小正时长（远小于 1s）。
    reg.set_active_turn("s1", "t1").await;
    let idle = reg.active_turn_idle("s1").await.expect("登记后有 idle");
    assert!(
        idle < Duration::from_secs(1),
        "刚登记 idle 应微小（got {idle:?}）"
    );
    // touch 续命：sleep 30ms 后 touch → idle 重置回微小值（增量窗口续期）。
    tokio::time::sleep(Duration::from_millis(30)).await;
    reg.touch_active_turn("s1").await;
    let idle2 = reg.active_turn_idle("s1").await.expect("touch 后仍有 idle");
    assert!(
        idle2 < Duration::from_millis(30),
        "touch 重置 idle 时钟（got {idle2:?}）"
    );
    // 语义保留：turn_id 查询/清除不受影响。
    assert_eq!(reg.active_turn("s1").await.as_deref(), Some("t1"));
    reg.clear_active_turn("s1").await;
    assert_eq!(reg.active_turn("s1").await, None);
    assert_eq!(reg.active_turn_idle("s1").await, None);
}

#[tokio::test]
async fn chats_for_instance() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    reg.register("s1", "m1", None, "/", None).await.unwrap();
    reg.register("s2", "m2", None, "/", None).await.unwrap();
    let list = reg.chats_for_instance("m1").await;
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].0, "s1");
}

/// 状态机全路径（§7.3）：crashed（进程崩溃）、gap（分区）→ 恢复可用
/// （补推追平后清除，迁移回非 gap 状态）。
#[tokio::test]
async fn transition_crashed_and_gap_recover() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    // crashed：进程崩溃（终态，视图保留）。
    reg.register("s1", "m1", None, "/", None).await.unwrap();
    reg.transition("s1", ChatState::Crashed).await.unwrap();
    assert_eq!(reg.entry("s1").await.unwrap().state, ChatState::Crashed);
    assert!(reg.entry("s1").await.unwrap().state.is_terminal());
    // ended：ACP 进程退出。
    reg.register("s2", "m1", None, "/", None).await.unwrap();
    reg.transition("s2", ChatState::Ended).await.unwrap();
    assert_eq!(reg.entry("s2").await.unwrap().state, ChatState::Ended);
    // gap：instance 分区 → 补推追平 → 恢复可用（§7.3「Gap 清除 → 恢复
    // 可用、可开新 turn」）。
    reg.register("s3", "m1", None, "/", None).await.unwrap();
    reg.transition("s3", ChatState::Gap).await.unwrap();
    assert_eq!(reg.entry("s3").await.unwrap().state, ChatState::Gap);
    reg.transition("s3", ChatState::Accepting).await.unwrap();
    assert_eq!(reg.entry("s3").await.unwrap().state, ChatState::Accepting);
}

/// 错误路径：未知 chat 的迁移/离线 close → NotFound（§7.3）。
#[tokio::test]
async fn transition_unknown_chat_not_found() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    assert!(matches!(
        reg.transition("ghost", ChatState::Closed).await,
        Err(ChatError::NotFound(_))
    ));
    assert!(matches!(
        reg.request_close_offline("ghost").await,
        Err(ChatError::NotFound(_))
    ));
}

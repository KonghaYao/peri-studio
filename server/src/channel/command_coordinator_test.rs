//! CommandCoordinator 单测（设计稿 §16 测试 9–14 的子集；全链路 create 成功
//! 路径在 hub_test 端到端）。
//!
//! 环境注：F4 `DocManager::try_reserve` 的 in_flight 计数在 writer 消费成功
//! 路径不递减（F4 已知缺口，见输出遗留问题）——「队列满」测试利用该行为
//! （提交 64 次后永久 RATE_LIMITED），其余测试每个 session 提交量 < 64。
//!
//! 2026-08-07 主管修复 P1-1（writer 消费后名额释放）：「队列满」测试改为
//! 先占满名额（try_reserve ×64 不提交）再验证第 65 次 RATE_LIMITED。
//!
//! 拆分说明（2026-08-16）：原文件 6304 行超 500 行阈值，按主题拆分为
//! 本文件（父模块：环境装配 Env/ctx/env + 深模块所有权守卫测试）与
//! command_coordinator_test_metadata/session_open/resume_oauth/rewind/prompt/
//! creation/creation_serial/permission/permission_recovery/closure/workspace/
//! discovery/session_list/load/load_replay/session_new/prompt_l3/cancel/
//! prompt_timeout 各主题子模块；公共 helper 集中于
//! command_coordinator_test_util.rs（本文件 re-export 后经 `use super::*`
//! 供各子模块使用）。测试内容与断言意图未变。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::mpsc;
use yrs::updates::decoder::Decode;
use yrs::{Array, Map, ReadTxn, Transact};

use peri_studio_proto::ack::{AckStatus, ActionError, ErrorCode};
use peri_studio_proto::action::{
    ActionEnvelope, ConfigSetPayload, CreateChatPayload, McpOAuthStartPayload,
    PersistedSessionImportPayload, PersistedSessionOpenPayload, PersistedSessionRenamePayload,
    ProjectArchivePayload, ProjectCreatePayload, PromptChatPayload, ResolvePermissionPayload,
    RewindCandidatesPayload, RewindPayload, RewindPreviewPayload,
};
use peri_studio_proto::frame::Frame;
use peri_studio_proto::instance::InstanceForwardAck;

use crate::auth::{ConnectionCtx, TokenRole};
use crate::channel::OutboundMsg;
use crate::channel::RelayEventHandler;
use crate::channel::{CommandCoordinator, SubmitAck, DEFAULT_ACP_CMD};
use crate::control::StoreSink;
use crate::control::{ChatRegistry, ChatState, ProjectService};
use crate::control::{InstanceAck, InstanceConn, InstanceRegistry};
use crate::persist::metadata::MetadataStore;
use crate::persist::outbox::{CommandType, NewOutboxRecord, RetryableClass};
use crate::persist::{PersistConfig, Store};
use crate::state::doc_manager::{BatchConfig, DocManager, PersistError, UpdateSink};

/// 测试用固定 UUID session id（coordinator 要求 UUID 形态，§4.3）。
const S1: &str = "00000000-0000-0000-0000-000000000001";
const S2: &str = "00000000-0000-0000-0000-000000000002";
const S3: &str = "00000000-0000-0000-0000-000000000003";
const S4: &str = "00000000-0000-0000-0000-000000000004";
const S5: &str = "00000000-0000-0000-0000-000000000005";

struct Env {
    _tmp: tempfile::TempDir,
    store: Arc<Store>,
    doc: Arc<DocManager>,
    instance: Arc<InstanceRegistry>,
    chats: ChatRegistry,
    relay: Arc<RelayEventHandler>,
    coordinator: Arc<CommandCoordinator>,
    metadata: Arc<MetadataStore>,
    /// 镜像 sink（session doc 镜像快照断言用）。
    sink: Arc<StoreSink>,
    /// 精确故障注入：默认透传 StoreSink，置位后拒绝新的 Doc update。
    sink_fail: Arc<AtomicBool>,
    /// instance 连接发送侧（测试读下行帧）。
    instance_rx: mpsc::Receiver<OutboundMsg>,
    /// instance 连接发送句柄（on_disconnect 句柄比对用）。
    instance_tx: mpsc::Sender<OutboundMsg>,
}

struct FaultSink {
    inner: Arc<StoreSink>,
    fail: Arc<AtomicBool>,
}

#[async_trait]
impl UpdateSink for FaultSink {
    async fn persist_update(
        &self,
        doc: peri_studio_proto::conn::DocId,
        update: Vec<u8>,
    ) -> Result<(), PersistError> {
        if self.fail.load(Ordering::SeqCst) {
            return Err(PersistError("injected persistence failure".into()));
        }
        self.inner.persist_update(doc, update).await
    }
}

fn ctx(name: &str) -> ConnectionCtx {
    ConnectionCtx {
        token_id: format!("tok-{name}"),
        role: TokenRole::Full,
        name: name.to_string(),
        peer: "127.0.0.1:1234".parse().unwrap(),
        hostname: None,
        established_at: chrono::Utc::now(),
    }
}

async fn env_with_create_deadlines(spawn_timeout: Duration, instance_ack_timeout: Duration) -> Env {
    let tmp = tempfile::tempdir().unwrap();
    let persist_cfg = PersistConfig {
        data_dir: tmp.path().to_path_buf(),
    };
    let store = Arc::new(Store::open(&persist_cfg).unwrap());
    let sink = Arc::new(StoreSink::new());
    let sink_fail = Arc::new(AtomicBool::new(false));
    let doc = Arc::new(DocManager::new(
        BatchConfig::default(),
        Arc::new(FaultSink {
            inner: sink.clone(),
            fail: sink_fail.clone(),
        }),
    ));
    let registry = doc.registry();
    let chats = ChatRegistry::new(registry);
    let instance = Arc::new(InstanceRegistry::new(
        Duration::from_secs(30),
        instance_ack_timeout,
        chats.clone(),
    ));
    let relay = Arc::new(RelayEventHandler::new(
        doc.clone(),
        chats.clone(),
        instance.clone(),
        doc.registry(),
    ));
    let coordinator = Arc::new(CommandCoordinator::with_l3_timeout(
        store.clone(),
        doc.clone(),
        instance.clone(),
        chats.clone(),
        relay.clone(),
        &BatchConfig::default(),
        DEFAULT_ACP_CMD.iter().map(|s| s.to_string()).collect(),
        spawn_timeout,
        Duration::from_millis(500),
        Duration::from_millis(500),
        Duration::from_millis(500),
    ));
    let metadata = Arc::new(MetadataStore::open(tmp.path()).await.unwrap());
    coordinator
        .install_project_service(ProjectService::new(metadata.clone(), doc.registry()))
        .await;
    coordinator.install_history_sink(sink.clone()).await;
    // instance 上线（hello）。
    let (instance_tx, instance_rx) = mpsc::channel(64);
    instance
        .on_hello(
            "local",
            "tok-m",
            InstanceConn {
                tx: instance_tx.clone(),
            },
            &peri_studio_proto::instance::InstanceHello {
                protocol_version: peri_studio_proto::version::PROTOCOL_VERSION,
                token: "tok".into(),
                hostname: "local".into(),
                caps: serde_json::json!({}),
                buffered: None,
                buffer_lost: None,
                stream_epochs: None,
                nonce: "AAAA".into(),
            },
        )
        .await;
    Env {
        _tmp: tmp,
        store,
        doc,
        instance,
        chats,
        relay,
        coordinator,
        metadata,
        sink,
        sink_fail,
        instance_rx,
        instance_tx,
    }
}

async fn env() -> Env {
    env_with_create_deadlines(Duration::from_millis(500), Duration::from_millis(200)).await
}

#[test]
fn prompt_delivery_phase_is_owned_by_the_deep_module() {
    let coordinator = include_str!("command_coordinator.rs");
    // 结构拆分后 prompt 交付职责横跨 prompt_delivery.rs 与
    // prompt_delivery_finalize.rs（终态/投递判定子模块），契约按职责域断言。
    let delivery = format!(
        "{}\n{}",
        include_str!("prompt_delivery.rs"),
        include_str!("prompt_delivery_finalize.rs")
    );
    for marker in [
        "RegisterPendingPromptEntry",
        ".mark_prompt_intent_durable(",
        ".mark_dispatch_barrier(",
        ".active_turn_idle(",
        "DocCommand::SetTurnTerminal",
        "DocCommand::SetPromptEntryDelivery",
    ] {
        assert!(
            !coordinator.contains(marker),
            "Coordinator regained prompt phase knowledge: {marker}"
        );
        assert!(
            delivery.contains(marker),
            "PromptDelivery no longer owns required phase: {marker}"
        );
    }
}

#[test]
fn session_catalog_sync_is_owned_by_the_deep_module() {
    let coordinator = include_str!("command_coordinator.rs");
    let catalog = include_str!("session_catalog_sync.rs");
    for marker in [
        "\"method\": \"session/list\"",
        "poll_once",
        "poll_target",
        "refresh_catalog_titles",
        "parse_session_list_response",
    ] {
        assert!(
            !coordinator.contains(marker),
            "Coordinator regained session catalog phase knowledge: {marker}"
        );
        assert!(
            catalog.contains(marker),
            "SessionCatalogSync no longer owns required phase: {marker}"
        );
    }
}

#[test]
fn workspace_compatibility_is_owned_by_the_deep_module() {
    let coordinator = include_str!("command_coordinator.rs");
    let compatibility = include_str!("workspace_compatibility.rs");
    for marker in [
        ".create_project(&id",
        ".mirror_legacy_workspace(",
        ".archive_project(&payload.workspace_id)",
        ".remove_workspace(&payload.workspace_id)",
    ] {
        assert!(
            !coordinator.contains(marker),
            "Coordinator regained workspace compatibility knowledge: {marker}"
        );
        assert!(
            compatibility.contains(marker),
            "WorkspaceCompatibility no longer owns required phase: {marker}"
        );
    }
}

#[test]
fn command_outcome_replay_is_owned_by_the_deep_module() {
    let coordinator = include_str!("command_coordinator.rs");
    // 结构拆分后 outcome broker 职责横跨 command_outcome_broker.rs 与
    // command_outcome_broker_terminal.rs / command_outcome_broker_recovery.rs
    // （终态发布与恢复判定子模块），契约按职责域断言。
    let broker = format!(
        "{}\n{}\n{}",
        include_str!("command_outcome_broker.rs"),
        include_str!("command_outcome_broker_terminal.rs"),
        include_str!("command_outcome_broker_recovery.rs")
    );
    for marker in [
        "terminal_watchers:",
        "terminal_failures:",
        "terminal_failure_overflow:",
        "fn attach_terminal_watcher_locked",
        "fn terminal_replay",
        "fn permission_recovery_payload_matches",
    ] {
        assert!(
            !coordinator.contains(marker),
            "Coordinator regained outcome ownership: {marker}"
        );
    }
    for marker in [
        "struct OutcomeState",
        "async fn adjudicate_existing",
        "async fn publish_terminal",
        "fn permission_recovery_payload_matches",
    ] {
        assert!(
            broker.contains(marker),
            "CommandOutcomeBroker lost required ownership: {marker}"
        );
    }
}

/// 主题子模块：公共 helper 与各主题测试（见模块级 doc 的分工说明）。
#[cfg(test)]
#[path = "command_coordinator_test_util.rs"]
mod command_coordinator_test_util;

#[cfg(test)]
#[path = "command_coordinator_test_metadata.rs"]
mod command_coordinator_test_metadata;

#[cfg(test)]
#[path = "command_coordinator_test_session_open.rs"]
mod command_coordinator_test_session_open;

#[cfg(test)]
#[path = "command_coordinator_test_resume_oauth.rs"]
mod command_coordinator_test_resume_oauth;

#[cfg(test)]
#[path = "command_coordinator_test_rewind.rs"]
mod command_coordinator_test_rewind;

#[cfg(test)]
#[path = "command_coordinator_test_prompt.rs"]
mod command_coordinator_test_prompt;

#[cfg(test)]
#[path = "command_coordinator_test_creation.rs"]
mod command_coordinator_test_creation;

#[cfg(test)]
#[path = "command_coordinator_test_creation_serial.rs"]
mod command_coordinator_test_creation_serial;

#[cfg(test)]
#[path = "command_coordinator_test_permission.rs"]
mod command_coordinator_test_permission;

#[cfg(test)]
#[path = "command_coordinator_test_permission_recovery.rs"]
mod command_coordinator_test_permission_recovery;

#[cfg(test)]
#[path = "command_coordinator_test_closure.rs"]
mod command_coordinator_test_closure;

#[cfg(test)]
#[path = "command_coordinator_test_workspace.rs"]
mod command_coordinator_test_workspace;

#[cfg(test)]
#[path = "command_coordinator_test_discovery.rs"]
mod command_coordinator_test_discovery;

#[cfg(test)]
#[path = "command_coordinator_test_session_list.rs"]
mod command_coordinator_test_session_list;

#[cfg(test)]
#[path = "command_coordinator_test_load.rs"]
mod command_coordinator_test_load;

#[cfg(test)]
#[path = "command_coordinator_test_load_replay.rs"]
mod command_coordinator_test_load_replay;

#[cfg(test)]
#[path = "command_coordinator_test_session_new.rs"]
mod command_coordinator_test_session_new;

#[cfg(test)]
#[path = "command_coordinator_test_prompt_l3.rs"]
mod command_coordinator_test_prompt_l3;

#[cfg(test)]
#[path = "command_coordinator_test_cancel.rs"]
mod command_coordinator_test_cancel;

#[cfg(test)]
#[path = "command_coordinator_test_prompt_timeout.rs"]
mod command_coordinator_test_prompt_timeout;

// 公共 helper 再导出：本文件测试与子模块（经 `use super::*`）共用。
// 注：official_permission_frame / mirror_pending_permissions 仅被 util 内的
// register_official_permission 调用，无需再导出（导出会产生 unused_imports）。
use self::command_coordinator_test_util::{
    bound_session, broadcast_active_turn_status, drive_prompt_l3, drive_rpc, load_action,
    prompt_action, register_official_permission, session_new_action, setup_active_turn,
};

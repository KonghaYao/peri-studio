//! Hub 装配与 chat 视图重建测试：`rebuild_chat_views`（SQLite 投影重建
//! live runtime 视图）+ `Hub::assemble` 全链路 smoke（§16 测试 20/31）。
//! StoreSink 镜像/广播/修复测试见 `hub_sink_test.rs`。

use std::sync::Arc;

use peri_studio_proto::conn::DocId;

use crate::control::StoreSink;
use crate::persist::{PersistConfig, Store};
use crate::state::doc_manager::{BatchConfig, DocManager};

/// 测试环境：临时数据目录 + 真实 Store/StoreSink/DocManager。
async fn env() -> (tempfile::TempDir, Arc<Store>, Arc<StoreSink>, DocManager) {
    let tmp = tempfile::tempdir().unwrap();
    let persist_cfg = PersistConfig {
        data_dir: tmp.path().to_path_buf(),
    };
    let store = Arc::new(Store::open(&persist_cfg).unwrap());
    let sink = Arc::new(StoreSink::new());
    let doc = DocManager::new(BatchConfig::default(), sink.clone());
    (tmp, store, sink, doc)
}

#[tokio::test]
async fn rebuild_chat_views_restores_live_chats_from_metadata() {
    use crate::control::{ChatRegistry, ChatState, Hub};
    use crate::persist::metadata::MetadataStore;

    let (tmp, _store, sink, doc) = env().await;
    let metadata = Arc::new(MetadataStore::open(tmp.path()).await.unwrap());
    metadata
        .create_project("p1", "Demo", tmp.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    let chat_id = "33333333-3333-3333-3333-333333333333";
    metadata
        .import_session("s1", "p1", "acp-1", "Live", "2026-08-13T00:00:00Z")
        .await
        .unwrap();
    metadata
        .record_session_runtime("s1", chat_id)
        .await
        .unwrap();
    // 活跃 chat 权威 = last_chat_id（open 时更新；runtime history 是身份
    // 追踪，恒 retired_at IS NULL，不构成活跃证据）。
    metadata.touch_session_open("s1", chat_id).await.unwrap();
    let chats = ChatRegistry::new(doc.registry());
    Hub::rebuild_chat_views(&metadata, &chats).await;

    // 状态 accepting（非终态——resume 路径可命中）+ 已绑定 acp 会话。
    let entry = chats.entry(chat_id).await.expect("chat registered");
    assert_eq!(entry.state, ChatState::Accepting);
    assert_eq!(entry.session_id.as_deref(), Some("acp-1"));
    assert_eq!(entry.instance_id, "local");
    assert_eq!(entry.workspace_id.as_deref(), Some("p1"));
    assert_eq!(chats.resolve("acp-1").await.as_deref(), Some(chat_id));
    // Registry Doc 投影同步（chats 段含条目，状态 accepting）。
    let (registry_update, _) = sink
        .snapshot(&DocId::REGISTRY)
        .await
        .expect("registry mirror exists after chat registration");
    use yrs::updates::decoder::Decode as _;
    use yrs::{Map, ReadTxn, Transact};
    let registry_doc = yrs::Doc::new();
    registry_doc
        .transact_mut()
        .apply_update(yrs::Update::decode_v1(&registry_update).unwrap())
        .unwrap();
    let txn = registry_doc.transact();
    let chats_map = txn
        .get_map("root")
        .and_then(|root| root.get(&txn, "chats"))
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
        .expect("registry chats map");
    let entry_map = chats_map
        .get(&txn, chat_id)
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
        .expect("rebuilt chat entry in registry doc");
    assert_eq!(
        entry_map
            .get(&txn, "status")
            .and_then(|value| value.cast::<String>().ok())
            .as_deref(),
        Some("accepting")
    );
}

#[tokio::test]
async fn rebuild_chat_views_skips_retired_and_archived_runtimes() {
    use crate::control::{ChatRegistry, Hub};
    use crate::persist::metadata::MetadataStore;

    let (tmp, _store, _sink, doc) = env().await;
    let metadata = Arc::new(MetadataStore::open(tmp.path()).await.unwrap());
    metadata
        .create_project("p1", "Demo", tmp.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    metadata
        .import_session("s1", "p1", "acp-1", "Retired", "2026-08-13T00:00:00Z")
        .await
        .unwrap();
    metadata
        .import_session("s2", "p1", "acp-2", "Archived", "2026-08-13T00:00:01Z")
        .await
        .unwrap();
    metadata
        .record_session_runtime("s1", "chat-retired")
        .await
        .unwrap();
    metadata
        .record_session_runtime("s2", "chat-archived")
        .await
        .unwrap();
    // 活跃 chat 权威 = last_chat_id：s1 切换到 chat-current（旧 chat 的
    // runtime 行仍存在且 retired_at 恒 NULL——不构成活跃证据）；s2 归档。
    metadata
        .record_session_runtime("s1", "chat-current")
        .await
        .unwrap();
    metadata
        .touch_session_open("s1", "chat-current")
        .await
        .unwrap();
    metadata.archive_session("s2").await.unwrap();

    let chats = ChatRegistry::new(doc.registry());
    Hub::rebuild_chat_views(&metadata, &chats).await;
    assert!(chats.entry("chat-retired").await.is_none());
    assert!(chats.entry("chat-archived").await.is_none());
    assert!(chats.entry("chat-current").await.is_some());
}

// ---------------------------------------------------------------------------
// Hub 装配 smoke test（任务点 4 / §16 测试 20 的 hub 面）：`Hub::assemble`
// 起真 server 于随机端口 + fake client（TUI）ws 连接，验证 §4.6 时序
// （auth → subscribe → 快照 → ready）与 Degraded 入口。
// ---------------------------------------------------------------------------

/// ws 帧读取辅助（跳过协议层 Ping；§4.6 帧面）。
async fn next_frame(
    stream: &mut futures::stream::SplitStream<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    >,
) -> peri_studio_proto::frame::Frame {
    use futures::StreamExt as _;
    loop {
        let msg = tokio::time::timeout(std::time::Duration::from_secs(5), stream.next())
            .await
            .expect("frame timeout")
            .expect("stream alive")
            .expect("no ws error");
        match msg {
            tokio_tungstenite::tungstenite::Message::Text(t) => {
                return peri_studio_proto::frame::Frame::parse(t.as_str()).expect("parse frame");
            }
            tokio_tungstenite::tungstenite::Message::Ping(_) => continue,
            other => panic!("unexpected ws message: {other:?}"),
        }
    }
}

#[tokio::test]
async fn hub_assemble_smoke_ready_sequence() {
    use base64::Engine as _;
    use futures::{SinkExt as _, StreamExt as _};
    use tokio_tungstenite::tungstenite::Message;

    let tmp = tempfile::tempdir().unwrap();
    let mut cfg = crate::config::Config::defaults();
    cfg.data_dir = tmp.path().join("data");
    cfg.config_dir = tmp.path().join("config");
    std::fs::create_dir_all(&cfg.config_dir).expect("create config dir (token store)");
    // e2e 客户端不回 pong：放宽心跳间隔避免业务流中 4501 误触发。
    cfg.heartbeat_interval = std::time::Duration::from_secs(60);
    cfg.offline_timeout = std::time::Duration::from_secs(1);

    let mut token_store =
        crate::auth::TokenStore::load(&cfg.config_dir.join(crate::auth::TOKENS_FILE)).unwrap();
    let client_rec = token_store
        .generate(crate::auth::TokenRole::Full, "tui")
        .unwrap();
    let auth = Arc::new(tokio::sync::Mutex::new(crate::auth::AuthService::new(
        token_store,
    )));

    let persist_cfg = PersistConfig {
        data_dir: cfg.data_dir.clone(),
    };
    let store = Arc::new(Store::open(&persist_cfg).unwrap());

    // 装配（§8.6）：StoreSink → DocManager → 注册表/协调器/广播器 → Gateway。
    let hub = Arc::new(
        crate::control::Hub::assemble(&cfg, store, auth)
            .await
            .unwrap(),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let gateway = hub.gateway.clone();
    let task = tokio::spawn(async move {
        let _ = gateway.run(listener).await;
    });

    // fake client（TUI）：auth → subscribe registry → 快照 → ready（§4.6
    // 步骤 1–4 顺序断言）。
    let url = format!("ws://{addr}/");
    let (ws, _) = tokio_tungstenite::connect_async(url).await.unwrap();
    let (mut sink, mut stream) = ws.split();
    sink.send(Message::Text(
        serde_json::to_string(&peri_studio_proto::frame::Frame::Auth(
            peri_studio_proto::conn::Auth {
                token: client_rec.token.clone(),
            },
        ))
        .unwrap()
        .into(),
    ))
    .await
    .unwrap();
    sink.send(Message::Text(
        serde_json::to_string(&peri_studio_proto::frame::Frame::YsyncSubscribe(
            peri_studio_proto::ysync::YsyncSubscribe {
                docs: vec![DocId::REGISTRY],
                client_capabilities: Vec::new(),
            },
        ))
        .unwrap()
        .into(),
    ))
    .await
    .unwrap();

    // 快照（ysync.update，带 projection_version，§4.6 步骤 3）。
    let snap = next_frame(&mut stream).await;
    match snap {
        peri_studio_proto::frame::Frame::YsyncUpdate(u) => {
            assert_eq!(u.doc, DocId::REGISTRY);
            assert!(
                u.projection_version.is_some(),
                "快照必带 projection_version"
            );
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&u.update)
                .unwrap();
            assert!(!bytes.is_empty());
        }
        other => panic!("expected snapshot, got {other:?}"),
    }
    // ready（§4.6 步骤 4：快照之后、缓冲 Action flush 前）。
    let ready = next_frame(&mut stream).await;
    match ready {
        peri_studio_proto::frame::Frame::Ready(r) => {
            assert!(r.projection_versions.contains_key(&DocId::REGISTRY));
        }
        other => panic!("expected ready, got {other:?}"),
    }

    // Degraded 入口（§17.2 + §8.4.1 不变量 4）：装配后（instance 重连对账
    // 前）Restarting 门禁——拒绝新 committed 承诺；instance 重连（hello）
    // 对账后开门 → Healthy。
    assert!(
        !hub.can_accept_committed(),
        "Restarting 期间不得接受新 committed（§8.4.1 不变量 4）"
    );
    hub.registry.clear_restarting().await.unwrap();
    assert!(hub.can_accept_committed());

    task.abort();
    drop(sink);
    let _ = stream;
}

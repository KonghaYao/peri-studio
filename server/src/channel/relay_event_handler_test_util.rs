//! RelayEventHandler 测试公共 helper（relay_event_handler_test.rs 拆分产物）。
//!
//! 拆分动机：relay_event_handler_test.rs（1181 行）超 500 行阈值，按主题拆
//! 分后，各主题（control 投影 / buffer 补推 / permission / disconnect）共用的
//! 环境装配与工具函数集中于此，避免跨文件复制。
//!
//! 职责边界：仅包含无断言意图的测试铺设工具——env()（临时目录 + Store/
//! DocManager/ChatRegistry/InstanceRegistry/RelayEventHandler 装配）、ev()
//! （instance/event 信封）、inject_user_entry()（§6.5 服务端单写注入）、
//! registry_chat_gap()（Registry Doc 镜像 gap 读取）。断言/测试数据一律留在
//! 各主题测试文件。
//!
//! 可见性说明：本模块以 `use super::*` 继承父模块的 import 与 S1/Env；父模块
//! 通过 `use self::relay_event_handler_test_util::{...}` 再导出供各主题模块经
//! `use super::*` 使用（mod 名以父模块名做前缀，避免 crate 内冲突）。
use super::*;
pub(super) async fn env() -> Env {
    let tmp = tempfile::tempdir().unwrap();
    let persist_cfg = PersistConfig {
        data_dir: tmp.path().to_path_buf(),
    };
    let store = Arc::new(Store::open(&persist_cfg).unwrap());
    let sink = Arc::new(StoreSink::new());
    let doc = Arc::new(DocManager::new(BatchConfig::default(), sink.clone()));
    let registry = doc.registry();
    let chats = ChatRegistry::new(registry);
    let instance = Arc::new(InstanceRegistry::new(
        Duration::from_secs(30),
        Duration::from_secs(1),
        chats.clone(),
    ));
    let relay = Arc::new(RelayEventHandler::new(
        doc.clone(),
        chats.clone(),
        instance.clone(),
        doc.registry(),
    ));
    // instance 上线（hello 登记 session_epochs: s1 → 0；instance 侧按进程
    // 归属 = hub session id 上报，§4.5.1）。
    let hello = InstanceHello {
        protocol_version: peri_studio_proto::version::PROTOCOL_VERSION,
        token: "tok".into(),
        hostname: "local".into(),
        caps: json!({}),
        buffered: None,
        buffer_lost: None,
        stream_epochs: Some([(S1.to_string(), 0u64)].into_iter().collect()),
        nonce: "AAAA".into(),
    };
    let (tx, _rx) = mpsc::channel(8);
    instance
        .on_hello("local", "tok-m", InstanceConn { tx }, &hello)
        .await;
    // 打开 session + binding（relay 投递前提）。chat store 记录须存在
    // （StoreSink 投递按 chat 归属解析；生产中由 create 流程建立）。
    let _ = store.create_chat(uuid::Uuid::parse_str(S1).unwrap());
    doc.open_chat(S1, "local", Some("t"), None, None)
        .await
        .unwrap();
    chats
        .register(S1, "local", Some("t"), "/", None)
        .await
        .unwrap();
    chats.bind(S1, "acp-1", true).await.unwrap();
    Env {
        _tmp: tmp,
        chats,
        relay,
        sink,
        doc,
        instance,
    }
}

/// instance/event 信封：chat_id = 进程归属（hub session id，§4.5.1）；
/// 帧内 sessionId = acp_session_id（binding 校验键，§495）。
pub(super) fn ev(seq: u64, frame: serde_json::Value) -> InstanceEvent {
    InstanceEvent {
        chat_id: S1.into(),
        epoch: 0,
        seq,
        frame,
    }
}

/// §6.5 服务端单写注入 user turn（RegisterUserEntry → user entry +
/// active_turn(accepting)）。聚合器已拒绝非回放 user_message_chunk 回声，
/// 测试铺设一律走注入命令路径（relay 测试的 seed 等价物）。
pub(super) async fn inject_user_entry(env: &Env, sid: &str) {
    let r = env
        .doc
        .submit_command(
            sid,
            DocCommand::RegisterUserEntry {
                turn_id: "t1".into(),
                entry_id: "t1:user".into(),
                text: "你好".into(),
                author_user_id: None,
                source_command_id: "active-turn-command".into(),
                created_at: "2026-08-07T00:00:00Z".into(),
            },
        )
        .await;
    assert!(matches!(r, SubmitResult::Applied(a) if a.applied));
}

/// 读取 Registry Doc 镜像中 `chats[S1].gap`：`Some(None)` = 追平（Null/
/// 缺字段）、`Some(Some(n))` = 缺口占位/计数、`None` = chat 条目缺失。
pub(super) async fn registry_chat_gap(env: &Env) -> Option<Option<f64>> {
    let (snapshot, _) = env
        .sink
        .snapshot(&peri_studio_proto::conn::DocId::REGISTRY)
        .await
        .expect("registry 镜像快照");
    use yrs::updates::decoder::Decode as _;
    use yrs::{Map as _, ReadTxn as _, Transact as _};
    let mirror = yrs::Doc::new();
    let parsed = yrs::Update::decode_v1(&snapshot).unwrap();
    mirror.transact_mut().apply_update(parsed).unwrap();
    let txn = mirror.transact();
    let root = txn.get_map("root").unwrap();
    let chats = root
        .get(&txn, "chats")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let sm = chats.get(&txn, S1)?.cast::<yrs::MapRef>().ok()?;
    match sm.get(&txn, "gap") {
        None | Some(yrs::Out::Any(yrs::Any::Null)) => Some(None),
        Some(yrs::Out::Any(yrs::Any::Number(n))) => Some(Some(n)),
        other => panic!("unexpected gap value: {other:?}"),
    }
}

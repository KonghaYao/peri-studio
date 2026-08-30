//! ChatChannel 测试的真实依赖装配，避免每个行为文件重复构造 coordinator。

use std::sync::Arc;

use crate::auth::{ConnectionCtx, TokenRole};
use crate::channel::{
    Broadcaster, CommandCoordinator, ConnectionRegistry, RelayEventHandler, DEFAULT_ACP_CMD,
};
use crate::control::{ChatRegistry, InstanceRegistry, StoreSink};
use crate::persist::{PersistConfig, Store};
use crate::state::doc_manager::{BatchConfig, DocManager};

pub(super) fn ctx(name: &str) -> ConnectionCtx {
    ConnectionCtx {
        token_id: format!("tok-{name}"),
        role: TokenRole::Full,
        name: name.to_string(),
        peer: "127.0.0.1:1234".parse().unwrap(),
        hostname: None,
        established_at: chrono::Utc::now(),
    }
}

pub(super) struct Env {
    pub(super) instance: Arc<InstanceRegistry>,
    pub(super) chats: ChatRegistry,
    pub(super) coordinator: Arc<CommandCoordinator>,
    pub(super) conns: Arc<ConnectionRegistry>,
    pub(super) broadcast: Arc<Broadcaster>,
}

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
        std::time::Duration::from_secs(30),
        std::time::Duration::from_secs(1),
        chats.clone(),
    ));
    let relay = Arc::new(RelayEventHandler::new(
        doc.clone(),
        chats.clone(),
        instance.clone(),
        doc.registry(),
    ));
    let coordinator = Arc::new(CommandCoordinator::with_l3_timeout(
        store,
        doc,
        instance.clone(),
        chats.clone(),
        relay,
        sink,
        &BatchConfig::default(),
        DEFAULT_ACP_CMD.iter().map(|s| s.to_string()).collect(),
        std::time::Duration::from_secs(1),
        std::time::Duration::from_secs(1),
        std::time::Duration::from_secs(1),
        std::time::Duration::from_secs(1),
    ));
    Env {
        instance,
        chats,
        coordinator,
        conns: Arc::new(ConnectionRegistry::new(200)),
        broadcast: Arc::new(Broadcaster::new(1_000_000, 2_000_000)),
    }
}

//! Gateway 集成测试（设计稿 §16 测试 20–23、31–33 的 ws 级子集）。
//!
//! 端到端：fake client（TUI）+ fake instance 均以真实 tokio-tungstenite ws
//! 客户端连接本地 Gateway，验证：认证时序、快照 → ready → 缓冲 flush、
//! hello 双向认证（auth_response HMAC 校验）、spawn → initialize →
//! session/new → binding → prompt → 事件流 → 客户端收到 y-sync 广播、
//! 断链语义（instance 断开 → turn interrupted + session gap）。
//!
//! epoch 约定：fake instance 上报 epoch=0（F4 聚合器 stream.epoch 以 0 起始；
//! 真实 instance 的 epoch=1 首事件问题为 F4 已知缺口，见输出遗留问题）。

use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use futures::{SinkExt as _, StreamExt as _};
use tokio::net::TcpListener;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use yrs::updates::decoder::Decode as _;
use yrs::{Map, ReadTxn, Transact};

use peri_studio_proto::frame::Frame;
use peri_studio_proto::hmac::{derive_mac_key, generate_challenge_nonce, mac_input, verify_mac};
use peri_studio_proto::version::PROTOCOL_VERSION;

use crate::auth::{AuthService, TokenRole, TokenStore, TOKENS_FILE};

use crate::config::Config;
use crate::control::Hub;
use crate::persist::{PersistConfig, Store};
use crate::state::factory::ROOT;

/// 主题子模块：instance 握手注册 / 端到端闭环 / 断链语义（见模块级 doc）。
#[cfg(test)]
#[path = "gateway_instance_test.rs"]
mod gateway_instance_test;

#[cfg(test)]
#[path = "gateway_e2e_test.rs"]
mod gateway_e2e_test;

#[cfg(test)]
#[path = "gateway_resource_e2e_test.rs"]
mod gateway_resource_e2e_test;

#[cfg(test)]
#[path = "gateway_disconnect_test.rs"]
mod gateway_disconnect_test;
// 装配工具（TestServer/start_server/next_frame/next_action_ack）与客户端
// 握手/认证主题留在本文件。
/// 测试装配：临时目录 + 双 token（instance/full）+ Hub。
struct TestServer {
    addr: std::net::SocketAddr,
    instance_token: String,
    client_token: String,
    client_token_id: String,
    _tmp: tempfile::TempDir,
    _hub_keep: Arc<Hub>,
    _task: tokio::task::JoinHandle<()>,
}

async fn start_server() -> TestServer {
    let tmp = tempfile::tempdir().unwrap();
    let _ = tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_test_writer()
        .try_init();
    let mut cfg = Config::defaults();
    cfg.data_dir = tmp.path().join("data");
    cfg.config_dir = tmp.path().join("config");
    std::fs::create_dir_all(&cfg.config_dir).expect("create config dir (token store)");
    // 心跳间隔放宽（60s）：e2e 客户端不回 pong（§4.7 契约——pong 超时
    // 3×interval 即 4501 关闭），短间隔会在多步业务流中误触发断开；心跳
    // 超时语义由 heartbeat_test 单测覆盖。
    cfg.heartbeat_interval = Duration::from_secs(60);
    cfg.offline_timeout = Duration::from_secs(1);
    cfg.spawn_timeout = Duration::from_secs(5);
    cfg.initialize_timeout = Duration::from_secs(5);
    cfg.binding_timeout = Duration::from_secs(5);

    let mut token_store = TokenStore::load(&cfg.config_dir.join(TOKENS_FILE)).unwrap();
    let instance_rec = token_store.generate(TokenRole::Instance, "local").unwrap();
    let client_rec = token_store.generate(TokenRole::Full, "tui").unwrap();
    let auth = Arc::new(tokio::sync::Mutex::new(AuthService::new(token_store)));

    let persist_cfg = PersistConfig {
        data_dir: cfg.data_dir.clone(),
    };
    let store = Arc::new(Store::open(&persist_cfg).unwrap());

    let hub = Arc::new(Hub::assemble(&cfg, store, auth).await.unwrap());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let gateway = hub.gateway.clone();
    let task = tokio::spawn(async move {
        let _ = gateway.run(listener).await;
    });
    TestServer {
        addr,
        instance_token: instance_rec.token,
        client_token: client_rec.token,
        client_token_id: client_rec.id,
        _tmp: tmp,
        _hub_keep: hub,
        _task: task,
    }
}

/// 工具：ws 连接（split stream）上的下一帧（文本）。
type SplitWs<'a> = futures::stream::SplitStream<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
>;

/// 工具：等待下一帧 ActionAck（跳过心跳 keep_alive 与状态广播——投影
/// 广播先于 committed 到达（§6.4 提交点纪律：user entry 投影在 L3 前），
/// 测试心跳间隔短于业务流，防止时序抖动）。
async fn next_action_ack(stream: &mut SplitWs<'_>) -> Frame {
    loop {
        match next_frame(stream).await {
            ack @ Frame::ActionAck(_) => return ack,
            Frame::KeepAlive(_) | Frame::Pong(_) | Frame::YsyncUpdate(_) => continue,
            other => return other,
        }
    }
}

async fn next_frame(stream: &mut SplitWs<'_>) -> Frame {
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(5), stream.next())
            .await
            .expect("frame timeout")
            .expect("stream alive")
            .expect("no ws error");
        match msg {
            Message::Text(t) => return Frame::parse(t.as_str()).expect("parse frame"),
            Message::Ping(_) => continue,
            other => panic!("unexpected ws message: {other:?}"),
        }
    }
}

#[tokio::test]
async fn client_handshake_snapshot_then_ready() {
    let server = start_server().await;
    let url = format!("ws://{}/", server.addr);
    let (ws, _) = connect_async(url).await.unwrap();
    let (mut sink, mut stream) = ws.split();

    // auth。
    sink.send(Message::Text(
        serde_json::to_string(&Frame::Auth(peri_studio_proto::conn::Auth {
            token: server.client_token.clone(),
        }))
        .unwrap()
        .into(),
    ))
    .await
    .unwrap();
    // subscribe registry。
    sink.send(Message::Text(
        serde_json::to_string(&Frame::YsyncSubscribe(
            peri_studio_proto::ysync::YsyncSubscribe {
                docs: vec![peri_studio_proto::conn::DocId::REGISTRY],
                client_capabilities: Vec::new(),
            },
        ))
        .unwrap()
        .into(),
    ))
    .await
    .unwrap();

    // 快照（ysync.update，带 projection_version）→ ready（§4.6 步骤 3/4）。
    let snap = next_frame(&mut stream).await;
    match snap {
        Frame::YsyncUpdate(u) => {
            assert_eq!(u.doc, peri_studio_proto::conn::DocId::REGISTRY);
            assert!(
                u.projection_version.is_some(),
                "快照必带 projection_version"
            );
            // 快照可解码。
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&u.update)
                .unwrap();
            assert!(!bytes.is_empty());
        }
        other => panic!("expected snapshot, got {other:?}"),
    }
    let ready = next_frame(&mut stream).await;
    match ready {
        Frame::Ready(r) => {
            assert!(r
                .projection_versions
                .contains_key(&peri_studio_proto::conn::DocId::REGISTRY));
        }
        other => panic!("expected ready, got {other:?}"),
    }
    drop(sink);
    let _ = stream;
}

#[tokio::test]
async fn client_bad_token_closed_no_data() {
    let server = start_server().await;
    let url = format!("ws://{}/", server.addr);
    let (ws, _) = connect_async(url).await.unwrap();
    let (mut sink, mut stream) = ws.split();
    sink.send(Message::Text(
        serde_json::to_string(&Frame::Auth(peri_studio_proto::conn::Auth {
            token: "bogus-token".into(),
        }))
        .unwrap()
        .into(),
    ))
    .await
    .unwrap();
    // 无任何业务数据（§9.2 失败语义：断开）。
    let msg = tokio::time::timeout(Duration::from_secs(5), stream.next())
        .await
        .expect("should close")
        .expect("stream")
        .expect("no error");
    match msg {
        Message::Close(_) => {}
        other => panic!("expected close, got {other:?}"),
    }
    drop(sink);
}

#[tokio::test]
async fn legacy_instance_gets_explicit_protocol_mismatch_before_auth_response() {
    let server = start_server().await;
    let url = format!("ws://{}/", server.addr);
    let (ws, _) = connect_async(url).await.unwrap();
    let (mut sink, mut stream) = ws.split();
    let hello = Frame::InstanceHello(peri_studio_proto::instance::InstanceHello {
        protocol_version: 0,
        token: server.instance_token.clone(),
        hostname: "legacy".into(),
        caps: serde_json::json!({}),
        buffered: None,
        buffer_lost: None,
        stream_epochs: None,
        nonce: base64::engine::general_purpose::STANDARD.encode(generate_challenge_nonce()),
    });
    sink.send(Message::Text(serde_json::to_string(&hello).unwrap().into()))
        .await
        .unwrap();

    let msg = tokio::time::timeout(Duration::from_secs(5), stream.next())
        .await
        .expect("protocol mismatch should close promptly")
        .expect("stream should produce close")
        .expect("close frame should be valid");
    let Message::Close(Some(close)) = msg else {
        panic!("expected close without auth response, got {msg:?}");
    };
    assert_eq!(u16::from(close.code), 4502);
    assert_eq!(close.reason, "instance protocol version mismatch");
}

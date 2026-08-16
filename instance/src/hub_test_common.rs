//! hub 测试共享辅助：fake ws server 驱动 + 配置/帧构造 + 断言工具。
//!
//! 各测试文件（hub_startup_test / hub_security_test / hub_flow_test /
//! hub_resync_test）经 `use super::hub_test_common::*;` 复用。

use super::*;
use std::fs;
use std::path::Path;
use std::sync::Once;
use std::time::Duration;

/// 临时调试：单测进程内启用 tracing（无输出时默认静默）。
pub(super) fn init_test_tracing() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let _ = tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| "peri_studio::instance=debug,tokio=warn".into()),
            )
            .with_test_writer()
            .try_init();
    });
}

use peri_studio_proto::hmac::{compute_mac, derive_mac_key, mac_input, CHALLENGE_NONCE_LEN};
use peri_studio_proto::instance::{InstanceHello, InstanceKill, InstanceSpawn};
use base64::Engine as _;
use futures::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use crate::child::{self, AcpProcess};

pub(super) const TOKEN: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

pub(super) async fn spawn_cleanup_target(session_id: &str) -> (Arc<AcpProcess>, i32) {
    let (tx, _rx) = mpsc::channel(64);
    let command = vec!["sh".to_string(), "-c".to_string(), "sleep 60".to_string()];
    let process = child::spawn(&command, ".", None, session_id, tx)
        .await
        .unwrap();
    let pgid = process.pgid();
    assert!(child::sys::kill_group(pgid, 0), "测试进程组必须存活");
    (process, pgid)
}

pub(super) async fn wait_group_exit(pgid: i32) -> bool {
    for _ in 0..50 {
        if !child::sys::kill_group(pgid, 0) {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    false
}

pub(super) fn prepare_owned_watermark(
    path: &Path,
    pgid: i32,
    fingerprint: Option<crate::buffer::ProcessFingerprint>,
) {
    let identity = super::startup::data_dir_identity(path).unwrap();
    let mut watermark = Watermark::load(path).unwrap();
    watermark.finalize_startup(identity).unwrap();
    watermark
        .record("cleanup-target", 4, 9, pgid, fingerprint)
        .unwrap();
}

pub(super) fn token_bytes() -> [u8; CHALLENGE_NONCE_LEN] {
    base64::engine::general_purpose::STANDARD
        .decode(TOKEN)
        .unwrap()
        .try_into()
        .unwrap()
}

/// 以 server 侧逻辑构造合法 auth_response。
pub(super) fn valid_auth_response(hello: &InstanceHello) -> peri_studio_proto::conn::AuthResponse {
    let nonce: [u8; CHALLENGE_NONCE_LEN] = base64::engine::general_purpose::STANDARD
        .decode(&hello.nonce)
        .unwrap()
        .try_into()
        .unwrap();
    let context = peri_studio_proto::hmac::generate_connection_context();
    let key = derive_mac_key(&token_bytes(), "instance");
    let input = mac_input(
        &nonce,
        &context,
        &peri_studio_proto::version::PROTOCOL_VERSION.to_string(),
        "instance",
    );
    let mac = compute_mac(&key, &input);
    peri_studio_proto::conn::AuthResponse {
        connection_context: base64::engine::general_purpose::STANDARD.encode(context),
        hmac: base64::engine::general_purpose::STANDARD.encode(mac),
    }
}

/// 测试配置（短超时/短间隔加速）。
pub(super) fn test_config(addr: std::net::SocketAddr, data_dir: &Path) -> InstanceConfig {
    let mut c = InstanceConfig::new(
        format!("ws://{addr}/instance"),
        TOKEN.to_string(),
        data_dir.to_path_buf(),
    );
    c.heartbeat_interval = Duration::from_millis(300);
    c.reconnect_base = Duration::from_millis(200);
    c.reconnect_max = Duration::from_secs(1);
    c.auth_timeout = Duration::from_secs(2);
    c.write_timeout = Duration::from_secs(2);
    c.kill_grace = Duration::from_millis(300);
    c
}

pub(super) fn spawn_frame(command_id: &str, chat_id: &str, script: &str) -> Frame {
    Frame::InstanceSpawn(InstanceSpawn {
        command_id: command_id.to_string(),
        chat_id: chat_id.to_string(),
        cmd: vec!["sh".to_string(), "-c".to_string(), script.to_string()],
        cwd: ".".to_string(),
        env: None,
    })
}

pub(super) fn kill_frame(command_id: &str, chat_id: &str, grace_ms: Option<u64>) -> Frame {
    Frame::InstanceKill(InstanceKill {
        command_id: command_id.to_string(),
        chat_id: chat_id.to_string(),
        grace: grace_ms,
    })
}

pub(super) type Ws = WebSocketStream<TcpStream>;
pub(super) type SplitSink = futures::stream::SplitSink<Ws, Message>;
pub(super) type SplitStream = futures::stream::SplitStream<Ws>;

pub(super) async fn accept_ws(listener: &TcpListener) -> Ws {
    let (stream, _) = listener.accept().await.unwrap();
    tokio_tungstenite::accept_async(stream).await.unwrap()
}

/// 服务端握手：读 hello → 回合法 auth_response → 返回 (sink, stream, hello)。
pub(super) async fn handshake_server(ws: Ws) -> (SplitSink, SplitStream, InstanceHello) {
    init_test_tracing();
    let mut ws = ws;
    let hello = loop {
        match ws.next().await {
            Some(Ok(Message::Text(t))) => {
                if let Ok(Frame::InstanceHello(h)) = Frame::parse(&t) {
                    break h;
                }
            }
            other => panic!("等待 hello 失败: {other:?}"),
        }
    };
    let resp = valid_auth_response(&hello);
    ws.send(Message::Text(
        serde_json::to_string(&Frame::AuthResponse(resp))
            .unwrap()
            .into(),
    ))
    .await
    .unwrap();
    let (sink, stream) = ws.split();
    (sink, stream, hello)
}

pub(super) async fn send_frame(sink: &mut SplitSink, frame: &Frame) {
    sink.send(Message::Text(serde_json::to_string(frame).unwrap().into()))
        .await
        .unwrap();
}

/// 读取下一帧（忽略未知/畸形帧；流结束 → panic）。
pub(super) async fn next_frame(stream: &mut SplitStream) -> Frame {
    loop {
        match stream.next().await {
            Some(Ok(Message::Text(t))) => {
                if let Ok(f) = Frame::parse(&t) {
                    return f;
                }
            }
            other => panic!("等待帧失败: {other:?}"),
        }
    }
}

/// 读取下一帧（跳过 heartbeat）。
pub(super) async fn next_frame_skipping_hb(stream: &mut SplitStream) -> Frame {
    loop {
        match next_frame(stream).await {
            Frame::InstanceHeartbeat(_) => continue,
            other => return other,
        }
    }
}

/// 限时读取下一帧（超时 → None；不含 heartbeat 过滤）。
pub(super) async fn next_frame_timeout(stream: &mut SplitStream, d: Duration) -> Option<Frame> {
    tokio::time::timeout(d, next_frame(stream)).await.ok()
}

pub(super) fn data_dir_contains(path: &Path, needle: &str) -> bool {
    let mut hit = false;
    fn walk(dir: &Path, needle: &str, hit: &mut bool) {
        if *hit {
            return;
        }
        if let Ok(entries) = fs::read_dir(dir) {
            for e in entries.flatten() {
                let p = e.path();
                if p.is_dir() {
                    walk(&p, needle, hit);
                } else if let Ok(content) = fs::read_to_string(&p) {
                    if content.contains(needle) {
                        *hit = true;
                        return;
                    }
                }
            }
        }
    }
    walk(path, needle, &mut hit);
    hit
}

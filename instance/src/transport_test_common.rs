//! transport 测试共享辅助：ws stub 驱动 + 配置/帧构造 + 事件收集工具。
//!
//! 各测试文件（transport_test / transport_handle_test）经
//! `use super::transport_test_common::*;` 复用。

use super::*;
use std::collections::HashMap;
use std::time::Duration;

use peri_studio_proto::hmac::{
    compute_mac, derive_mac_key, generate_connection_context, mac_input, CHALLENGE_NONCE_LEN,
};
use peri_studio_proto::instance::InstanceHello;
use base64::Engine as _;
use tokio::sync::mpsc;

use crate::auth::{AuthClient, HelloCtx};

pub(super) const TOKEN: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 32B 全 0 → base64

pub(super) fn token_bytes() -> [u8; CHALLENGE_NONCE_LEN] {
    base64::engine::general_purpose::STANDARD
        .decode(TOKEN)
        .unwrap()
        .try_into()
        .unwrap()
}

pub(super) fn auth_client() -> AuthClient {
    AuthClient::new(TOKEN.to_string()).unwrap()
}

pub(super) fn hello_ctx() -> HelloCtx {
    HelloCtx {
        hostname: "t".to_string(),
        buffered: false,
        buffer_lost: false,
        stream_epochs: HashMap::new(),
    }
}

/// 从 hello 帧取 nonce，构造合法 auth_response（server 侧逻辑）。
pub(super) fn valid_auth_response(hello: &InstanceHello) -> peri_studio_proto::conn::AuthResponse {
    let nonce: [u8; CHALLENGE_NONCE_LEN] = base64::engine::general_purpose::STANDARD
        .decode(&hello.nonce)
        .unwrap()
        .try_into()
        .unwrap();
    let context = generate_connection_context();
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

/// 伪造 auth_response（错误 MAC）。
pub(super) fn forged_auth_response(hello: &InstanceHello) -> peri_studio_proto::conn::AuthResponse {
    let mut r = valid_auth_response(hello);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&r.hmac)
        .unwrap();
    let mut forged = bytes;
    forged[0] ^= 0xFF;
    r.hmac = base64::engine::general_purpose::STANDARD.encode(forged);
    r
}

/// 启动 transport run（共享参数）。
pub(super) fn start_run(
    config: TransportConfig,
    events: mpsc::Sender<TransportEvent>,
) -> (TransportHandle, tokio::task::JoinHandle<anyhow::Result<()>>) {
    let (handle, cancel) = TransportHandle::new(64);
    let auth = auth_client();
    let make_hello = move || {
        let session = auth.begin();
        let hello = session.build_hello(&hello_ctx());
        (session, hello)
    };
    let task = tokio::spawn(run(config, make_hello, events, handle.clone(), cancel));
    (handle, task)
}

/// paused 时钟下的真实等待：yield 让 runtime 处理真实 I/O（paused 时钟下
/// `tokio::time::sleep` 不唤醒）。
pub(super) async fn real_wait_yield(d: Duration) {
    let deadline = std::time::Instant::now() + d;
    while std::time::Instant::now() < deadline {
        tokio::task::yield_now().await;
    }
}

/// 收集当前已到达的事件（非阻塞）。
pub(super) async fn drain_events(rx: &mut mpsc::Receiver<TransportEvent>) -> Vec<TransportEvent> {
    let mut out = Vec::new();
    tokio::task::yield_now().await;
    while let Ok(e) = rx.try_recv() {
        out.push(e);
    }
    out
}

/// 收集事件直到超时。
pub(super) async fn collect_events(
    rx: &mut mpsc::Receiver<TransportEvent>,
    timeout: Duration,
) -> Vec<TransportEvent> {
    let mut out = Vec::new();
    while let Ok(Some(e)) = tokio::time::timeout(timeout, rx.recv()).await {
        out.push(e);
    }
    out
}

pub(super) fn base_config(url: String) -> TransportConfig {
    TransportConfig {
        url,
        auth_timeout: Duration::from_secs(2),
        reconnect_base: Duration::from_secs(1),
        reconnect_max: Duration::from_secs(60),
        write_timeout: Duration::from_secs(2),
    }
}

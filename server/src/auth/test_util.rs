//! auth 测试共享工具（§6.2/§6.4）：tracing 捕获（`with_capture` +
//! `CaptureWriter`）、审计脱敏断言（`assert_audit_redacted`）、token store
//! 与握手辅助构造。

use std::io::Write;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use serde_json::json;
use tracing_subscriber::fmt::MakeWriter;

use peri_studio_proto::hmac::generate_challenge_nonce;
use peri_studio_proto::instance::InstanceHello;
use peri_studio_proto::version::PROTOCOL_VERSION;

use super::TokenStore;

pub(super) fn peer() -> SocketAddr {
    "127.0.0.1:40000".parse().unwrap()
}

pub(super) fn make_hello(token: &str, nonce_b64: &str) -> InstanceHello {
    InstanceHello {
        protocol_version: PROTOCOL_VERSION,
        token: token.to_string(),
        hostname: "test-host".to_string(),
        caps: json!({}),
        buffered: None,
        buffer_lost: None,
        stream_epochs: None,
        nonce: nonce_b64.to_string(),
    }
}

pub(super) fn new_nonce_b64() -> String {
    base64::engine::general_purpose::STANDARD.encode(generate_challenge_nonce())
}

pub(super) fn new_store(dir: &Path) -> TokenStore {
    TokenStore::load(&dir.join("tokens.toml")).unwrap()
}

/// 捕获 tracing 事件的 writer（json 到内存，供脱敏/字段集合断言）。
#[derive(Clone)]
pub(super) struct CaptureWriter(Arc<Mutex<Vec<u8>>>);

impl Write for CaptureWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().write(buf)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> MakeWriter<'a> for CaptureWriter {
    type Writer = CaptureWriter;
    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

/// 审计字段白名单（§9.4 / T8；§4.8 失败路径另携带 auth_failed_total 快照）。
pub(super) const AUDIT_FIELDS: &[&str] = &[
    "action",
    "command_id",
    "token_id",
    "result",
    "duration_ms",
    "auth_failed_total",
];

/// 在捕获 subscriber 下执行闭包，返回 (闭包结果, 捕获的日志文本)。
pub(super) fn with_capture<T>(f: impl FnOnce() -> T) -> (T, String) {
    let buf = Arc::new(Mutex::new(Vec::new()));
    let sub = tracing_subscriber::fmt()
        .json()
        .with_writer(CaptureWriter(buf.clone()))
        .with_target(true)
        .finish();
    let result = tracing::subscriber::with_default(sub, f);
    let text = String::from_utf8(buf.lock().unwrap().clone()).unwrap();
    (result, text)
}

/// 断言捕获日志：每行 JSON 的 fields 键 ⊆ 白名单，且不含 token 本体。
pub(super) fn assert_audit_redacted(text: &str, tokens: &[&str]) {
    assert!(!text.is_empty(), "应产生审计事件");
    for line in text.lines() {
        let v: serde_json::Value =
            serde_json::from_str(line).unwrap_or_else(|e| panic!("审计行非 JSON: {e}: {line}"));
        if let Some(fields) = v.get("fields").and_then(|f| f.as_object()) {
            for k in fields.keys() {
                assert!(
                    AUDIT_FIELDS.contains(&k.as_str()),
                    "审计事件含白名单外字段 {k}: {line}"
                );
            }
        }
        for t in tokens {
            assert!(!line.contains(t), "审计日志泄露 token 材料: {line}");
        }
    }
}

// ---------------------------------------------------------------------------
// T1 生成

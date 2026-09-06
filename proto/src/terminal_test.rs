//! terminal 协议单测：round-trip、方向常量与校验。

use crate::frame::Frame;
use crate::terminal::{
    decode_terminal_chunk, encode_terminal_chunk, validate_terminal_dims, validate_terminal_id,
    InstanceTerminalOpen, InstanceTerminalOpened, TerminalError, TerminalErrorCode,
    MAX_TERMINAL_CHUNK_BYTES, TERMINAL_PROTOCOL_VERSION,
};

#[test]
fn protocol_version_is_one() {
    assert_eq!(TERMINAL_PROTOCOL_VERSION, 1);
}

#[test]
fn terminal_open_roundtrip_json() {
    let raw = r#"{"t":"terminal_open","requestId":"r1","projectId":"p1","cols":80,"rows":24}"#;
    let frame = Frame::parse(raw).expect("parse");
    let json = serde_json::to_string(&frame).unwrap();
    let again = Frame::parse(&json).unwrap();
    assert_eq!(frame, again);
}

#[test]
fn instance_terminal_frames_roundtrip() {
    let open = Frame::InstanceTerminalOpen(InstanceTerminalOpen {
        request_id: "r1".into(),
        terminal_id: "term-1".into(),
        cwd: "/workspace".into(),
        cols: 120,
        rows: 40,
    });
    let opened = Frame::InstanceTerminalOpened(InstanceTerminalOpened {
        request_id: "r1".into(),
        terminal_id: "term-1".into(),
        ok: true,
        cwd: Some("/workspace".into()),
        cols: Some(120),
        rows: Some(40),
        error: None,
    });
    for frame in [open, opened] {
        let json = serde_json::to_string(&frame).unwrap();
        assert_eq!(Frame::parse(&json).unwrap(), frame);
    }
}

#[test]
fn strict_base64_rejects_garbage() {
    assert!(decode_terminal_chunk("!!!").is_err());
}

#[test]
fn chunk_size_bound() {
    let big = encode_terminal_chunk(&vec![0u8; MAX_TERMINAL_CHUNK_BYTES + 1]);
    assert!(decode_terminal_chunk(&big).is_err());
}

#[test]
fn validate_ids_and_dims() {
    assert!(validate_terminal_id("x", "terminalId").is_ok());
    assert!(validate_terminal_id("", "terminalId").is_err());
    assert!(validate_terminal_dims(80, 24).is_ok());
    assert!(validate_terminal_dims(1, 24).is_err());
}

#[test]
fn terminal_error_optional_fields_omit_none() {
    let frame = Frame::TerminalError(TerminalError {
        request_id: None,
        terminal_id: Some("t1".into()),
        code: TerminalErrorCode::Forbidden,
        message: "read-only".into(),
        retryable: false,
    });
    let v = serde_json::to_value(&frame).unwrap();
    assert!(v.get("requestId").is_none());
}

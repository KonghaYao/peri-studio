//! 帧解析错误分类测试（§4.8 向量 6 + §12.1）：unknown / malformed /
//! 重复 `t` 键 / payload 判别。

use crate::frame::{Frame, ProtoError};

/// 未知 `t` → `Unsupported`（§4.8 向量 6）。
#[test]
fn unknown_tag_is_unsupported() {
    for raw in [
        r#"{"t":"foo"}"#,
        r#"{"t":"ysync.foo"}"#,
        r#"{"t":"instance/unknown"}"#,
    ] {
        match Frame::parse(raw) {
            Err(ProtoError::Unsupported(_)) => {}
            other => panic!("expected Unsupported for {raw}, got {other:?}"),
        }
    }
    // 精确断言错误内容
    assert_eq!(
        Frame::parse(r#"{"t":"foo"}"#),
        Err(ProtoError::Unsupported("foo".into()))
    );
}

/// 畸形 JSON / 缺字段 → `Malformed`（不 panic，§12.1）。
#[test]
fn malformed_input_is_malformed() {
    for raw in [
        "not json",
        "",
        r#"{"t":42}"#,
        r#"{"t":"action"}"#,                     // 缺 type/payload
        r#"{"t":"instance/spawn"}"#,             // 缺必填字段
        r#"{"t":"ysync.subscribe","docs":[1]}"#, // 字段类型错误
    ] {
        match Frame::parse(raw) {
            Err(ProtoError::Malformed(_)) => {}
            other => panic!("expected Malformed for {raw:?}, got {other:?}"),
        }
    }
}

/// 已知 tag 但载荷畸形 → Malformed（区别于未知 tag 的 Unsupported）。
#[test]
fn known_tag_bad_payload_is_malformed_not_unsupported() {
    assert!(matches!(
        Frame::parse(r#"{"t":"action"}"#),
        Err(ProtoError::Malformed(_))
    ));
}

/// 未知 tag + 合法载荷 → Unsupported（回退路径分类正确性，区别于已知 tag 畸形）。
#[test]
fn unknown_tag_with_valid_payload_is_unsupported() {
    // 精确断言错误内容
    assert_eq!(
        Frame::parse(r#"{"t":"foo","x":1}"#),
        Err(ProtoError::Unsupported("foo".into()))
    );
    assert_eq!(
        Frame::parse(r#"{"t":"ysync.foo","docs":["chat:s1"]}"#),
        Err(ProtoError::Unsupported("ysync.foo".into()))
    );
}

/// 缺 `t` 字段 → Malformed（防回退路径误分类为 Unsupported）。
#[test]
fn missing_t_field_is_malformed() {
    for raw in [r#"{}"#, r#"{"a":1}"#] {
        match Frame::parse(raw) {
            Err(ProtoError::Malformed(_)) => {}
            other => panic!("expected Malformed for {raw}, got {other:?}"),
        }
    }
}

/// 顶层非对象 → Malformed（合法 JSON 但非帧对象）。
#[test]
fn top_level_non_object_is_malformed() {
    for raw in ["[1,2]", "\"str\"", "null", "42"] {
        match Frame::parse(raw) {
            Err(ProtoError::Malformed(_)) => {}
            other => panic!("expected Malformed for {raw}, got {other:?}"),
        }
    }
}

/// 重复 `t` 键 → 既定分类（review cross#2/cross#4，固定语义防漂移）。
///
/// RFC 8259 对重复键未定义行为，属畸形输入。serde 流式 internally tagged
/// 枚举取**第一个** `t` 键值；回退路径（`Value` BTreeMap 合并）取**最后**——
/// 两条路径对 `t` 的选取不一致，为已知差异（接受，无兼容义务）：
/// - `{"t":"foo","t":"action"}`：外层取 "foo"（unknown）→ 回退取最后 "action"
///   （在表）→ Malformed。旧 Value 两段式实现取最后 → `Ok(Action)`：从
///   「接受帧」变「拒绝帧」，接受此差异；
/// - `{"t":"action","t":"foo"}`：外层 "action" 合法但 payload 缺 `type` →
///   回退取最后 "foo"（不在表）→ Unsupported("foo")，与旧实现一致。
#[test]
fn duplicate_t_key_is_malformed_or_unsupported() {
    match Frame::parse(r#"{"t":"foo","t":"action"}"#) {
        Err(ProtoError::Malformed(_)) => {}
        other => panic!("expected Malformed for 首键未知+尾键在表, got {other:?}"),
    }
    assert_eq!(
        Frame::parse(r#"{"t":"action","t":"foo"}"#),
        Err(ProtoError::Unsupported("foo".into()))
    );
}

/// payload 判别（§12.1 + §8.5）：`chat/load` 携带 `{chatId, acpSessionId}`，
/// `chat/close` 仅 `{chatId}`——经 envelope 层 `type` 判别无歧义。
#[test]
fn load_vs_close_discrimination() {
    let load_raw = r#"{"t":"action","commandId":"c2","type":"chat/load","payload":{"chatId":"s1","acpSessionId":"acp-1"}}"#;
    let close_raw =
        r#"{"t":"action","commandId":"c3","type":"chat/close","payload":{"chatId":"s1"}}"#;

    let load = Frame::parse(load_raw).unwrap();
    let close = Frame::parse(close_raw).unwrap();
    assert!(matches!(load, Frame::Action(crate::action::ActionEnvelope::Load { .. })));
    assert!(matches!(close, Frame::Action(crate::action::ActionEnvelope::Close { .. })));
    assert_ne!(load, close, "same-shape payloads must not collapse");
    // §8.5：缺 acpSessionId 的 chat/load 视为畸形（目标会话必填）。
    assert!(Frame::parse(
        r#"{"t":"action","commandId":"c2","type":"chat/load","payload":{"chatId":"s1"}}"#
    )
    .is_err());
}

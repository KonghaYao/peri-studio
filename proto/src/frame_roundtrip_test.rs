//! 帧 round-trip 与注册表一致性测试（§12.1「M1 全帧 round-trip」）。

use std::str::FromStr;

use crate::conn::DocId;
use crate::frame::Frame;

use super::util::all_frames;

/// 每类帧：序列化 → 解析 → 再序列化 → 再解析，语义稳定（§12.1「M1 全帧
/// round-trip」）。含 `HashMap` 的帧（`ready` 等）JSON 键序不保证字节稳定，
/// 断言改为解析相等性。
#[test]
fn all_frame_tags_roundtrip() {
    for frame in all_frames() {
        let raw = serde_json::to_string(&frame).expect("serialize");
        let parsed = Frame::parse(&raw).expect("parse");
        assert_eq!(parsed, frame, "roundtrip mismatch for tag {}", frame.tag());
        let raw2 = serde_json::to_string(&parsed).expect("re-serialize");
        let parsed2 = Frame::parse(&raw2).expect("re-parse");
        assert_eq!(
            parsed2,
            parsed,
            "second roundtrip mismatch for tag {}",
            frame.tag()
        );
    }
}

/// tag() 与 FRAME_TAGS 注册表一一对应。
#[test]
fn every_frame_tag_is_registered() {
    let registered: Vec<&str> = crate::frame::FRAME_TAGS.iter().map(|t| t.0).collect();
    assert_eq!(registered.len(), 54, "terminal 帧加入后全表应有 54 个 tag");
    for frame in all_frames() {
        assert!(
            registered.contains(&frame.tag().0),
            "tag {} missing from FRAME_TAGS",
            frame.tag()
        );
    }
}

/// `DocId::REGISTRY` 必须等于 `hub:registry`（§5.2 表），且与
/// `FromStr` 解析结果一致——否则订阅/快照推送的键对不上。
#[test]
fn registry_doc_id_is_hub_registry() {
    assert_eq!(DocId::REGISTRY.as_str(), "hub:registry");
    assert_eq!(DocId::REGISTRY, DocId::from_str("hub:registry").unwrap());
    let v = serde_json::to_value(&DocId::REGISTRY).unwrap();
    assert_eq!(v, "hub:registry");
    // 与 chat/control 形态互异
    assert_ne!(DocId::REGISTRY, DocId::chat("registry"));
    assert_ne!(DocId::REGISTRY, DocId::session("registry"));
}

/// #4 DocId 前缀面：`session:` 白名单注册（FromStr）+ roundtrip（§5.2 表
/// `session:{cid}` 控制状态 Doc）；`control:` 死前缀不入白名单（代码实际
/// 只有 chat/session/hub 三前缀——固化死前缀语义）。
#[test]
fn session_docid_fromstr_parses() {
    let doc = DocId::from_str("session:s1").expect("session: 前缀应解析");
    assert_eq!(doc.as_str(), "session:s1", "as_str() roundtrip");
    assert_eq!(doc, DocId::session("s1"), "与构造器一致");
    // chat/hub 白名单不受影响。
    assert_eq!(DocId::from_str("chat:c1").unwrap().as_str(), "chat:c1");
    assert_eq!(DocId::from_str("hub:registry").unwrap(), DocId::REGISTRY);
    // control: 不入白名单（死前缀语义固化）。
    assert!(
        DocId::from_str("control:x").is_err(),
        "control: 是死前缀（代码实际用 session:）"
    );
    // 空 sid 段仍拒绝（§5.2 防注入）。
    assert!(DocId::from_str("session:").is_err(), "空 sid 仍拒绝");
}

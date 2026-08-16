use peri_studio_proto::frame::Frame;
use peri_studio_proto::rewind::RewindFileChangeKind;
use serde_json::json;

use super::{normalize_candidates, normalize_preview};

#[test]
fn candidates_are_normalized_and_body_whitespace_is_bounded() {
    let response = json!({
        "result": {
            "messages": [
                { "id": "message-2", "preview": "  fix\n the   parser  " },
                { "id": "message-1", "preview": "add tests" }
            ]
        }
    });
    let Frame::RewindCandidates(frame) =
        normalize_candidates("command-1", "chat-1", &response).unwrap()
    else {
        panic!("expected candidates frame")
    };
    assert_eq!(frame.candidates.len(), 2);
    assert_eq!(frame.candidates[0].message_id, "message-2");
    assert_eq!(frame.candidates[0].preview, "fix the parser");
}

#[test]
fn candidates_reject_more_than_sixty_four_entries() {
    let messages = (0..65)
        .map(|index| json!({ "id": format!("message-{index}"), "preview": "safe" }))
        .collect::<Vec<_>>();
    let response = json!({ "result": { "messages": messages } });

    assert!(normalize_candidates("command-1", "chat-1", &response).is_err());
}

#[test]
fn preview_accepts_only_relative_paths_exact_kinds_and_hex_fingerprint() {
    let response = json!({
        "result": {
            "preview_fingerprint": "A".repeat(64),
            "file_changes": [
                { "path": "./src/lib.rs", "kind": "edit" },
                { "path": "fixtures/new.txt", "kind": "write" }
            ]
        }
    });
    let Frame::RewindPreview(frame) =
        normalize_preview("command-1", "chat-1", "message-1", &response).unwrap()
    else {
        panic!("expected preview frame")
    };
    assert_eq!(frame.preview_fingerprint, "a".repeat(64));
    assert_eq!(frame.file_changes[0].path, "src/lib.rs");
    assert_eq!(frame.file_changes[0].kind, RewindFileChangeKind::Edit);
    assert_eq!(frame.file_changes[1].kind, RewindFileChangeKind::Write);
}

#[test]
fn preview_rejects_absolute_parent_and_unknown_kind() {
    for change in [
        json!({ "path": "/etc/passwd", "kind": "edit" }),
        json!({ "path": "../secret", "kind": "write" }),
        json!({ "path": "src/lib.rs", "kind": "delete" }),
    ] {
        let response = json!({
            "result": {
                "preview_fingerprint": "f".repeat(64),
                "file_changes": [change]
            }
        });
        assert!(normalize_preview("command-1", "chat-1", "message-1", &response).is_err());
    }
}

#[test]
fn preview_rejects_missing_or_malformed_fingerprint() {
    for fingerprint in [json!(null), json!("short"), json!("z".repeat(64))] {
        let response = json!({
            "result": {
                "preview_fingerprint": fingerprint,
                "file_changes": []
            }
        });
        assert!(normalize_preview("command-1", "chat-1", "message-1", &response).is_err());
    }
}

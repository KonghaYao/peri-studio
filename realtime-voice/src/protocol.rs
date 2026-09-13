//! Typeless JSON 事件：只读 `type` 与常见文本字段，未知对象不中断会话。

use serde_json::{json, Value};

use crate::format::PCM_ENCODING;

/// 已分类的入站事件。`Unknown` 保留原始 JSON，供对接方自行解释。
#[derive(Debug, Clone, PartialEq)]
pub enum VoiceEvent {
    SessionStarted,
    SpeechStart,
    Partial { text: String },
    Final { text: String },
    SessionFinished,
    Error { code: String, message: String },
    Ignored,
    Unknown(Value),
}

pub fn session_start_message(id: &str, sample_rate: u32, channels: u16, frame_ms: u32) -> String {
    json!({
        "type": "session.start",
        "id": id,
        "audio": {
            "encoding": PCM_ENCODING,
            "sampleRate": sample_rate,
            "channels": channels,
            "frameMs": frame_ms,
        }
    })
    .to_string()
}

pub fn session_finish_message(id: &str) -> String {
    json!({
        "type": "session.finish",
        "id": id,
    })
    .to_string()
}

/// Typeless Streaming API 的结束帧；与 `session.finish` 一起发送。
pub fn close_stream_message() -> String {
    json!({ "type": "close_stream" }).to_string()
}

pub fn parse_text_frame(text: &str) -> crate::Result<VoiceEvent> {
    let value: Value = serde_json::from_str(text)?;
    Ok(classify_event(&value))
}

/// 把已分类事件写回规范 JSON，供浏览器 / 代理下行。
pub fn event_to_json(event: &VoiceEvent) -> Option<Value> {
    Some(match event {
        VoiceEvent::SessionStarted => json!({"type": "session.started"}),
        VoiceEvent::SpeechStart => json!({"type": "speech.start"}),
        VoiceEvent::Partial { text } => json!({"type": "transcript.partial", "text": text}),
        VoiceEvent::Final { text } => json!({"type": "transcript.final", "text": text}),
        VoiceEvent::SessionFinished => json!({"type": "session.finished"}),
        VoiceEvent::Error { code, message } => {
            json!({"type": "error", "code": code, "message": message})
        }
        VoiceEvent::Unknown(value) => value.clone(),
        VoiceEvent::Ignored => return None,
    })
}

pub fn classify_event(value: &Value) -> VoiceEvent {
    let Some(obj) = value.as_object() else {
        return VoiceEvent::Unknown(value.clone());
    };
    let kind = first_str(obj, &["type", "event", "kind"])
        .map(normalize_type)
        .unwrap_or_default();
    let text = lookup_text(value);
    let message = first_str(obj, &["message", "error_msg"])
        .or_else(|| first_str(obj, &["error"]).filter(|value| !value.is_empty()))
        .or_else(|| nested_str(value, &["data", "payload", "error"], &["message", "error"]))
        .unwrap_or("")
        .to_string();
    let code = first_str(obj, &["code", "error_code"])
        .or_else(|| nested_str(value, &["error"], &["code", "error_code"]))
        .unwrap_or("")
        .to_string();

    match kind.as_str() {
        "session.started" | "started" | "task.started" => VoiceEvent::SessionStarted,
        "speech.start" | "vad.start" | "speech_start" => VoiceEvent::SpeechStart,
        "transcript.partial" | "interim" | "partial" | "delta" => VoiceEvent::Partial { text },
        "transcript.final" | "final" | "result" => VoiceEvent::Final { text },
        "error" => VoiceEvent::Error { code, message },
        "session.finished" | "finished" | "session.complete" => VoiceEvent::SessionFinished,
        "heartbeat" | "ping" | "pong" | "keep_alive" => VoiceEvent::Ignored,
        _ => VoiceEvent::Unknown(value.clone()),
    }
}

fn normalize_type(raw: &str) -> String {
    raw.trim().to_ascii_lowercase().replace(['_', '-'], ".")
}

fn lookup_text(value: &Value) -> String {
    let Some(obj) = value.as_object() else {
        return String::new();
    };
    first_str(obj, &["text", "transcript", "result"])
        .or_else(|| {
            nested_str(
                value,
                &["data", "payload", "result"],
                &["text", "transcript"],
            )
        })
        .unwrap_or("")
        .to_string()
}

fn first_str<'a>(obj: &'a serde_json::Map<String, Value>, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| obj.get(*key).and_then(Value::as_str))
}

fn nested_str<'a>(value: &'a Value, wrappers: &[&str], keys: &[&str]) -> Option<&'a str> {
    let obj = value.as_object()?;
    for wrapper in wrappers {
        if let Some(inner) = obj.get(*wrapper).and_then(Value::as_object) {
            if let Some(text) = first_str(inner, keys) {
                return Some(text);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_message_is_pcm_json() {
        let raw = session_start_message("abc", 16_000, 1, 20);
        let v: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["type"], "session.start");
        assert_eq!(v["id"], "abc");
        assert_eq!(v["audio"]["encoding"], "pcm_s16le");
        assert_eq!(v["audio"]["sampleRate"], 16_000);
        assert_eq!(v["audio"]["frameMs"], 20);
    }

    #[test]
    fn classifies_aliases_and_nested_text() {
        let partial = serde_json::json!({"type":"INTERIM","data":{"text":"hello"}});
        assert_eq!(
            classify_event(&partial),
            VoiceEvent::Partial {
                text: "hello".into()
            }
        );
        let final_ev = serde_json::json!({"event":"transcript_final","transcript":"ok"});
        assert_eq!(
            classify_event(&final_ev),
            VoiceEvent::Final { text: "ok".into() }
        );
        assert_eq!(
            classify_event(&serde_json::json!({"type":"heartbeat"})),
            VoiceEvent::Ignored
        );
        let unknown = serde_json::json!({"type":"vendor.foo","n":1});
        assert!(matches!(classify_event(&unknown), VoiceEvent::Unknown(_)));
        let typeless = serde_json::json!({
            "type":"result",
            "result":{"transcript":"你好"}
        });
        assert_eq!(
            classify_event(&typeless),
            VoiceEvent::Final {
                text: "你好".into()
            }
        );
        let typeless_err = serde_json::json!({
            "type":"error",
            "error":{"code":"INVALID_REQUEST","message":"model required"}
        });
        assert_eq!(
            classify_event(&typeless_err),
            VoiceEvent::Error {
                code: "INVALID_REQUEST".into(),
                message: "model required".into()
            }
        );
    }

    #[test]
    fn parse_text_rejects_non_json() {
        assert!(parse_text_frame("not-json").is_err());
    }

    #[test]
    fn event_to_json_skips_ignored() {
        assert!(event_to_json(&VoiceEvent::Ignored).is_none());
        assert_eq!(
            event_to_json(&VoiceEvent::Final { text: "hi".into() }).unwrap()["type"],
            "transcript.final"
        );
    }
}

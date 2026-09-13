//! 浏览器 `/voice` → 上游 typeless realtime 的异步代理。
//!
//! API key 只在 server 连上游时使用，不回传浏览器；本任务在独立 tokio
//! 任务里跑，不占用 command coordinator。

use futures::{SinkExt as _, StreamExt as _};
use peri_realtime_voice::{event_to_json, LiveVoiceSession, VoiceEvent};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;
use tracing::{debug, warn};

use crate::channel::gateway::Gateway;
use crate::channel::ConnId;

pub(super) const VOICE_PATH: &str = "/voice";

impl Gateway {
    pub(super) async fn handle_voice_connection(
        &self,
        conn_id: ConnId,
        mut sink: futures::stream::SplitSink<WebSocketStream<tokio::net::TcpStream>, Message>,
        mut stream: futures::stream::SplitStream<WebSocketStream<tokio::net::TcpStream>>,
    ) {
        let Some(config) = self.cfg.realtime_voice_client_config() else {
            warn!(conn_id, "voice session rejected: upstream not configured");
            let _ = sink
                .send(Message::Text(
                    serde_json::json!({
                        "type": "error",
                        "code": "voice_not_configured",
                        "message": "realtime voice is not configured",
                    })
                    .to_string()
                    .into(),
                ))
                .await;
            self.finish_connection(conn_id, &mut sink, 4503, "voice not configured")
                .await;
            return;
        };

        let mut live = match LiveVoiceSession::open(config).await {
            Ok(live) => live,
            Err(error) => {
                warn!(conn_id, error = %error, "voice upstream open failed");
                let _ = sink
                    .send(Message::Text(
                        serde_json::json!({
                            "type": "error",
                            "code": "voice_upstream",
                            "message": "failed to open realtime voice session",
                        })
                        .to_string()
                        .into(),
                    ))
                    .await;
                self.finish_connection(conn_id, &mut sink, 1011, "voice upstream failed")
                    .await;
                return;
            }
        };

        // 立刻下行，避免 DevTools 里看起来只有出站 PCM。
        let _ = sink
            .send(Message::Text(
                serde_json::json!({"type": "session.started"})
                    .to_string()
                    .into(),
            ))
            .await;

        let mut browser_open = true;
        loop {
            tokio::select! {
                inbound = stream.next(), if browser_open => {
                    match inbound {
                        Some(Ok(Message::Binary(bytes))) => {
                            if let Err(error) = live.push_pcm(bytes.to_vec()) {
                                debug!(conn_id, error = %error, "voice pcm dropped");
                                live.finish_audio();
                                browser_open = false;
                            }
                        }
                        Some(Ok(Message::Text(text))) => {
                            if matches_finish(&text) {
                                live.finish_audio();
                            }
                        }
                        Some(Ok(Message::Ping(payload))) => {
                            let _ = sink.send(Message::Pong(payload)).await;
                        }
                        Some(Ok(Message::Pong(_))) | Some(Ok(Message::Frame(_))) => {}
                        Some(Ok(Message::Close(_))) | None => {
                            live.finish_audio();
                            browser_open = false;
                        }
                        Some(Err(error)) => {
                            debug!(conn_id, error = %error, "voice browser socket error");
                            live.finish_audio();
                            browser_open = false;
                        }
                    }
                }
                event = live.recv_event() => {
                    let Some(event) = event else { break; };
                    let stop = matches!(
                        event,
                        VoiceEvent::SessionFinished | VoiceEvent::Error { .. }
                    );
                    if let Some(value) = event_to_json(&event) {
                        if sink
                            .send(Message::Text(value.to_string().into()))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    if stop {
                        break;
                    }
                }
            }
        }

        live.finish_audio();
        while let Some(event) = live.recv_event().await {
            if let Some(value) = event_to_json(&event) {
                let _ = sink.send(Message::Text(value.to_string().into())).await;
            }
        }
        if live.join().await.is_err() {
            let _ = sink
                .send(Message::Text(
                    serde_json::json!({
                        "type": "error",
                        "code": "voice_upstream",
                        "message": "realtime voice session ended unexpectedly",
                    })
                    .to_string()
                    .into(),
                ))
                .await;
        }
        self.finish_connection(conn_id, &mut sink, 1000, "voice session closed")
            .await;
    }
}

fn matches_finish(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|value| {
            value.get("type").and_then(|t| t.as_str()).map(|t| {
                t.eq_ignore_ascii_case("session.finish") || t.eq_ignore_ascii_case("close_stream")
            })
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::matches_finish;

    #[test]
    fn finish_alias_is_recognized() {
        assert!(matches_finish(r#"{"type":"session.finish"}"#));
        assert!(matches_finish(r#"{"type":"close_stream"}"#));
        assert!(!matches_finish(r#"{"type":"session.start"}"#));
        assert!(!matches_finish("not-json"));
    }
}

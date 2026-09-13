//! WebSocket 实时会话：JSON 控制帧 + 二进制 PCM。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use futures::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, WebSocketStream};
use uuid::Uuid;

use crate::audio::{split_pcm_frames, PcmFramer};
use crate::config::VoiceConfig;
use crate::protocol::{
    parse_text_frame, session_finish_message, session_start_message, VoiceEvent,
};
use crate::{Error, Result};

type WsStream = WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

pub struct VoiceClient {
    config: VoiceConfig,
}

impl VoiceClient {
    pub fn new(config: VoiceConfig) -> Self {
        Self { config }
    }

    pub fn config(&self) -> &VoiceConfig {
        &self.config
    }

    /// 发送完整 PCM，返回最后一条终稿文本。
    pub async fn transcribe(&mut self, pcm: &[u8], paced: bool) -> Result<String> {
        let mut final_text = String::new();
        self.transcribe_stream(pcm, paced, |event| {
            if let VoiceEvent::Final { text } = event {
                final_text = text.clone();
            }
        })
        .await?;
        Ok(final_text)
    }

    /// 发送完整 PCM，每条事件回调一次。
    pub async fn transcribe_stream<F>(
        &mut self,
        pcm: &[u8],
        paced: bool,
        mut on_event: F,
    ) -> Result<String>
    where
        F: FnMut(&VoiceEvent),
    {
        let framer = PcmFramer::new(
            self.config.sample_rate,
            self.config.channels,
            self.config.frame_duration_ms,
        )?;
        let frames = split_pcm_frames(pcm, &framer);
        let session_id = Uuid::new_v4().to_string();
        let finished = Arc::new(AtomicBool::new(false));

        let mut ws = self.connect().await?;
        self.start_session(&mut ws, &session_id, &mut on_event)
            .await?;

        let (mut sink, mut stream) = ws.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<VoiceEvent>();
        let recv_finished = Arc::clone(&finished);
        let recv_task = tokio::spawn(async move {
            drain_events(&mut stream, &recv_finished, tx).await;
        });

        let send_finished = Arc::clone(&finished);
        let frame_ms = self.config.frame_duration_ms;
        let send_session = session_id.clone();
        let send_task = tokio::spawn(async move {
            for frame in &frames {
                if send_finished.load(Ordering::Relaxed) {
                    break;
                }
                sink.send(Message::Binary(frame.clone().into()))
                    .await
                    .map_err(|e| Error::Ws(format!("send audio: {e}")))?;
                if paced {
                    tokio::time::sleep(std::time::Duration::from_millis(u64::from(frame_ms))).await;
                }
            }
            if !send_finished.load(Ordering::Relaxed) {
                sink.send(Message::Text(session_finish_message(&send_session).into()))
                    .await
                    .map_err(|e| Error::Ws(format!("send session.finish: {e}")))?;
            }
            Ok::<(), Error>(())
        });

        let mut final_text = String::new();
        while let Ok(Some(event)) = tokio::time::timeout(self.config.recv_timeout, rx.recv()).await
        {
            if matches!(event, VoiceEvent::Ignored) {
                continue;
            }
            if let VoiceEvent::Final { text } = &event {
                final_text = text.clone();
            }
            on_event(&event);
            if let VoiceEvent::Error { message, .. } = &event {
                finished.store(true, Ordering::Relaxed);
                let _ = send_task.await;
                recv_task.abort();
                return Err(Error::Session(message.clone()));
            }
            if matches!(event, VoiceEvent::SessionFinished) {
                break;
            }
        }

        finished.store(true, Ordering::Relaxed);
        let _ = send_task.await;
        recv_task.abort();
        Ok(final_text)
    }

    /// 从 PCM 异步源实时上传，直到源结束。
    pub async fn transcribe_realtime<S, F>(&mut self, mut source: S, mut on_event: F) -> Result<()>
    where
        S: futures::Stream<Item = Result<Vec<u8>>> + Unpin + Send + 'static,
        F: FnMut(&VoiceEvent),
    {
        let framer = PcmFramer::new(
            self.config.sample_rate,
            self.config.channels,
            self.config.frame_duration_ms,
        )?;
        let bytes_per_frame = framer.bytes_per_frame();
        let session_id = Uuid::new_v4().to_string();
        let finished = Arc::new(AtomicBool::new(false));

        let mut ws = self.connect().await?;
        self.start_session(&mut ws, &session_id, &mut on_event)
            .await?;

        let (mut sink, mut stream) = ws.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<VoiceEvent>();
        let recv_finished = Arc::clone(&finished);
        let recv_task = tokio::spawn(async move {
            drain_events(&mut stream, &recv_finished, tx).await;
        });

        let send_finished = Arc::clone(&finished);
        let send_session = session_id.clone();
        let send_task = tokio::spawn(async move {
            let mut pcm_buffer = Vec::new();
            while let Some(chunk) = source.next().await {
                if send_finished.load(Ordering::Relaxed) {
                    break;
                }
                pcm_buffer.extend(chunk?);
                while pcm_buffer.len() >= bytes_per_frame {
                    let frame: Vec<u8> = pcm_buffer.drain(..bytes_per_frame).collect();
                    sink.send(Message::Binary(frame.into()))
                        .await
                        .map_err(|e| Error::Ws(format!("send audio: {e}")))?;
                }
            }
            if !send_finished.load(Ordering::Relaxed) {
                if !pcm_buffer.is_empty() {
                    pcm_buffer.resize(bytes_per_frame, 0);
                    sink.send(Message::Binary(pcm_buffer.into()))
                        .await
                        .map_err(|e| Error::Ws(format!("send last audio: {e}")))?;
                }
                sink.send(Message::Text(session_finish_message(&send_session).into()))
                    .await
                    .map_err(|e| Error::Ws(format!("send session.finish: {e}")))?;
            }
            Ok::<(), Error>(())
        });

        while let Some(event) = rx.recv().await {
            if matches!(event, VoiceEvent::Ignored) {
                continue;
            }
            on_event(&event);
            if matches!(
                event,
                VoiceEvent::Error { .. } | VoiceEvent::SessionFinished
            ) {
                if let VoiceEvent::Error { message, .. } = event {
                    finished.store(true, Ordering::Relaxed);
                    let _ = send_task.await;
                    recv_task.abort();
                    return Err(Error::Session(message));
                }
                break;
            }
        }

        finished.store(true, Ordering::Relaxed);
        match send_task.await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(e),
            Err(e) => return Err(Error::Session(format!("send task join: {e}"))),
        }
        recv_task.abort();
        Ok(())
    }

    async fn connect(&self) -> Result<WsStream> {
        let url = self.config.endpoint()?;
        if !(url.starts_with("ws://") || url.starts_with("wss://")) {
            return Err(Error::Ws("url must be ws:// or wss://".into()));
        }
        let mut request = url
            .into_client_request()
            .map_err(|e| Error::Ws(format!("build request: {e}")))?;
        if let Some(token) = &self.config.token {
            let value = HeaderValue::from_str(&format!("Bearer {token}"))
                .map_err(|e| Error::Ws(format!("invalid token header: {e}")))?;
            request.headers_mut().insert(
                tokio_tungstenite::tungstenite::http::header::AUTHORIZATION,
                value,
            );
        }
        for (name, value) in &self.config.headers {
            let header_value = HeaderValue::from_str(value)
                .map_err(|e| Error::Ws(format!("invalid header {name}: {e}")))?;
            request.headers_mut().insert(
                name.parse::<tokio_tungstenite::tungstenite::http::HeaderName>()
                    .map_err(|e| Error::Ws(format!("invalid header name: {e}")))?,
                header_value,
            );
        }

        let (ws, _) = tokio::time::timeout(self.config.connect_timeout, connect_async(request))
            .await
            .map_err(|_| Error::Ws("connect timeout".into()))?
            .map_err(|e| Error::Ws(format!("connect: {e}")))?;
        Ok(ws)
    }

    async fn start_session<F>(
        &self,
        ws: &mut WsStream,
        session_id: &str,
        on_event: &mut F,
    ) -> Result<()>
    where
        F: FnMut(&VoiceEvent),
    {
        let start = session_start_message(
            session_id,
            self.config.sample_rate,
            self.config.channels,
            self.config.frame_duration_ms,
        );
        ws.send(Message::Text(start.into()))
            .await
            .map_err(|e| Error::Ws(format!("send session.start: {e}")))?;

        // 对端可以不回 session.started；超时后仍继续送音频。
        let handshake = tokio::time::timeout(self.config.connect_timeout, async {
            loop {
                match ws.next().await {
                    Some(Ok(Message::Text(text))) => {
                        let event = parse_text_frame(&text)?;
                        if matches!(event, VoiceEvent::Ignored) {
                            continue;
                        }
                        if let VoiceEvent::Error { message, .. } = &event {
                            return Err(Error::Session(format!("session.start failed: {message}")));
                        }
                        on_event(&event);
                        if matches!(event, VoiceEvent::SessionStarted | VoiceEvent::Unknown(_)) {
                            return Ok(());
                        }
                    }
                    Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
                    Some(Ok(Message::Close(_))) | None => {
                        return Err(Error::Ws("socket closed during session.start".into()))
                    }
                    Some(Ok(_)) => continue,
                    Some(Err(e)) => return Err(Error::Ws(format!("recv: {e}"))),
                }
            }
        })
        .await;
        match handshake {
            Ok(result) => result,
            Err(_) => Ok(()),
        }
    }
}

async fn drain_events<S>(
    stream: &mut S,
    finished: &AtomicBool,
    tx: mpsc::UnboundedSender<VoiceEvent>,
) where
    S: StreamExt<Item = std::result::Result<Message, tokio_tungstenite::tungstenite::Error>>
        + Unpin,
{
    while !finished.load(Ordering::Relaxed) {
        match stream.next().await {
            Some(Ok(Message::Text(text))) => match parse_text_frame(&text) {
                Ok(event) => {
                    let stop = matches!(
                        event,
                        VoiceEvent::Error { .. } | VoiceEvent::SessionFinished
                    );
                    if tx.send(event).is_err() {
                        break;
                    }
                    if stop {
                        break;
                    }
                }
                Err(_) => continue,
            },
            Some(Ok(Message::Close(_))) | None => break,
            Some(Ok(_)) => continue,
            Some(Err(_)) => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::StreamExt;
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;

    #[tokio::test]
    async fn loopback_sends_start_pcm_and_finish() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = accept_async(stream).await.unwrap();
            let first = ws.next().await.unwrap().unwrap();
            let Message::Text(start) = first else {
                panic!("expected session.start text");
            };
            let value: serde_json::Value = serde_json::from_str(&start).unwrap();
            assert_eq!(value["type"], "session.start");
            assert_eq!(value["audio"]["encoding"], "pcm_s16le");
            ws.send(Message::Text(
                serde_json::json!({"type":"session.started"})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();

            let audio = ws.next().await.unwrap().unwrap();
            let Message::Binary(buf) = audio else {
                panic!("expected pcm binary");
            };
            assert_eq!(buf.len(), 640);

            let finish = ws.next().await.unwrap().unwrap();
            let Message::Text(body) = finish else {
                panic!("expected session.finish text");
            };
            let value: serde_json::Value = serde_json::from_str(&body).unwrap();
            assert_eq!(value["type"], "session.finish");

            ws.send(Message::Text(
                serde_json::json!({"type":"transcript.final","text":"hello world"})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
            ws.send(Message::Text(
                serde_json::json!({"type":"session.finished"})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        });

        let mut client = VoiceClient::new(VoiceConfig::new().with_url(format!("ws://{addr}/")));
        let pcm = vec![0u8; 640];
        let text = client.transcribe(&pcm, false).await.unwrap();
        assert_eq!(text, "hello world");
        server.await.unwrap();
    }
}

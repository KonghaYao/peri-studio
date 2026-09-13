//! 异步活会话：PCM 与事件走 channel，不阻塞调用方。

use std::pin::Pin;
use std::task::{Context, Poll};

use futures::Stream;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::client::VoiceClient;
use crate::config::VoiceConfig;
use crate::protocol::VoiceEvent;
use crate::{Error, Result};

/// 上游实时会话的两端：推 PCM、收 typeless 事件。
pub struct LiveVoiceSession {
    audio_tx: Option<mpsc::UnboundedSender<Result<Vec<u8>>>>,
    event_rx: mpsc::UnboundedReceiver<VoiceEvent>,
    join: JoinHandle<Result<()>>,
}

impl LiveVoiceSession {
    pub async fn open(config: VoiceConfig) -> Result<Self> {
        let (audio_tx, audio_rx) = mpsc::unbounded_channel();
        let (event_tx, event_rx) = mpsc::unbounded_channel();
        let join = tokio::spawn(async move {
            VoiceClient::new(config)
                .transcribe_realtime(PcmReceiver { rx: audio_rx }, move |event| {
                    let _ = event_tx.send(event.clone());
                })
                .await
        });
        Ok(Self {
            audio_tx: Some(audio_tx),
            event_rx,
            join,
        })
    }

    pub fn push_pcm(&self, frame: Vec<u8>) -> Result<()> {
        let tx = self
            .audio_tx
            .as_ref()
            .ok_or_else(|| Error::Session("voice session already finishing".into()))?;
        tx.send(Ok(frame))
            .map_err(|_| Error::Session("upstream audio channel closed".into()))
    }

    /// 关闭音频输入，触发上游 `session.finish`。
    pub fn finish_audio(&mut self) {
        self.audio_tx.take();
    }

    pub async fn recv_event(&mut self) -> Option<VoiceEvent> {
        self.event_rx.recv().await
    }

    pub async fn join(self) -> Result<()> {
        match self.join.await {
            Ok(result) => result,
            Err(e) => Err(Error::Session(format!("voice session join: {e}"))),
        }
    }
}

struct PcmReceiver {
    rx: mpsc::UnboundedReceiver<Result<Vec<u8>>>,
}

impl Stream for PcmReceiver {
    type Item = Result<Vec<u8>>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.rx.poll_recv(cx)
    }
}

impl VoiceClient {
    pub async fn open_live_session(&self) -> Result<LiveVoiceSession> {
        LiveVoiceSession::open(self.config().clone()).await
    }
}

//! 厂商无关的实时语音客户端：PCM 分帧 + typeless JSON 事件。
//!
//! server 以 `default-features = false` 接入 `/voice` 异步代理；探测 CLI 需 `mic`。
//! 对接契约见 `docs/design/realtime-voice.md`。

mod audio;
mod client;
mod config;
mod error;
mod format;
mod live;
#[cfg(feature = "mic")]
mod mic;
mod protocol;
mod resample;

pub use audio::{load_audio_file, split_pcm_frames, PcmFramer};
pub use client::VoiceClient;
pub use config::{default_config_path, endpoint_from_base_url, VoiceConfig};
pub use error::{Error, Result};
pub use format::{
    DEFAULT_CHANNELS, DEFAULT_FRAME_DURATION_MS, DEFAULT_SAMPLE_RATE, DEFAULT_STREAM_MODEL,
    DEFAULT_STREAM_PATH, PCM_ENCODING,
};
pub use live::LiveVoiceSession;
#[cfg(feature = "mic")]
pub use mic::{open_default_microphone, open_microphone, MicStop, Microphone};
pub use protocol::{
    classify_event, close_stream_message, event_to_json, parse_text_frame, session_finish_message,
    session_start_message, VoiceEvent,
};

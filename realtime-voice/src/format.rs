/// 线协议默认采样率。
pub const DEFAULT_SAMPLE_RATE: u32 = 16_000;

/// 线协议默认声道数。
pub const DEFAULT_CHANNELS: u16 = 1;

/// 默认音频帧时长（毫秒）。
pub const DEFAULT_FRAME_DURATION_MS: u32 = 20;

/// 线协议音频编码名（小端 16-bit PCM）。
pub const PCM_ENCODING: &str = "pcm_s16le";

/// HTTP(S) base URL 在路径为空时补上的 typeless 流路径。
pub const DEFAULT_STREAM_PATH: &str = "/v1/transcribe/stream";

/// typeless 流默认模型（对端握手 query 必填）。
pub const DEFAULT_STREAM_MODEL: &str = "typeless-1.0-pro";

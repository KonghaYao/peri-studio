//! WAV / raw PCM 读取，以及定长 PCM 分帧（无压缩编码）。

use std::path::Path;

use hound::{SampleFormat, WavReader};

use crate::{Error, Result};

/// 把 16-bit LE PCM 切成固定时长的线协议帧。
pub struct PcmFramer {
    sample_rate: u32,
    channels: u16,
    frame_duration_ms: u32,
}

impl PcmFramer {
    pub fn new(sample_rate: u32, channels: u16, frame_duration_ms: u32) -> Result<Self> {
        if sample_rate == 0 || frame_duration_ms == 0 {
            return Err(Error::Audio(
                "sample rate and frame duration must be > 0".into(),
            ));
        }
        if channels != 1 && channels != 2 {
            return Err(Error::Audio(format!(
                "unsupported channel count: {channels}"
            )));
        }
        Ok(Self {
            sample_rate,
            channels,
            frame_duration_ms,
        })
    }

    pub fn samples_per_frame(&self) -> usize {
        (self.sample_rate * self.frame_duration_ms / 1000) as usize
    }

    pub fn bytes_per_frame(&self) -> usize {
        self.samples_per_frame() * usize::from(self.channels) * 2
    }
}

pub fn split_pcm_frames(pcm: &[u8], framer: &PcmFramer) -> Vec<Vec<u8>> {
    let bytes_per_frame = framer.bytes_per_frame();
    if bytes_per_frame == 0 || pcm.is_empty() {
        return Vec::new();
    }
    let mut frames = Vec::new();
    let mut offset = 0;
    while offset < pcm.len() {
        let mut chunk = vec![0u8; bytes_per_frame];
        let end = (offset + bytes_per_frame).min(pcm.len());
        chunk[..end - offset].copy_from_slice(&pcm[offset..end]);
        frames.push(chunk);
        offset += bytes_per_frame;
    }
    frames
}

/// 读取音频文件为 16-bit LE PCM。
///
/// 支持 `.wav`（自动转单声道并重采样到目标参数）以及 `.pcm` / `.raw`。
pub fn load_audio_file(
    path: impl AsRef<Path>,
    target_rate: u32,
    target_channels: u16,
) -> Result<Vec<u8>> {
    let path = path.as_ref();
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match ext.as_str() {
        "wav" => load_wav(path, target_rate, target_channels),
        "pcm" | "raw" => {
            let data = std::fs::read(path)?;
            if data.len() % 2 != 0 {
                return Err(Error::Audio("raw PCM length is not 16-bit aligned".into()));
            }
            Ok(data)
        }
        _ => {
            if looks_like_wav(path) {
                load_wav(path, target_rate, target_channels)
            } else {
                Err(Error::Audio(format!(
                    "unsupported audio format: {ext}. use 16-bit WAV or raw s16le PCM"
                )))
            }
        }
    }
}

fn looks_like_wav(path: &Path) -> bool {
    std::fs::read(path)
        .ok()
        .is_some_and(|b| b.len() >= 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WAVE")
}

fn load_wav(path: &Path, target_rate: u32, target_channels: u16) -> Result<Vec<u8>> {
    let mut reader = WavReader::open(path).map_err(|e| Error::Audio(format!("read wav: {e}")))?;
    let spec = reader.spec();
    let mut samples: Vec<i16> = match (spec.sample_format, spec.bits_per_sample) {
        (SampleFormat::Int, 16) => reader
            .samples::<i16>()
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| Error::Audio(format!("decode wav samples: {e}")))?,
        (SampleFormat::Float, 32) => reader
            .samples::<f32>()
            .map(|s| s.map(|v| (v.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16))
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| Error::Audio(format!("decode wav samples: {e}")))?,
        (format, bits) => {
            return Err(Error::Audio(format!(
                "unsupported wav format: {format:?} {bits}-bit"
            )))
        }
    };

    if spec.channels == 0 {
        return Err(Error::Audio("wav has zero channels".into()));
    }
    if spec.channels > 1 && target_channels == 1 {
        samples = downmix_to_mono(&samples, spec.channels);
    } else if spec.channels != target_channels {
        return Err(Error::Audio(format!(
            "channel mismatch: wav has {}, target is {target_channels}",
            spec.channels
        )));
    }

    if spec.sample_rate != target_rate {
        samples = crate::resample::resample_i16(&samples, spec.sample_rate, target_rate);
    }

    Ok(i16_to_le_bytes(&samples))
}

fn downmix_to_mono(samples: &[i16], channels: u16) -> Vec<i16> {
    let ch = channels as usize;
    samples
        .chunks(ch)
        .map(|frame| {
            let sum: i32 = frame.iter().map(|s| i32::from(*s)).sum();
            (sum / ch as i32) as i16
        })
        .collect()
}

fn i16_to_le_bytes(samples: &[i16]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for s in samples {
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_pads_last_frame() {
        let framer = PcmFramer::new(16_000, 1, 20).unwrap();
        assert_eq!(framer.bytes_per_frame(), 640);
        let frames = split_pcm_frames(&[1, 2, 3, 4], &framer);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].len(), 640);
        assert_eq!(&frames[0][..4], &[1, 2, 3, 4]);
    }

    #[test]
    fn downmix_averages_stereo() {
        let stereo = vec![1000, 3000, -1000, 1000];
        assert_eq!(downmix_to_mono(&stereo, 2), vec![2000, 0]);
    }
}

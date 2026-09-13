//! 跨平台麦克风采集（cpal：CoreAudio / WASAPI / ALSA）。
//!
//! Stream 必须留在创建它的 OS 线程上；tokio 多线程 runtime 一搬就会让
//! CoreAudio 停掉回调，表现为会话已建立但没有任何识别结果。

use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc as std_mpsc;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::thread::{self, JoinHandle, Thread};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, SampleFormat, SizedSample, Stream, StreamConfig};
use tokio::sync::mpsc;

use crate::format::{DEFAULT_CHANNELS, DEFAULT_FRAME_DURATION_MS, DEFAULT_SAMPLE_RATE};
use crate::resample::{f32_to_i16, StreamResampler};
use crate::{Error, Result};

/// 丢掉开麦前几百毫秒，避开 CoreAudio / WASAPI 的启动冲击。
const STARTUP_SKIP_MS: u32 = 300;

/// 可停止的默认麦克风 PCM 流（16-bit LE，目标采样率 / 单声道 / 固定帧长）。
pub struct Microphone {
    rx: mpsc::UnboundedReceiver<Result<Vec<u8>>>,
    stopped: Arc<AtomicBool>,
    thread: Thread,
    join: Option<JoinHandle<()>>,
    pub device_name: String,
    pub capture_rate: u32,
    pub capture_channels: u16,
    pub sample_format: SampleFormat,
}

/// 克隆后可从另一任务停止采集（例如 Ctrl+C）。
#[derive(Clone)]
pub struct MicStop {
    stopped: Arc<AtomicBool>,
    thread: Thread,
}

impl MicStop {
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Relaxed);
        self.thread.unpark();
    }
}

impl Microphone {
    pub fn stopper(&self) -> MicStop {
        MicStop {
            stopped: Arc::clone(&self.stopped),
            thread: self.thread.clone(),
        }
    }

    pub fn stop(&self) {
        self.stopper().stop();
    }
}

impl Drop for Microphone {
    fn drop(&mut self) {
        self.stop();
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

impl futures::Stream for Microphone {
    type Item = Result<Vec<u8>>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.rx.poll_recv(cx)
    }
}

struct MicInfo {
    device_name: String,
    capture_rate: u32,
    capture_channels: u16,
    sample_format: SampleFormat,
}

/// 打开系统默认输入设备，输出目标格式的 PCM 帧。
pub fn open_microphone(
    target_rate: u32,
    target_channels: u16,
    frame_duration_ms: u32,
) -> Result<Microphone> {
    if target_channels != 1 {
        return Err(Error::Audio(
            "microphone capture currently supports mono output only".into(),
        ));
    }

    let (ready_tx, ready_rx) = std_mpsc::channel();
    let (pcm_tx, pcm_rx) = mpsc::unbounded_channel();
    let stopped = Arc::new(AtomicBool::new(false));
    let stopped_thread = Arc::clone(&stopped);

    let join = thread::Builder::new()
        .name("peri-realtime-voice-mic".into())
        .spawn(move || {
            audio_thread(
                target_rate,
                frame_duration_ms,
                pcm_tx,
                ready_tx,
                stopped_thread,
            );
        })
        .map_err(|e| Error::Audio(format!("spawn microphone thread: {e}")))?;

    let info = ready_rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| Error::Audio("microphone thread did not start".into()))??;

    Ok(Microphone {
        rx: pcm_rx,
        stopped,
        thread: join.thread().clone(),
        join: Some(join),
        device_name: info.device_name,
        capture_rate: info.capture_rate,
        capture_channels: info.capture_channels,
        sample_format: info.sample_format,
    })
}

pub fn open_default_microphone() -> Result<Microphone> {
    open_microphone(
        DEFAULT_SAMPLE_RATE,
        DEFAULT_CHANNELS,
        DEFAULT_FRAME_DURATION_MS,
    )
}

fn audio_thread(
    target_rate: u32,
    frame_duration_ms: u32,
    pcm_tx: mpsc::UnboundedSender<Result<Vec<u8>>>,
    ready_tx: std_mpsc::Sender<Result<MicInfo>>,
    stopped: Arc<AtomicBool>,
) {
    match start_stream(target_rate, frame_duration_ms, pcm_tx, Arc::clone(&stopped)) {
        Ok((_stream, info)) => {
            let _ = ready_tx.send(Ok(info));
            while !stopped.load(Ordering::Relaxed) {
                thread::park_timeout(Duration::from_millis(100));
            }
        }
        Err(err) => {
            let _ = ready_tx.send(Err(err));
        }
    }
}

fn start_stream(
    target_rate: u32,
    frame_duration_ms: u32,
    pcm_tx: mpsc::UnboundedSender<Result<Vec<u8>>>,
    stopped: Arc<AtomicBool>,
) -> Result<(Stream, MicInfo)> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| Error::Audio("no default input device".into()))?;
    let default = device
        .default_input_config()
        .map_err(|e| Error::Audio(format!("default input config: {e}")))?;
    let device_name = device
        .description()
        .map(|d| d.name().to_string())
        .unwrap_or_else(|_| "default".into());
    let frame_samples = (target_rate * frame_duration_ms / 1000) as usize;
    let skip_samples = (target_rate * STARTUP_SKIP_MS / 1000) as usize;

    // 先试目标采样率（macOS AudioUnit / WASAPI 共享模式常能代转）；
    // 硬件拒绝后再用默认时钟 + 软件抗混叠。
    let native: StreamConfig = default.into();
    let mut candidates = vec![(
        StreamConfig {
            channels: 1,
            sample_rate: target_rate,
            buffer_size: BufferSize::Default,
        },
        SampleFormat::F32,
        target_rate,
        1u16,
    )];
    if default.sample_format() != SampleFormat::F32 {
        candidates.push((
            StreamConfig {
                channels: 1,
                sample_rate: target_rate,
                buffer_size: BufferSize::Default,
            },
            default.sample_format(),
            target_rate,
            1,
        ));
    }
    if native.sample_rate != target_rate || native.channels != 1 {
        candidates.push((
            native,
            default.sample_format(),
            native.sample_rate,
            native.channels,
        ));
    }

    let mut last_err = None;
    for (config, sample_format, in_rate, in_channels) in candidates {
        let pipeline = PcmPipeline::new(
            in_channels,
            in_rate,
            target_rate,
            frame_samples,
            skip_samples,
        );
        match build_stream_for_format(
            &device,
            config,
            sample_format,
            pipeline,
            pcm_tx.clone(),
            Arc::clone(&stopped),
        ) {
            Ok(stream) => {
                stream
                    .play()
                    .map_err(|e| Error::Audio(format!("start microphone: {e}")))?;
                return Ok((
                    stream,
                    MicInfo {
                        device_name,
                        capture_rate: in_rate,
                        capture_channels: in_channels,
                        sample_format,
                    },
                ));
            }
            Err(err) => last_err = Some(err),
        }
    }

    Err(last_err.unwrap_or_else(|| Error::Audio("open microphone: no usable config".into())))
}

fn build_stream_for_format(
    device: &cpal::Device,
    config: StreamConfig,
    sample_format: SampleFormat,
    pipeline: PcmPipeline,
    pcm_tx: mpsc::UnboundedSender<Result<Vec<u8>>>,
    stopped: Arc<AtomicBool>,
) -> Result<Stream> {
    match sample_format {
        SampleFormat::F32 => {
            build_typed_stream::<f32, _>(device, config, pipeline, pcm_tx, stopped, |s| s)
        }
        SampleFormat::F64 => {
            build_typed_stream::<f64, _>(device, config, pipeline, pcm_tx, stopped, |s| s as f32)
        }
        SampleFormat::I16 => {
            build_typed_stream::<i16, _>(device, config, pipeline, pcm_tx, stopped, |s| {
                f32::from(s) / f32::from(i16::MAX)
            })
        }
        SampleFormat::I32 => {
            build_typed_stream::<i32, _>(device, config, pipeline, pcm_tx, stopped, |s| {
                s as f32 / i32::MAX as f32
            })
        }
        SampleFormat::U16 => {
            build_typed_stream::<u16, _>(device, config, pipeline, pcm_tx, stopped, |s| {
                (f32::from(s) - 32768.0) / 32768.0
            })
        }
        other => Err(Error::Audio(format!(
            "unsupported microphone sample format: {other:?}"
        ))),
    }
}

fn build_typed_stream<T, C>(
    device: &cpal::Device,
    config: StreamConfig,
    mut pipeline: PcmPipeline,
    pcm_tx: mpsc::UnboundedSender<Result<Vec<u8>>>,
    stopped: Arc<AtomicBool>,
    convert: C,
) -> Result<Stream>
where
    T: SizedSample + Send + 'static,
    C: Fn(T) -> f32 + Send + 'static,
{
    let err_tx = pcm_tx.clone();
    let announced = Arc::new(AtomicBool::new(false));
    device
        .build_input_stream(
            config,
            move |data: &[T], _| {
                if stopped.load(Ordering::Relaxed) {
                    return;
                }
                if !announced.swap(true, Ordering::Relaxed) {
                    eprintln!("[mic] first buffer {} samples", data.len());
                }
                let samples: Vec<f32> = data.iter().copied().map(&convert).collect();
                for frame in pipeline.push_interleaved(&samples) {
                    if pcm_tx.send(Ok(frame)).is_err() {
                        break;
                    }
                }
            },
            move |err| {
                let _ = err_tx.send(Err(Error::Audio(format!("microphone stream: {err}"))));
            },
            None,
        )
        .map_err(|e| Error::Audio(format!("open microphone: {e}")))
}

/// 声道下混 + 抗混叠重采样 + 开麦丢帧 + 定长分帧。
struct PcmPipeline {
    in_channels: usize,
    resampler: StreamResampler,
    frame_samples: usize,
    skip_remaining: usize,
    pending: Vec<i16>,
}

impl PcmPipeline {
    fn new(
        in_channels: u16,
        in_rate: u32,
        out_rate: u32,
        frame_samples: usize,
        skip_samples: usize,
    ) -> Self {
        Self {
            in_channels: in_channels.max(1) as usize,
            resampler: StreamResampler::new(in_rate, out_rate),
            frame_samples,
            skip_remaining: skip_samples,
            pending: Vec::new(),
        }
    }

    fn push_interleaved(&mut self, input: &[f32]) -> Vec<Vec<u8>> {
        if input.is_empty() {
            return Vec::new();
        }
        let mono = downmix_mono(input, self.in_channels);
        let mut resampled = self.resampler.push(&mono);
        if self.skip_remaining > 0 {
            let drop = self.skip_remaining.min(resampled.len());
            resampled.drain(..drop);
            self.skip_remaining -= drop;
        }
        self.pending.extend(resampled.into_iter().map(f32_to_i16));

        let mut frames = Vec::new();
        while self.pending.len() >= self.frame_samples {
            let frame: Vec<i16> = self.pending.drain(..self.frame_samples).collect();
            frames.push(i16_to_le_bytes(&frame));
        }
        frames
    }
}

fn downmix_mono(input: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return input.to_vec();
    }
    input
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
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
    fn identity_pipeline_emits_fixed_frames() {
        let mut p = PcmPipeline::new(1, 16_000, 16_000, 4, 0);
        let input = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
        let frames = p.push_interleaved(&input);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].len(), 8);
        assert_eq!(p.pending.len(), 3);
    }

    #[test]
    fn stereo_is_averaged() {
        assert_eq!(downmix_mono(&[1.0, 3.0, -1.0, 1.0], 2), vec![2.0, 0.0]);
    }

    #[test]
    fn resample_44100_to_16000_emits_frames() {
        let mut p = PcmPipeline::new(1, 44_100, 16_000, 320, 0);
        let input = vec![0.2_f32; 2205];
        let frames = p.push_interleaved(&input);
        assert!(!frames.is_empty());
        assert_eq!(frames[0].len(), 640);
    }

    #[test]
    fn startup_skip_drops_initial_output() {
        let mut p = PcmPipeline::new(1, 16_000, 16_000, 4, 5);
        let frames = p.push_interleaved(&[0.1; 7]);
        assert!(frames.is_empty());
        assert_eq!(p.pending.len(), 2);
        assert_eq!(p.skip_remaining, 0);
    }

    #[test]
    #[ignore = "needs a real input device and OS mic permission"]
    fn open_default_device() {
        let mic = open_default_microphone().expect("open default microphone");
        assert!(!mic.device_name.is_empty());
        assert!(mic.capture_rate > 0);
        mic.stop();
    }
}

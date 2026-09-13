//! 语音用抗混叠重采样（窗函数 sinc 低通 + 分帧插值）。
//!
//! 朴素线性插值在 44.1 kHz → 16 kHz 时会把 8 kHz 以上的能量折进通带。

use std::f64::consts::PI;

/// FIR 长度：约 63 tap 对 16 kHz 语音足够，实时 CPU 可忽略。
const FIR_TAPS: usize = 63;

/// 流式单声道重采样器。
pub struct StreamResampler {
    mode: Mode,
    fir: Option<Fir>,
    leftover: Vec<f32>,
    phase: f64,
}

enum Mode {
    Identity,
    Integer { factor: usize },
    Fractional { ratio: f64 },
}

struct Fir {
    taps: Vec<f32>,
    buf: Vec<f32>,
    idx: usize,
    filled: usize,
}

impl StreamResampler {
    pub fn new(in_rate: u32, out_rate: u32) -> Self {
        if in_rate == 0 || out_rate == 0 || in_rate == out_rate {
            return Self {
                mode: Mode::Identity,
                fir: None,
                leftover: Vec::new(),
                phase: 0.0,
            };
        }

        let fc = 0.45 * f64::from(out_rate.min(in_rate)) / f64::from(in_rate);
        let fir = Fir::new(design_lowpass(FIR_TAPS, fc));
        let mode = if in_rate.is_multiple_of(out_rate) {
            Mode::Integer {
                factor: (in_rate / out_rate) as usize,
            }
        } else {
            Mode::Fractional {
                ratio: f64::from(in_rate) / f64::from(out_rate),
            }
        };
        Self {
            mode,
            fir: Some(fir),
            leftover: Vec::new(),
            phase: 0.0,
        }
    }

    pub fn push(&mut self, input: &[f32]) -> Vec<f32> {
        if input.is_empty() {
            return Vec::new();
        }
        match self.mode {
            Mode::Identity => input.to_vec(),
            Mode::Integer { factor } => self.push_integer(input, factor),
            Mode::Fractional { ratio } => self.push_fractional(input, ratio),
        }
    }

    fn filter(&mut self, x: f32) -> f32 {
        match self.fir.as_mut() {
            Some(fir) => fir.push(x),
            None => x,
        }
    }

    fn push_integer(&mut self, input: &[f32], factor: usize) -> Vec<f32> {
        let mut out = Vec::with_capacity(input.len() / factor + 1);
        for &x in input {
            let y = self.filter(x);
            self.leftover.push(y);
            if self.leftover.len() >= factor {
                // 低通后取组内中心样本，避免再做一次盒式平均抹掉辅音。
                let mid = factor / 2;
                out.push(self.leftover[mid]);
                self.leftover.clear();
            }
        }
        out
    }

    fn push_fractional(&mut self, input: &[f32], ratio: f64) -> Vec<f32> {
        let mut out = Vec::with_capacity(((input.len() as f64) / ratio).ceil() as usize + 1);
        for &x in input {
            let y = self.filter(x);
            self.leftover.push(y);
        }
        if self.leftover.len() < 2 {
            return out;
        }
        loop {
            let i0 = self.phase.floor() as usize;
            let i1 = i0 + 1;
            if i1 >= self.leftover.len() {
                break;
            }
            let frac = self.phase - i0 as f64;
            let a = f64::from(self.leftover[i0]);
            let b = f64::from(self.leftover[i1]);
            out.push((a + (b - a) * frac) as f32);
            self.phase += ratio;
        }
        let consumed = self.phase.floor() as usize;
        if consumed > 0 {
            let drain = consumed.min(self.leftover.len());
            self.leftover.drain(..drain);
            self.phase -= drain as f64;
        }
        out
    }
}

impl Fir {
    fn new(taps: Vec<f32>) -> Self {
        let n = taps.len();
        Self {
            taps,
            buf: vec![0.0; n],
            idx: 0,
            filled: 0,
        }
    }

    fn push(&mut self, x: f32) -> f32 {
        let n = self.buf.len();
        self.buf[self.idx] = x;
        self.idx = (self.idx + 1) % n;
        if self.filled < n {
            self.filled += 1;
            if self.filled < n {
                return 0.0;
            }
        }
        let mut acc = 0.0f32;
        let mut j = self.idx;
        for tap in &self.taps {
            acc += self.buf[j] * tap;
            j += 1;
            if j == n {
                j = 0;
            }
        }
        acc
    }
}

/// `fc` 为截止频率相对输入采样率的比例（Nyquist = 0.5）。
fn design_lowpass(n_taps: usize, fc: f64) -> Vec<f32> {
    let n_taps = n_taps.max(3) | 1; // 奇数
    let m = (n_taps - 1) as f64;
    let mut taps = Vec::with_capacity(n_taps);
    let mut sum = 0.0f64;
    for i in 0..n_taps {
        let n = i as f64 - m / 2.0;
        let sinc = if n.abs() < 1e-12 {
            2.0 * fc
        } else {
            (2.0 * PI * fc * n).sin() / (PI * n)
        };
        let w =
            0.42 - 0.5 * (2.0 * PI * i as f64 / m).cos() + 0.08 * (4.0 * PI * i as f64 / m).cos();
        let h = sinc * w;
        taps.push(h);
        sum += h;
    }
    taps.into_iter().map(|h| (h / sum) as f32).collect()
}

pub fn resample_f32(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let mut r = StreamResampler::new(from, to);
    r.push(input)
}

pub fn resample_i16(input: &[i16], from: u32, to: u32) -> Vec<i16> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let f: Vec<f32> = input
        .iter()
        .map(|s| f32::from(*s) / f32::from(i16::MAX))
        .collect();
    resample_f32(&f, from, to)
        .into_iter()
        .map(f32_to_i16)
        .collect()
}

pub fn f32_to_i16(sample: f32) -> i16 {
    let scaled = sample.clamp(-1.0, 1.0) * f32::from(i16::MAX);
    scaled.round() as i16
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(rate: u32, hz: f64, n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| (2.0 * PI * hz * f64::from(i as u32) / f64::from(rate)).sin() as f32)
            .collect()
    }

    fn rms(samples: &[f32]) -> f32 {
        if samples.is_empty() {
            return 0.0;
        }
        let e: f32 = samples.iter().map(|s| s * s).sum();
        (e / samples.len() as f32).sqrt()
    }

    #[test]
    fn identity_passthrough() {
        let src = vec![0.1, -0.2, 0.3];
        assert_eq!(resample_f32(&src, 16_000, 16_000), src);
    }

    #[test]
    fn lowpass_dc_gain_near_one() {
        let taps = design_lowpass(FIR_TAPS, 0.163);
        let sum: f32 = taps.iter().sum();
        assert!((sum - 1.0).abs() < 1e-5, "dc gain {sum}");
    }

    #[test]
    fn resample_keeps_1khz() {
        let input = sine(44_100, 1_000.0, 8_820);
        let out = resample_f32(&input, 44_100, 16_000);
        assert!(out.len() > 2_000);
        let tail = &out[out.len() / 4..];
        assert!(rms(tail) > 0.4, "1 kHz RMS too low: {}", rms(tail));
    }

    #[test]
    fn resample_rejects_12khz_alias() {
        let input = sine(44_100, 12_000.0, 8_820);
        let out = resample_f32(&input, 44_100, 16_000);
        let tail = &out[out.len() / 4..];
        assert!(
            rms(tail) < 0.08,
            "12 kHz should be rejected, RMS={}",
            rms(tail)
        );
    }

    #[test]
    fn integer_48k_to_16k_length() {
        let input = vec![0.25_f32; 480];
        let out = resample_f32(&input, 48_000, 16_000);
        assert!(out.len() >= 140 && out.len() <= 160, "len={}", out.len());
    }
}

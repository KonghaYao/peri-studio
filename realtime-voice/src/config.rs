//! 上游 URL / token / 额外头。无默认厂商地址。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::format::{DEFAULT_CHANNELS, DEFAULT_FRAME_DURATION_MS, DEFAULT_SAMPLE_RATE};
use crate::{Error, Result};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VoiceConfigFile {
    pub url: Option<String>,
    pub token: Option<String>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
}

#[derive(Clone)]
pub struct VoiceConfig {
    pub url: Option<String>,
    pub token: Option<String>,
    pub headers: BTreeMap<String, String>,
    pub sample_rate: u32,
    pub channels: u16,
    pub frame_duration_ms: u32,
    pub connect_timeout: Duration,
    pub recv_timeout: Duration,
}

impl Default for VoiceConfig {
    fn default() -> Self {
        Self {
            url: None,
            token: None,
            headers: BTreeMap::new(),
            sample_rate: DEFAULT_SAMPLE_RATE,
            channels: DEFAULT_CHANNELS,
            frame_duration_ms: DEFAULT_FRAME_DURATION_MS,
            connect_timeout: Duration::from_secs(10),
            recv_timeout: Duration::from_secs(15),
        }
    }
}

impl std::fmt::Debug for VoiceConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VoiceConfig")
            .field("url", &self.url)
            .field("token", &self.token.as_ref().map(|_| "<redacted>"))
            .field("headers", &self.headers.keys().collect::<Vec<_>>())
            .field("sample_rate", &self.sample_rate)
            .field("channels", &self.channels)
            .field("frame_duration_ms", &self.frame_duration_ms)
            .field("connect_timeout", &self.connect_timeout)
            .field("recv_timeout", &self.recv_timeout)
            .finish()
    }
}

impl VoiceConfig {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn load_file(path: impl AsRef<Path>) -> Result<Self> {
        let path = expand_path(path.as_ref());
        let mut config = Self::default();
        if path.exists() {
            let raw = std::fs::read_to_string(&path)?;
            let file: VoiceConfigFile = serde_json::from_str(&raw)?;
            config.url = file.url;
            config.token = file.token;
            config.headers = file.headers;
        }
        if let Some(url) = first_env(&["PERI_REALTIME_VOICE_BASE_URL", "PERI_REALTIME_VOICE_URL"]) {
            config.url = Some(url);
        }
        if let Some(key) = first_env(&["PERI_REALTIME_VOICE_API_KEY", "PERI_REALTIME_VOICE_TOKEN"])
        {
            config.token = Some(key);
        }
        Ok(config)
    }

    pub fn with_url(mut self, url: impl Into<String>) -> Self {
        self.url = Some(url.into());
        self
    }

    pub fn with_token(mut self, token: impl Into<String>) -> Self {
        self.token = Some(token.into());
        self
    }

    pub fn endpoint(&self) -> Result<String> {
        let raw = self
            .url
            .as_deref()
            .filter(|u| !u.is_empty())
            .ok_or(Error::MissingUrl)?;
        endpoint_from_base_url(raw)
    }
}

/// 把 http(s) base URL 收成 ws(s) 端点；已是 ws(s) 则原样返回。
pub fn endpoint_from_base_url(base: &str) -> Result<String> {
    let trimmed = base.trim();
    if trimmed.is_empty() {
        return Err(Error::MissingUrl);
    }
    if let Some(rest) = trimmed.strip_prefix("https://") {
        return Ok(format!("wss://{rest}"));
    }
    if let Some(rest) = trimmed.strip_prefix("http://") {
        return Ok(format!("ws://{rest}"));
    }
    if trimmed.starts_with("wss://") || trimmed.starts_with("ws://") {
        return Ok(trimmed.to_string());
    }
    Err(Error::Ws(
        "realtime voice base url must be http(s) or ws(s)".into(),
    ))
}

fn first_env(keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| std::env::var(key).ok().filter(|value| !value.is_empty()))
}

pub fn default_config_path() -> PathBuf {
    dirs_next::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".config/peri-studio/realtime-voice.json")
}

fn expand_path(path: &Path) -> PathBuf {
    if let Some(stripped) = path.to_str().and_then(|s| s.strip_prefix("~/")) {
        if let Some(home) = dirs_next::home_dir() {
            return home.join(stripped);
        }
    }
    path.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_json_is_vendor_neutral() {
        let parsed: VoiceConfigFile = serde_json::from_str(
            r#"{"url":"wss://voice.example/realtime","token":null,"headers":{"X-Trace":"1"}}"#,
        )
        .unwrap();
        assert_eq!(parsed.url.as_deref(), Some("wss://voice.example/realtime"));
        assert!(parsed.token.is_none());
        assert_eq!(parsed.headers.get("X-Trace").map(String::as_str), Some("1"));
    }

    #[test]
    fn missing_url_is_explicit() {
        assert!(VoiceConfig::new().endpoint().is_err());
    }

    #[test]
    fn https_base_becomes_wss() {
        assert_eq!(
            endpoint_from_base_url("https://voice.example/v1/realtime").unwrap(),
            "wss://voice.example/v1/realtime"
        );
        assert_eq!(
            endpoint_from_base_url("wss://voice.example/v1").unwrap(),
            "wss://voice.example/v1"
        );
    }

    #[test]
    fn debug_redacts_token() {
        let config = VoiceConfig::new()
            .with_url("wss://voice.example/v1")
            .with_token("super-secret");
        let leaked = format!("{config:?}");
        assert!(!leaked.contains("super-secret"), "{leaked}");
        assert!(leaked.contains("<redacted>"), "{leaked}");
    }
}

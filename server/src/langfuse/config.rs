//! Langfuse 环境变量读取与 spawn.env 注入。

use std::collections::HashMap;

use url::Url;

pub const LANGFUSE_PUBLIC_KEY_ENV: &str = "LANGFUSE_PUBLIC_KEY";
pub const LANGFUSE_SECRET_KEY_ENV: &str = "LANGFUSE_SECRET_KEY";
pub const LANGFUSE_HOST_ENV: &str = "LANGFUSE_HOST";
pub const LANGFUSE_BASE_URL_ENV: &str = "LANGFUSE_BASE_URL";
pub const DEFAULT_LANGFUSE_HOST: &str = "https://cloud.langfuse.com";

const LANGFUSE_ENV_KEYS: [&str; 4] = [
    LANGFUSE_PUBLIC_KEY_ENV,
    LANGFUSE_SECRET_KEY_ENV,
    LANGFUSE_HOST_ENV,
    LANGFUSE_BASE_URL_ENV,
];

/// spawn / allowlist 契约用的四键（与 server `ENV_ALLOWLIST_BASE` 增补项一致）。
pub fn langfuse_env_keys() -> &'static [&'static str; 4] {
    &LANGFUSE_ENV_KEYS
}

fn trimmed_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// 已配置判定：public + secret 均非空 trim 后。
pub fn is_configured() -> bool {
    trimmed_env(LANGFUSE_PUBLIC_KEY_ENV).is_some() && trimmed_env(LANGFUSE_SECRET_KEY_ENV).is_some()
}

/// 解析 API 根 URL：`LANGFUSE_BASE_URL` > `LANGFUSE_HOST` > 默认 cloud。
pub fn resolve_base_url() -> String {
    trimmed_env(LANGFUSE_BASE_URL_ENV)
        .or_else(|| trimmed_env(LANGFUSE_HOST_ENV))
        .unwrap_or_else(|| DEFAULT_LANGFUSE_HOST.to_string())
}

fn normalize_base_url(raw: &str) -> Result<Url, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("empty".into());
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let mut url = Url::parse(&with_scheme).map_err(|error| error.to_string())?;
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("userinfo_or_fragment".into());
    }
    match url.scheme() {
        "https" => {}
        "http" if is_loopback_api_host(url.host_str()) => {}
        _ => return Err("scheme".into()),
    }
    if url.query().is_some() {
        return Err("query".into());
    }
    url.set_path("");
    url.set_query(None);
    Ok(url)
}

fn is_loopback_api_host(host: Option<&str>) -> bool {
    matches!(host, Some("127.0.0.1") | Some("localhost") | Some("[::1]") | Some("::1"))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LangfuseConfig {
    pub public_key: String,
    pub secret_key: String,
    pub api_base: Url,
}

impl LangfuseConfig {
    pub fn from_process_env() -> Option<Self> {
        if !is_configured() {
            return None;
        }
        let public_key = trimmed_env(LANGFUSE_PUBLIC_KEY_ENV)?;
        let secret_key = trimmed_env(LANGFUSE_SECRET_KEY_ENV)?;
        let api_base = normalize_base_url(&resolve_base_url()).ok()?;
        Some(Self {
            public_key,
            secret_key,
            api_base,
        })
    }

    pub fn traces_url(&self, session_id: &str) -> Result<Url, String> {
        let mut url = self.api_base.clone();
        url.set_path("/api/public/traces");
        url.set_query(None);
        let query = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("sessionId", session_id)
            .append_pair("limit", "50")
            .finish();
        url.set_query(Some(&query));
        Ok(url)
    }

    pub fn basic_authorization(&self) -> String {
        use base64::Engine as _;
        let token = format!("{}:{}", self.public_key, self.secret_key);
        format!(
            "Basic {}",
            base64::engine::general_purpose::STANDARD.encode(token.as_bytes())
        )
    }
}

/// Hub spawn：从 server 进程 env 注入非空 `LANGFUSE_*`（密钥不出日志）。
pub fn inject_spawn_env(env: &mut HashMap<String, String>) {
    if !is_configured() {
        return;
    }
    for key in LANGFUSE_ENV_KEYS {
        if let Some(value) = trimmed_env(key) {
            env.insert(key.to_string(), value);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    fn clear_langfuse_env() {
        for key in LANGFUSE_ENV_KEYS {
            std::env::remove_var(key);
        }
    }

    #[test]
    #[serial]
    fn resolve_base_url_prefers_base_url_over_host() {
        clear_langfuse_env();
        std::env::set_var(LANGFUSE_BASE_URL_ENV, "https://base.example");
        std::env::set_var(LANGFUSE_HOST_ENV, "https://host.example");
        assert_eq!(resolve_base_url(), "https://base.example");
        clear_langfuse_env();
    }

    #[test]
    #[serial]
    fn resolve_base_url_falls_back_to_host_then_default() {
        clear_langfuse_env();
        std::env::set_var(LANGFUSE_HOST_ENV, "https://host.example");
        assert_eq!(resolve_base_url(), "https://host.example");
        clear_langfuse_env();
        assert_eq!(resolve_base_url(), DEFAULT_LANGFUSE_HOST);
    }

    #[test]
    #[serial]
    fn is_configured_requires_both_keys() {
        clear_langfuse_env();
        assert!(!is_configured());
        std::env::set_var(LANGFUSE_PUBLIC_KEY_ENV, "pk");
        assert!(!is_configured());
        std::env::set_var(LANGFUSE_SECRET_KEY_ENV, "sk");
        assert!(is_configured());
        clear_langfuse_env();
    }

    #[test]
    #[serial]
    fn inject_spawn_env_omits_when_unconfigured() {
        clear_langfuse_env();
        let mut env = HashMap::new();
        inject_spawn_env(&mut env);
        assert!(env.is_empty());
        clear_langfuse_env();
    }

    #[test]
    #[serial]
    fn inject_spawn_env_includes_configured_keys_without_logging_values() {
        clear_langfuse_env();
        std::env::set_var(LANGFUSE_PUBLIC_KEY_ENV, "pk-test");
        std::env::set_var(LANGFUSE_SECRET_KEY_ENV, "sk-test");
        std::env::set_var(LANGFUSE_HOST_ENV, "https://lf.example");
        let mut env = HashMap::new();
        inject_spawn_env(&mut env);
        assert_eq!(env.len(), 3);
        assert!(env.contains_key(LANGFUSE_PUBLIC_KEY_ENV));
        assert!(env.contains_key(LANGFUSE_SECRET_KEY_ENV));
        assert!(env.contains_key(LANGFUSE_HOST_ENV));
        assert!(!env.contains_key(LANGFUSE_BASE_URL_ENV));
        clear_langfuse_env();
    }

    #[test]
    fn normalize_base_url_rejects_userinfo_and_non_https_remote() {
        assert!(normalize_base_url("https://user:pass@cloud.langfuse.com").is_err());
        assert!(normalize_base_url("http://evil.example").is_err());
        assert!(normalize_base_url("http://127.0.0.1:9999").is_ok());
    }
}

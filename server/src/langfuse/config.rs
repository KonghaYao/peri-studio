//! Langfuse 客户端配置类型与 URL 规范化。

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

pub(crate) fn normalize_base_url(raw: &str) -> Result<Url, String> {
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
    matches!(
        host,
        Some("127.0.0.1") | Some("localhost") | Some("[::1]") | Some("::1")
    )
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LangfuseConfig {
    pub public_key: String,
    pub secret_key: String,
    pub api_base: Url,
}

impl LangfuseConfig {
    pub fn upstream_host_origin(&self) -> &str {
        self.api_base.host_str().unwrap_or("unknown")
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

    pub fn trace_url(&self, trace_id: &str) -> Result<Url, String> {
        let mut url = self.api_base.clone();
        url.set_path(&format!("/api/public/traces/{trace_id}"));
        url.set_query(None);
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

pub fn build_langfuse_config(
    public_key: &str,
    secret_key: &str,
    base_url: &str,
) -> Option<LangfuseConfig> {
    let api_base = normalize_base_url(base_url).ok()?;
    Some(LangfuseConfig {
        public_key: public_key.to_string(),
        secret_key: secret_key.to_string(),
        api_base,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_base_url_rejects_userinfo_and_non_https_remote() {
        assert!(normalize_base_url("https://user:pass@cloud.langfuse.com").is_err());
        assert!(normalize_base_url("http://evil.example").is_err());
        assert!(normalize_base_url("http://127.0.0.1:9999").is_ok());
    }

    #[test]
    fn build_langfuse_config_uses_normalized_base() {
        let config =
            build_langfuse_config("pk", "sk", "https://jp.cloud.langfuse.com").expect("config");
        assert_eq!(config.upstream_host_origin(), "jp.cloud.langfuse.com");
    }
}

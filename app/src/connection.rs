//! 远程 server 地址规范化与传输安全门禁。

use std::net::IpAddr;

use anyhow::Context as _;
use url::Url;

/// 将用户输入的 server 基地址转换为 instance WebSocket 地址。
///
/// 非回环明文连接默认拒绝；调用方必须显式声明允许不安全传输。
pub fn instance_endpoint(input: &str, allow_insecure: bool) -> anyhow::Result<String> {
    let with_scheme = if input.contains("://") {
        input.to_string()
    } else {
        format!("https://{input}")
    };
    let mut url = Url::parse(&with_scheme).context("invalid server URL")?;
    if !url.username().is_empty() || url.password().is_some() {
        anyhow::bail!("server URL must not contain credentials");
    }
    if url.query().is_some() || url.fragment().is_some() {
        anyhow::bail!("server URL must not contain a query or fragment");
    }

    let websocket_scheme = match url.scheme() {
        "http" => "ws",
        "https" => "wss",
        "ws" => "ws",
        "wss" => "wss",
        scheme => anyhow::bail!("unsupported server URL scheme: {scheme}"),
    };
    let host = url.host_str().context("server URL is missing a host")?;
    if websocket_scheme == "ws" && !is_loopback_host(host) && !allow_insecure {
        anyhow::bail!(
            "plaintext ws is only allowed for loopback; use wss or pass --allow-insecure"
        );
    }
    url.set_scheme(websocket_scheme)
        .map_err(|_| anyhow::anyhow!("failed to normalize server URL scheme"))?;
    match url.path() {
        "" | "/" => url.set_path("/instance"),
        "/instance" => {}
        path => anyhow::bail!("server URL path must be /instance, got {path}"),
    }
    Ok(url.into())
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

#[cfg(test)]
mod tests {
    use super::instance_endpoint;

    #[test]
    fn normalizes_http_and_websocket_base_urls() {
        assert_eq!(
            instance_endpoint("http://127.0.0.1:8456", false).unwrap(),
            "ws://127.0.0.1:8456/instance"
        );
        assert_eq!(
            instance_endpoint("https://peri.example", false).unwrap(),
            "wss://peri.example/instance"
        );
        assert_eq!(
            instance_endpoint("wss://peri.example/instance", false).unwrap(),
            "wss://peri.example/instance"
        );
    }

    #[test]
    fn rejects_unsafe_remote_plaintext_by_default() {
        let error = instance_endpoint("ws://192.0.2.3:8456", false).unwrap_err();
        assert!(error.to_string().contains("plaintext ws"));
        assert_eq!(
            instance_endpoint("ws://192.0.2.3:8456", true).unwrap(),
            "ws://192.0.2.3:8456/instance"
        );
    }

    #[test]
    fn rejects_credentials_and_unexpected_paths() {
        assert!(instance_endpoint("https://user@example.com", false).is_err());
        assert!(instance_endpoint("https://example.com/api", false).is_err());
    }
}

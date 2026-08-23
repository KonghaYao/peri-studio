//! 有限 HTTP/1.1 请求解析辅助（认证端点与静态路由共用）。
//!
//! 解析面刻意独立成纯函数：请求行/头结束符/ws 升级探测/Host 与 Origin
//! 校验/Cookie 提取——全部无 I/O，供 [`super::http`] 的 `serve_http` 与
//! 测试直接断言。

/// 解析头部首行请求行，返回路径（去 query）；非 GET / 格式非法 → None。
#[cfg(test)]
pub(crate) fn request_path(head: &str) -> Option<&str> {
    let mut parts = head.split_whitespace();
    let method = parts.next()?;
    let target = parts.next()?;
    if method != "GET" {
        return None;
    }
    Some(target.split('?').next().unwrap_or(target))
}

/// 定位头部结束符 `\r\n\r\n` 的起始下标；头部未完整 → None。
pub(crate) fn header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

/// 头部字节是否含 `upgrade: websocket`（ASCII 大小写不敏感；保守判定，
/// 含该子串即视为 ws 升级请求——误判只会让 `accept_async` 按原逻辑拒绝）。
pub(crate) fn is_ws_upgrade(buf: &[u8]) -> bool {
    let needle = b"upgrade: websocket";
    buf.to_ascii_lowercase()
        .windows(needle.len())
        .any(|w| w == needle)
}

/// 单值头写入：重复出现 → `malformed`（拒绝歧义 framing）。
pub(super) fn set_unique_header<'a>(
    slot: &mut Option<&'a str>,
    value: &'a str,
    malformed: &mut bool,
) {
    if slot.replace(value).is_some() {
        *malformed = true;
    }
}

pub(super) fn is_http_header_name(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

pub(crate) fn is_json_content_type(value: &str) -> bool {
    let mut parts = value.split(';').map(str::trim);
    if !parts
        .next()
        .is_some_and(|media| media.eq_ignore_ascii_case("application/json"))
    {
        return false;
    }
    match parts.next() {
        None => true,
        Some(parameter) => {
            parameter.eq_ignore_ascii_case("charset=utf-8") && parts.next().is_none()
        }
    }
}

pub(crate) fn valid_loopback_host(host: &str) -> bool {
    if let Some(rest) = host.strip_prefix('[') {
        let Some((address, suffix)) = rest.split_once(']') else {
            return false;
        };
        return address == "::1" && valid_optional_port(suffix);
    }
    let (address, suffix) = if let Some((address, port)) = host.split_once(':') {
        if port.contains(':') {
            return false;
        }
        (address, format!(":{port}"))
    } else {
        (host, String::new())
    };
    matches!(address, "localhost" | "127.0.0.1") && valid_optional_port(&suffix)
}

pub(crate) fn valid_ws_host(host: &str, allow_non_loopback: bool) -> bool {
    if valid_loopback_host(host) {
        return true;
    }
    if !allow_non_loopback || host.is_empty() {
        return false;
    }
    host.parse::<tokio_tungstenite::tungstenite::http::uri::Authority>()
        .is_ok_and(|authority| {
            !authority.host().is_empty() && authority.port_u16().is_none_or(|port| port != 0)
        })
}

pub(crate) fn valid_ws_origin(origin: Option<&str>, host: &str) -> bool {
    let Some(origin) = origin else { return true };
    if valid_loopback_host(host) {
        origin == format!("http://{host}")
    } else {
        origin == format!("https://{host}")
    }
}

fn valid_optional_port(suffix: &str) -> bool {
    suffix.is_empty()
        || suffix
            .strip_prefix(':')
            .is_some_and(|port| !port.is_empty() && port.bytes().all(|byte| byte.is_ascii_digit()))
}

pub(crate) fn valid_origin(origin: Option<&str>, host: &str) -> bool {
    origin
        .map(|o| o == format!("http://{host}"))
        .unwrap_or(true)
}

pub(crate) fn cookie_value(header: &str, name: &str) -> Option<String> {
    header
        .split(';')
        .filter_map(|p| p.trim().split_once('='))
        .find(|(k, _)| *k == name)
        .map(|(_, v)| v.to_string())
}

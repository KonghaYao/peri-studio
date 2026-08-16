//! 静态资源面：内嵌 Vite 产物路由 + Content-Type + 缓存策略。
//!
//! 构建产物 `web/dist/` 由 `build.rs` 在编译期扫描并生成内嵌资源表
//! （`assets.rs`，字节经 include_bytes! 引用，零运行时文件 IO、零新依赖）。
//! 本模块按实际文件清单做路径查表：`/`、`/index.html` 映射面板入口，
//! `/panel.html` 为旧链接兼容（同样指向面板），`/assets/*` 直接映射产物
//! 相对路径，未知路径返回 None（由调用方 404）。静态资源名不做 URL 解码，
//! 取请求行 path 段（去 query）。

include!(concat!(env!("OUT_DIR"), "/assets.rs"));

/// 静态资源路由表：URL 路径 → 产物相对路径。`/`、`/index.html` 与旧链接
/// `/panel.html` 均映射面板入口 `index.html`，`/assets/*` 直接对应 vite
/// 产物文件名。返回 (资源名, Content-Type, 内容)；未知路径 → None。
pub(crate) fn route(path: &str) -> Option<(&'static str, &'static str, &'static [u8])> {
    let rel = match path {
        // index.html 为唯一页面（`/` 即面板）；/panel.html 仅做旧链接兼容。
        "/" | "/index.html" | "/panel.html" => "index.html",
        other => other.trim_start_matches('/'),
    };
    ASSETS
        .iter()
        .find(|a| a.url == rel)
        .map(|a| (a.url, content_type(a.url), a.bytes))
}

/// 按扩展名取 Content-Type（最小映射表；未识别回 octet-stream）。
pub(crate) fn content_type(name: &str) -> &'static str {
    if name.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if name.ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else if name.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if name.ends_with(".svg") {
        "image/svg+xml"
    } else if name.ends_with(".png") {
        "image/png"
    } else if name.ends_with(".ico") {
        "image/x-icon"
    } else if name.ends_with(".woff2") {
        "font/woff2"
    } else if name.ends_with(".map") || name.ends_with(".json") {
        "application/json"
    } else {
        "application/octet-stream"
    }
}

/// Static cache policy is identity-based, not extension-based. Only a real embedded
/// Vite asset under `/assets/` is immutable; entry documents and misses always fetch
/// fresh so a restarted server cannot be paired with an obsolete client bundle.
pub(crate) fn cache_headers_for_static(
    request_path: &str,
    routed_name: Option<&str>,
) -> Vec<(String, String)> {
    let immutable =
        request_path.starts_with("/assets/") && routed_name.is_some_and(is_fingerprinted_asset);
    vec![(
        "Cache-Control".into(),
        if immutable {
            "public, max-age=31536000, immutable"
        } else {
            "no-store"
        }
        .into(),
    )]
}

fn is_fingerprinted_asset(name: &str) -> bool {
    let Some(file_name) = name
        .strip_prefix("assets/")
        .and_then(|path| path.rsplit('/').next())
    else {
        return false;
    };
    let stem = file_name.split('.').next().unwrap_or_default();
    // Rollup's URL-safe base64 hash alphabet includes `-`, including as the
    // final character (for example `index-CBgKAe6-.css`). Split at the first
    // separator so a trailing hash character is not mistaken for a delimiter.
    let Some((_, fingerprint)) = stem.split_once('-') else {
        return false;
    };
    fingerprint.len() >= 8
        && fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

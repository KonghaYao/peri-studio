//! 静态资源面：内嵌 Vite 产物路由 + Content-Type + 缓存策略。
//!
//! 生产：构建产物 `web/dist/` 由 `build.rs` 在编译期扫描并生成内嵌资源表。
//! 开发：设置 `PERI_STUDIO_WEB_DIST` 指向 `web/dist` 目录时，每次请求从磁盘读取
//! （配合 `embed-static-web` feature 关闭，前端改动无需重编 Rust）。

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tokio::fs;

include!(concat!(env!("OUT_DIR"), "/assets.rs"));

/// 开发态静态根目录（绝对路径）。未设置则仅使用内嵌 `ASSETS`。
pub(crate) fn external_web_dist_root() -> Option<&'static Path> {
    static ROOT: OnceLock<Option<PathBuf>> = OnceLock::new();
    ROOT.get_or_init(|| {
        let raw = std::env::var("PERI_STUDIO_WEB_DIST").ok()?;
        let path = PathBuf::from(raw);
        if !path.join("index.html").is_file() {
            tracing::warn!(
                path = %path.display(),
                "PERI_STUDIO_WEB_DIST is set but index.html is missing"
            );
            return None;
        }
        path.canonicalize().ok()
    })
    .as_deref()
}

/// 将 HTTP path 映射为 dist 内相对路径（与内嵌路由一致）。
fn normalize_request_path(path: &str) -> Option<&str> {
    let rel = match path {
        "/" | "/index.html" | "/panel.html" => "index.html",
        other => other.trim_start_matches('/'),
    };
    if rel.is_empty() || rel.contains("..") || rel.contains('\\') || rel.contains('\0') {
        return None;
    }
    Some(rel)
}

/// 静态资源路由表：URL 路径 → 产物相对路径。未知路径 → None。
pub(crate) fn route(path: &str) -> Option<(&'static str, &'static str, &'static [u8])> {
    let rel = normalize_request_path(path)?;
    ASSETS
        .iter()
        .find(|a| a.url == rel)
        .map(|a| (a.url, content_type(a.url), a.bytes))
}

/// 从 `PERI_STUDIO_WEB_DIST` 读取静态文件（开发态）。
pub(crate) async fn route_external(path: &str) -> Option<(String, String, Vec<u8>)> {
    let root = external_web_dist_root()?;
    let rel = normalize_request_path(path)?;
    let file = resolve_under_root(root, rel)?;
    if !file.is_file() {
        return None;
    }
    let bytes = fs::read(&file).await.ok()?;
    let name = rel.to_string();
    let ct = content_type(&name).to_string();
    Some((name, ct, bytes))
}

fn resolve_under_root(root: &Path, rel: &str) -> Option<PathBuf> {
    let joined = root.join(rel);
    let canonical = joined.canonicalize().ok()?;
    let root_canon = root.canonicalize().ok()?;
    if !canonical.starts_with(&root_canon) {
        return None;
    }
    Some(canonical)
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
    } else if name.ends_with(".webmanifest") {
        // 必须在 `.json` 之前：Chrome 会拒绝 octet-stream 的 Web App Manifest。
        "application/manifest+json"
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

pub(crate) fn is_fingerprinted_asset(name: &str) -> bool {
    let Some(file_name) = name
        .strip_prefix("assets/")
        .and_then(|path| path.rsplit('/').next())
    else {
        return false;
    };
    let stem = file_name.split('.').next().unwrap_or_default();
    let Some((_, fingerprint)) = stem.split_once('-') else {
        return false;
    };
    fingerprint.len() >= 8
        && fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

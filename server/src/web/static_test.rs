//! 静态面测试：内嵌资源路由、Content-Type 映射、缓存策略与静态 HTTP
//! socket 响应（HTTP/1.1 逐字节断言）。

use tokio::io::AsyncReadExt as _;
use tokio::net::{TcpListener, TcpStream};

use super::test_util::auth_socket_response;
use crate::web::{cache_headers_for_static, content_type, route, serve, ASSETS};

#[test]
fn route_resolves_static_assets() {
    // Web 面板入口：/、/index.html 与 /panel.html（旧链接兼容）同源。
    let (name, ct, index) = route("/").expect("/ → index.html");
    assert_eq!(name, "index.html");
    assert_eq!(ct, "text/html; charset=utf-8");
    assert!(String::from_utf8_lossy(index).contains("Peri Studio Web 面板"));
    assert_eq!(route("/index.html").map(|(n, _, _)| n), Some("index.html"));
    assert_eq!(route("/panel.html").map(|(n, _, _)| n), Some("index.html"));
    let (_, _, compat) = route("/panel.html").expect("/panel.html 兼容映射");
    assert_eq!(compat, index);

    // vite 产物：至少一个 js、一个 css（hash 文件名，不硬编码）。
    let js: Vec<_> = ASSETS.iter().filter(|a| a.url.ends_with(".js")).collect();
    let css: Vec<_> = ASSETS.iter().filter(|a| a.url.ends_with(".css")).collect();
    assert!(!js.is_empty(), "产物应含 js 资源");
    assert!(!css.is_empty(), "产物应含 css 资源");
    for a in js.iter().chain(css.iter()) {
        assert!(!a.bytes.is_empty(), "{} 应为非空", a.url);
    }

    // assets/ 前缀的产物路径可经 URL 命中（取第一个 js 走路由）。
    let first_js = js[0].url;
    let routed = route(&format!("/{}", first_js)).expect("assets 可经 URL 路由");
    assert_eq!(routed.0, first_js);

    assert_eq!(route("/instance"), None);
    assert_eq!(route("/favicon.ico"), None);
    assert_eq!(route("/visual-fixture.html"), None);
    for asset in ASSETS {
        assert!(
            !asset.url.contains("visual-fixture")
                && !String::from_utf8_lossy(asset.bytes).contains("UI 状态验收台"),
            "development fixture must not be embedded in production asset {}",
            asset.url,
        );
    }
}

/// Content-Type 按扩展名映射；未识别回 octet-stream。
#[test]
fn content_type_by_extension() {
    assert_eq!(content_type("index.html"), "text/html; charset=utf-8");
    assert_eq!(
        content_type("assets/app.js"),
        "text/javascript; charset=utf-8"
    );
    assert_eq!(content_type("assets/style.css"), "text/css; charset=utf-8");
    assert_eq!(content_type("icon.svg"), "image/svg+xml");
    assert_eq!(content_type("icon.png"), "image/png");
    assert_eq!(content_type("favicon.ico"), "image/x-icon");
    assert_eq!(content_type("font.woff2"), "font/woff2");
    assert_eq!(content_type("chunk.js.map"), "application/json");
    assert_eq!(content_type("blob.bin"), "application/octet-stream");
}

#[test]
fn static_cache_policy_separates_entry_documents_from_hashed_assets() {
    for path in ["/", "/index.html", "/panel.html", "/missing"] {
        assert_eq!(
            cache_headers_for_static(path, route(path).map(|(name, _, _)| name)),
            vec![("Cache-Control".into(), "no-store".into())],
            "entry/error path must be revalidated: {path}"
        );
    }
    let asset = ASSETS
        .iter()
        .find(|asset| asset.url.starts_with("assets/"))
        .expect("vite build should emit an asset");
    assert_eq!(
        cache_headers_for_static(&format!("/{}", asset.url), Some(asset.url)),
        vec![(
            "Cache-Control".into(),
            "public, max-age=31536000, immutable".into()
        )]
    );
    assert_eq!(
        cache_headers_for_static("/assets/missing.js", None),
        vec![("Cache-Control".into(), "no-store".into())]
    );
    for unhashed in ["assets/logo.svg", "assets/index-short.js", "public/app.css"] {
        assert_eq!(
            cache_headers_for_static(&format!("/{unhashed}"), Some(unhashed)),
            vec![("Cache-Control".into(), "no-store".into())],
            "fixed-name assets must remain upgrade-safe: {unhashed}"
        );
    }

    assert_eq!(
        cache_headers_for_static(
            "/assets/index-CBgKAe6-.css",
            Some("assets/index-CBgKAe6-.css")
        ),
        vec![(
            "Cache-Control".into(),
            "public, max-age=31536000, immutable".into()
        )],
        "Rollup URL-safe hashes may end in a dash"
    );
}

#[tokio::test]
async fn static_http_emits_upgrade_safe_cache_headers() {
    let entry = auth_socket_response("GET / HTTP/1.1\r\nHost: 127.0.0.1:8456\r\n\r\n").await;
    assert!(entry.starts_with("HTTP/1.1 200 OK\r\n"), "{entry:?}");
    assert!(entry.contains("Cache-Control: no-store\r\n"), "{entry:?}");
    assert!(
        entry.contains("X-Content-Type-Options: nosniff\r\n"),
        "{entry:?}"
    );

    let asset = ASSETS
        .iter()
        .find(|asset| asset.url.ends_with(".js"))
        .unwrap();
    let response = auth_socket_response(&format!(
        "GET /{} HTTP/1.1\r\nHost: 127.0.0.1:8456\r\n\r\n",
        asset.url
    ))
    .await;
    assert!(response.starts_with("HTTP/1.1 200 OK\r\n"), "{response:?}");
    assert!(
        response.contains("Cache-Control: public, max-age=31536000, immutable\r\n"),
        "{response:?}"
    );

    let missing =
        auth_socket_response("GET /assets/missing.js HTTP/1.1\r\nHost: 127.0.0.1:8456\r\n\r\n")
            .await;
    assert!(
        missing.starts_with("HTTP/1.1 404 Not Found\r\n"),
        "{missing:?}"
    );
    assert!(
        missing.contains("Cache-Control: no-store\r\n"),
        "{missing:?}"
    );
}

#[tokio::test]
async fn static_head_mirrors_get_headers_without_a_body() {
    let index = route("/").unwrap().2;
    let response = auth_socket_response("HEAD / HTTP/1.1\r\nHost: 127.0.0.1:8456\r\n\r\n").await;
    assert!(response.starts_with("HTTP/1.1 200 OK\r\n"), "{response:?}");
    assert!(
        response.contains(&format!("Content-Length: {}\r\n", index.len())),
        "{response:?}"
    );
    assert!(
        response.contains("Cache-Control: no-store\r\n"),
        "{response:?}"
    );
    assert!(
        response.ends_with("\r\n\r\n"),
        "HEAD must not emit a body: {response:?}"
    );

    let asset = ASSETS
        .iter()
        .find(|asset| asset.url.ends_with(".css"))
        .unwrap();
    let asset_response = auth_socket_response(&format!(
        "HEAD /{} HTTP/1.1\r\nHost: 127.0.0.1:8456\r\n\r\n",
        asset.url
    ))
    .await;
    assert!(asset_response.starts_with("HTTP/1.1 200 OK\r\n"));
    assert!(asset_response.contains(&format!("Content-Length: {}\r\n", asset.bytes.len())));
    assert!(asset_response.contains("Cache-Control: public, max-age=31536000, immutable\r\n"));
    assert!(asset_response.ends_with("\r\n\r\n"));
}

/// socket 端到端：GET / → 200 + html Content-Type + 首页内容（read_to_end
/// 依赖 `Connection: close` + shutdown 产生 EOF）。
#[tokio::test]
async fn serve_returns_index() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        serve(stream, "GET / HTTP/1.1\r\nHost: test\r\n\r\n")
            .await
            .unwrap();
    });
    let mut client = TcpStream::connect(addr).await.unwrap();
    let mut buf = Vec::new();
    client.read_to_end(&mut buf).await.unwrap();
    server.await.unwrap();

    let text = String::from_utf8(buf).unwrap();
    assert!(text.starts_with("HTTP/1.1 200 OK\r\n"), "{text:?}");
    assert!(
        text.contains("Content-Type: text/html; charset=utf-8"),
        "{text:?}"
    );
    assert!(text.contains("Peri Studio Web 面板"), "{text:?}");
    assert!(text.contains("</html>"), "{text:?}");
}

/// socket 端到端：未知路径 → 404（含 Content-Length，体为纯文本）。
#[tokio::test]
async fn serve_returns_404() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        serve(
            stream,
            "GET /no-such-resource HTTP/1.1\r\nHost: test\r\n\r\n",
        )
        .await
        .unwrap();
    });
    let mut client = TcpStream::connect(addr).await.unwrap();
    let mut buf = Vec::new();
    client.read_to_end(&mut buf).await.unwrap();
    server.await.unwrap();

    let text = String::from_utf8(buf).unwrap();
    assert!(text.starts_with("HTTP/1.1 404 Not Found\r\n"), "{text:?}");
    assert!(text.contains("Content-Length: 14"), "{text:?}");
    assert!(text.ends_with("404 Not Found\n"), "{text:?}");
}

/// socket 端到端：query 路径同样命中（浏览器缓存失效参数）。
#[tokio::test]
async fn serve_handles_query() {
    // 取资产表中第一个 js 作为探测目标（hash 文件名不硬编码）。
    let js = ASSETS
        .iter()
        .find(|a| a.url.ends_with(".js"))
        .expect("有 js 产物");
    let path = format!("/{}?t=1", js.url);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        serve(
            stream,
            &format!("GET {path} HTTP/1.1\r\nHost: test\r\n\r\n"),
        )
        .await
        .unwrap();
    });
    let mut client = TcpStream::connect(addr).await.unwrap();
    let mut buf = Vec::new();
    client.read_to_end(&mut buf).await.unwrap();
    server.await.unwrap();

    let text = String::from_utf8(buf).unwrap();
    assert!(text.starts_with("HTTP/1.1 200 OK\r\n"), "{text:?}");
    assert!(
        text.contains("Content-Type: text/javascript; charset=utf-8"),
        "{text:?}"
    );
    // 响应体与内嵌字节一致（Content-Length 精确匹配）。
    let body_start = text.find("\r\n\r\n").map(|i| i + 4).expect("有头部结束符");
    assert_eq!(&text.as_bytes()[body_start..], js.bytes);
}

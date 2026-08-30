//! `POST /api/local/pick-directory`：已认证 loopback 会话下唤起本机目录选择器。

use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;

use tokio::net::TcpStream;
use tokio::sync::Mutex;

use crate::auth::AuthService;
use crate::protocol::validate_cwd;
use crate::web::http::{security_headers, write_http};
use crate::web::local_dialog::pick_directory;

const PROMPT: &str = "Select a project folder";

pub(crate) async fn serve_pick_directory(
    mut stream: TcpStream,
    peer: SocketAddr,
    auth: Arc<Mutex<AuthService>>,
    method: &str,
    cookie: Option<&str>,
    transfer_encoding: Option<&str>,
    content_length: usize,
) -> std::io::Result<()> {
    if method != "POST" {
        return write_http(
            &mut stream,
            "405 Method Not Allowed",
            "application/json",
            br#"{"error":"method"}"#,
            &security_headers(),
        )
        .await;
    }
    if transfer_encoding.is_some() || content_length != 0 {
        return write_http(
            &mut stream,
            "400 Bad Request",
            "application/json",
            br#"{"error":"body_not_allowed"}"#,
            &security_headers(),
        )
        .await;
    }
    let Some(session_id) = cookie else {
        return write_http(
            &mut stream,
            "401 Unauthorized",
            "application/json",
            br#"{"error":"unauthorized"}"#,
            &security_headers(),
        )
        .await;
    };
    if auth
        .lock()
        .await
        .validate_browser_session(session_id, peer)
        .is_err()
    {
        return write_http(
            &mut stream,
            "401 Unauthorized",
            "application/json",
            br#"{"error":"unauthorized"}"#,
            &security_headers(),
        )
        .await;
    }

    let picked = tokio::task::spawn_blocking(|| pick_directory(PROMPT))
        .await
        .map_err(std::io::Error::other)?;

    let body = match picked {
        None => serde_json::json!({ "cancelled": true }),
        Some(path) => {
            let path = path.to_string_lossy().into_owned();
            if validate_cwd(&path).is_err() || !Path::new(&path).is_dir() {
                return write_http(
                    &mut stream,
                    "400 Bad Request",
                    "application/json",
                    br#"{"error":"invalid_directory"}"#,
                    &security_headers(),
                )
                .await;
            }
            serde_json::json!({ "path": path })
        }
    };
    let bytes = serde_json::to_vec(&body).expect("pick directory response serializes");
    write_http(
        &mut stream,
        "200 OK",
        "application/json",
        &bytes,
        &security_headers(),
    )
    .await
}

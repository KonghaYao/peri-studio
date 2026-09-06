//! 同源 upload PUT 端点。

use std::net::SocketAddr;
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::Mutex;

use peri_studio_proto::resource::MAX_RESOURCE_BLOB_BYTES;

use crate::auth::{AuthService, TokenRole};
use crate::control::resource_upload_store::UploadStoreError;
use crate::control::ResourceService;
use crate::web::http::security_headers;

#[allow(clippy::too_many_arguments)]
pub(crate) async fn serve_resource_upload(
    mut stream: TcpStream,
    peer: SocketAddr,
    auth: Arc<Mutex<AuthService>>,
    resources: Arc<ResourceService>,
    upload_id: &str,
    method: &str,
    cookie: Option<String>,
    origin_valid: bool,
    transfer_encoding: Option<&str>,
    content_length: Option<usize>,
    mut buffered_body: Vec<u8>,
    deadline: tokio::time::Instant,
) -> std::io::Result<()> {
    if upload_id.is_empty() || upload_id.contains('/') || !origin_valid {
        return response(&mut stream, "403 Forbidden", "forbidden").await;
    }
    if method != "PUT" || transfer_encoding.is_some() {
        return response(&mut stream, "405 Method Not Allowed", "method").await;
    }
    let Some(content_length) = content_length else {
        return response(&mut stream, "411 Length Required", "length_required").await;
    };
    if content_length > MAX_RESOURCE_BLOB_BYTES as usize {
        return response(&mut stream, "413 Payload Too Large", "too_large").await;
    }
    let Some(session_id) = cookie.as_deref() else {
        return response(&mut stream, "401 Unauthorized", "unauthorized").await;
    };
    let ctx = match auth.lock().await.validate_browser_session(session_id, peer) {
        Ok(ctx) => ctx,
        Err(_) => return response(&mut stream, "401 Unauthorized", "unauthorized").await,
    };
    if ctx.role != TokenRole::Full {
        return response(&mut stream, "403 Forbidden", "forbidden").await;
    }
    if let Err(error) = resources
        .begin_upload_put(&ctx.token_id, upload_id, content_length)
        .await
    {
        return store_error_response(&mut stream, error).await;
    }
    if buffered_body.len() > content_length {
        resources.abort_upload_put(&ctx.token_id, upload_id).await;
        return response(&mut stream, "400 Bad Request", "length_mismatch").await;
    }
    while buffered_body.len() < content_length {
        let remaining = content_length - buffered_body.len();
        let mut chunk = vec![0u8; remaining.min(16 * 1024)];
        let read = match tokio::time::timeout_at(deadline, stream.read(&mut chunk)).await {
            Ok(Ok(read)) => read,
            Ok(Err(error)) => {
                resources.abort_upload_put(&ctx.token_id, upload_id).await;
                return Err(error);
            }
            Err(_) => {
                resources.abort_upload_put(&ctx.token_id, upload_id).await;
                return response(&mut stream, "408 Request Timeout", "timeout").await;
            }
        };
        if read == 0 {
            resources.abort_upload_put(&ctx.token_id, upload_id).await;
            return response(&mut stream, "400 Bad Request", "length_mismatch").await;
        }
        buffered_body.extend_from_slice(&chunk[..read]);
    }
    match resources
        .complete_upload_put(&ctx.token_id, upload_id, buffered_body)
        .await
    {
        Ok(()) => response(&mut stream, "204 No Content", "").await,
        Err(error) => store_error_response(&mut stream, error).await,
    }
}

async fn store_error_response(
    stream: &mut TcpStream,
    error: UploadStoreError,
) -> std::io::Result<()> {
    let (status, code) = match error {
        UploadStoreError::NotFound | UploadStoreError::BindingMismatch => {
            ("404 Not Found", "not_found")
        }
        UploadStoreError::Expired => ("410 Gone", "expired"),
        UploadStoreError::TooLarge => ("413 Payload Too Large", "too_large"),
        UploadStoreError::RateLimited => ("429 Too Many Requests", "rate_limited"),
        UploadStoreError::AlreadyComplete
        | UploadStoreError::AlreadyConsumed
        | UploadStoreError::InvalidState => ("409 Conflict", "conflict"),
        UploadStoreError::LengthMismatch => ("400 Bad Request", "length_mismatch"),
        UploadStoreError::ChecksumMismatch => ("400 Bad Request", "checksum_mismatch"),
    };
    response(stream, status, code).await
}

async fn response(stream: &mut TcpStream, status: &str, code: &str) -> std::io::Result<()> {
    let body = if code.is_empty() {
        Vec::new()
    } else {
        serde_json::to_vec(&serde_json::json!({"error": code})).expect("static upload error")
    };
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{}\r\n",
        body.len(),
        security_headers()
            .into_iter()
            .map(|(name, value)| format!("{name}: {value}\r\n"))
            .collect::<String>()
    );
    stream.write_all(header.as_bytes()).await?;
    if !body.is_empty() {
        stream.write_all(&body).await?;
    }
    stream.shutdown().await
}

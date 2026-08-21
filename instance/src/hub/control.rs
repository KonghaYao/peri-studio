//! managed-local instance 的身份绑定关闭通道。
//!
//! supervisor 不直接向 adopted PID 发信号；它通过数据目录内的 0600 Unix
//! socket 发送 HMAC 认证请求，由仍持有 owner lock 的进程自行关闭。

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::Context as _;
use base64::Engine as _;
use hmac::{Hmac, Mac as _};
use rand::Rng as _;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

use super::startup::InstanceOwnerIdentity;

const CONTROL_VERSION: u32 = 1;
const CONTROL_FRAME_MAX_BYTES: usize = 32 * 1024;
const CONTROL_SOCKET_NAME: &str = "instance.owner.sock";
const CONTROL_DOMAIN: &[u8] = b"peri-studio-owner-control-v1\0";

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShutdownRequest {
    version: u32,
    owner: InstanceOwnerIdentity,
    nonce: String,
    mac: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShutdownAck {
    version: u32,
    nonce: String,
    mac: String,
}

/// instance 持有的本地关闭监听器；drop 时删除 socket 路径。
#[cfg(unix)]
pub(super) struct OwnerControl {
    listener: tokio::net::UnixListener,
    path: PathBuf,
    owner: InstanceOwnerIdentity,
}

#[cfg(unix)]
impl OwnerControl {
    pub(super) fn bind(data_dir: &Path, owner: InstanceOwnerIdentity) -> anyhow::Result<Self> {
        use std::os::unix::fs::PermissionsExt as _;

        let path = data_dir.join(CONTROL_SOCKET_NAME);
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error).context("failed to remove stale owner control socket"),
        }
        let listener =
            tokio::net::UnixListener::bind(&path).context("failed to bind owner control socket")?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
        Ok(Self {
            listener,
            path,
            owner,
        })
    }

    /// 持续拒绝无效请求，直到收到绑定当前 owner 身份的合法关闭请求。
    pub(super) async fn wait_for_shutdown(self, token: String) -> anyhow::Result<()> {
        loop {
            let (mut stream, _) = self.listener.accept().await?;
            match tokio::time::timeout(
                Duration::from_secs(2),
                handle_request(&mut stream, &self.owner, &token),
            )
            .await
            {
                Ok(Ok(())) => return Ok(()),
                Ok(Err(error)) => {
                    tracing::warn!(
                        target: "peri_studio::instance",
                        %error,
                        "rejected owner control request"
                    );
                }
                Err(_) => tracing::warn!(
                    target: "peri_studio::instance",
                    "owner control request timed out"
                ),
            }
        }
    }
}

#[cfg(unix)]
impl Drop for OwnerControl {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_file(&self.path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(
                    target: "peri_studio::instance",
                    %error,
                    "failed to remove owner control socket"
                );
            }
        }
    }
}

#[cfg(not(unix))]
pub(super) struct OwnerControl;

#[cfg(not(unix))]
impl OwnerControl {
    pub(super) fn bind(_data_dir: &Path, _owner: InstanceOwnerIdentity) -> anyhow::Result<Self> {
        anyhow::bail!("managed-local adoption requires Unix owner control sockets")
    }

    pub(super) async fn wait_for_shutdown(self, _token: String) -> anyhow::Result<()> {
        anyhow::bail!("managed-local adoption requires Unix owner control sockets")
    }
}

/// 请求当前 owner 自行关闭，并校验其认证回执。
#[cfg(unix)]
pub async fn request_shutdown(
    data_dir: &Path,
    owner: &InstanceOwnerIdentity,
    token: &str,
) -> anyhow::Result<()> {
    tokio::time::timeout(
        Duration::from_secs(3),
        request_shutdown_inner(data_dir, owner, token),
    )
    .await
    .context("owner control request timed out")?
}

#[cfg(unix)]
async fn request_shutdown_inner(
    data_dir: &Path,
    owner: &InstanceOwnerIdentity,
    token: &str,
) -> anyhow::Result<()> {
    let mut stream = tokio::net::UnixStream::connect(data_dir.join(CONTROL_SOCKET_NAME))
        .await
        .context("failed to connect owner control socket")?;
    let mut nonce_bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut nonce_bytes);
    let nonce = base64::engine::general_purpose::STANDARD.encode(nonce_bytes);
    let request = ShutdownRequest {
        version: CONTROL_VERSION,
        owner: owner.clone(),
        mac: control_mac(token, b"shutdown", owner, &nonce),
        nonce: nonce.clone(),
    };
    write_frame(&mut stream, &serde_json::to_vec(&request)?).await?;
    stream.shutdown().await?;

    let ack: ShutdownAck = serde_json::from_slice(&read_frame(&mut stream).await?)?;
    if ack.version != CONTROL_VERSION || ack.nonce != nonce {
        anyhow::bail!("owner control acknowledgement is invalid");
    }
    verify_control_mac(token, b"ack", owner, &ack.nonce, &ack.mac)
        .context("owner control acknowledgement authentication failed")
}

#[cfg(not(unix))]
pub async fn request_shutdown(
    _data_dir: &Path,
    _owner: &InstanceOwnerIdentity,
    _token: &str,
) -> anyhow::Result<()> {
    anyhow::bail!("managed-local adoption requires Unix owner control sockets")
}

#[cfg(unix)]
async fn handle_request(
    stream: &mut tokio::net::UnixStream,
    owner: &InstanceOwnerIdentity,
    token: &str,
) -> anyhow::Result<()> {
    let request: ShutdownRequest = serde_json::from_slice(&read_frame(stream).await?)?;
    if request.version != CONTROL_VERSION || request.owner != *owner {
        anyhow::bail!("owner control identity mismatch");
    }
    let nonce = base64::engine::general_purpose::STANDARD
        .decode(&request.nonce)
        .context("owner control nonce is invalid")?;
    if nonce.len() != 32 {
        anyhow::bail!("owner control nonce has invalid length");
    }
    verify_control_mac(token, b"shutdown", owner, &request.nonce, &request.mac)?;
    let ack_mac = control_mac(token, b"ack", owner, &request.nonce);
    let ack = ShutdownAck {
        version: CONTROL_VERSION,
        nonce: request.nonce,
        mac: ack_mac,
    };
    write_frame(stream, &serde_json::to_vec(&ack)?).await
}

fn control_mac(token: &str, purpose: &[u8], owner: &InstanceOwnerIdentity, nonce: &str) -> String {
    let mac = control_authenticator(token, purpose, owner, nonce);
    base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes())
}

fn verify_control_mac(
    token: &str,
    purpose: &[u8],
    owner: &InstanceOwnerIdentity,
    nonce: &str,
    encoded: &str,
) -> anyhow::Result<()> {
    let expected = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .context("owner control MAC is invalid base64")?;
    control_authenticator(token, purpose, owner, nonce)
        .verify_slice(&expected)
        .map_err(|_| anyhow::anyhow!("owner control MAC mismatch"))
}

/// 唯一规范化 MAC 输入，确保生成与校验不会随协议演进产生字段漂移。
fn control_authenticator(
    token: &str,
    purpose: &[u8],
    owner: &InstanceOwnerIdentity,
    nonce: &str,
) -> HmacSha256 {
    let mut mac = HmacSha256::new_from_slice(token.as_bytes()).expect("HMAC accepts any key size");
    mac.update(CONTROL_DOMAIN);
    mac.update(purpose);
    mac.update(b"\0");
    mac.update(&serde_json::to_vec(owner).expect("owner identity is serializable"));
    mac.update(b"\0");
    mac.update(nonce.as_bytes());
    mac
}

#[cfg(unix)]
async fn read_frame(stream: &mut tokio::net::UnixStream) -> anyhow::Result<Vec<u8>> {
    let mut length = [0u8; 4];
    stream.read_exact(&mut length).await?;
    let length = u32::from_be_bytes(length) as usize;
    if length > CONTROL_FRAME_MAX_BYTES {
        anyhow::bail!("owner control frame is too large");
    }
    let mut body = vec![0u8; length];
    stream.read_exact(&mut body).await?;
    Ok(body)
}

#[cfg(unix)]
async fn write_frame(stream: &mut tokio::net::UnixStream, body: &[u8]) -> anyhow::Result<()> {
    if body.len() > CONTROL_FRAME_MAX_BYTES {
        anyhow::bail!("owner control frame is too large");
    }
    stream.write_all(&(body.len() as u32).to_be_bytes()).await?;
    stream.write_all(body).await?;
    stream.flush().await?;
    Ok(())
}

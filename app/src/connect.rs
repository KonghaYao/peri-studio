//! instance 角色：读取凭据并连接一个 server。

use std::path::{Path, PathBuf};

use anyhow::Context as _;
use tokio_util::sync::CancellationToken;

use crate::connection::instance_endpoint;
use crate::private_file::read_private_text;

/// 连接模式所需的稳定输入。
#[derive(Debug, Clone)]
pub struct ConnectOptions {
    pub server: String,
    pub token_file: PathBuf,
    pub data_dir: Option<PathBuf>,
    pub allow_insecure: bool,
    pub managed_local_id: Option<String>,
}

/// 运行 instance 角色，直到调用方取消或 transport 终止。
pub async fn run(options: ConnectOptions, shutdown: CancellationToken) -> anyhow::Result<()> {
    let endpoint = instance_endpoint(&options.server, options.allow_insecure)?;
    let token = read_token(&options.token_file)?;
    let data_dir = options
        .data_dir
        .unwrap_or_else(|| default_instance_data_dir(&endpoint));
    std::fs::create_dir_all(&data_dir)
        .with_context(|| format!("failed to create instance data dir: {}", data_dir.display()))?;
    let mut config =
        peri_instance::hub::InstanceConfig::new(endpoint.clone(), token, data_dir.clone());
    config.managed_local_id = options.managed_local_id;
    tracing::info!(server = %endpoint, data_dir = %data_dir.display(), "instance role starting");
    peri_instance::hub::run(config, shutdown).await
}

fn read_token(path: &Path) -> anyhow::Result<String> {
    read_private_text(path, "token file")
}

fn default_instance_data_dir(endpoint: &str) -> PathBuf {
    let profile = url::Url::parse(endpoint)
        .ok()
        .and_then(|url| {
            let host = url.host_str()?;
            let port = url.port_or_known_default()?;
            Some(sanitize_profile(&format!("{host}-{port}")))
        })
        .unwrap_or_else(|| "default".to_string());
    dirs_next::home_dir()
        .map(|home| {
            home.join(".local")
                .join("share")
                .join("peri-studio")
                .join("instances")
                .join(&profile)
        })
        .unwrap_or_else(|| PathBuf::from(".").join("instances").join(profile))
}

fn sanitize_profile(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{default_instance_data_dir, read_token, sanitize_profile};

    #[cfg(unix)]
    fn make_private(path: &std::path::Path) {
        use std::os::unix::fs::PermissionsExt as _;

        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }

    #[test]
    fn profile_is_safe_for_ipv6_and_dns_names() {
        assert_eq!(sanitize_profile("[::1]-8456"), "___1_-8456");
        assert_eq!(sanitize_profile("peri.example-443"), "peri.example-443");
        assert!(default_instance_data_dir("wss://peri.example/instance")
            .ends_with("instances/peri.example-443"));
    }

    #[test]
    fn token_reader_rejects_empty_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("token");
        std::fs::write(&path, "  \n").unwrap();
        #[cfg(unix)]
        make_private(&path);
        assert!(read_token(&path).unwrap_err().to_string().contains("empty"));
    }

    #[test]
    fn token_reader_rejects_oversized_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("token");
        std::fs::write(
            &path,
            "x".repeat(crate::private_file::CREDENTIAL_MAX_BYTES + 1),
        )
        .unwrap();
        #[cfg(unix)]
        make_private(&path);
        assert!(read_token(&path)
            .unwrap_err()
            .to_string()
            .contains("too large"));
    }

    #[cfg(unix)]
    #[test]
    fn token_reader_rejects_group_or_world_access() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("token");
        std::fs::write(&path, "secret\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(read_token(&path)
            .unwrap_err()
            .to_string()
            .contains("group or world"));
    }
}

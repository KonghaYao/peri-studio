//! 跨 OS/arch SSH 安装用的钉选 release 资产 SHA256 表（ssh-machine-mount §7.2）。
//!
//! 表项在每次 `peri-studio-v*` 发布时与 CI 产物同步更新；运行时只信任本表，
//! 不从 GitHub API 解析「最新」版本。

/// 与 workspace `[package].version` 对齐的产品 semver。
pub const PRODUCT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// 单条 release 资产：平台键 → 锁定 SHA256（小写 hex，无 `sha256:` 前缀）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseAsset {
    pub platform: &'static str,
    pub file_name: String,
    pub sha256_hex: &'static str,
}

/// 将远端 `uname` 输出映射为 release 资产平台键。
pub fn platform_key(os: &str, arch: &str) -> Option<&'static str> {
    let os = normalize_os(os);
    let arch = normalize_arch(arch);
    match (os.as_str(), arch.as_str()) {
        ("linux", "x86_64") => Some("linux-x86_64"),
        ("linux", "aarch64") => Some("linux-aarch64"),
        ("darwin", "aarch64") => Some("macos-arm64"),
        _ => None,
    }
}

/// 按平台键查找钉选 checksum 资产；无表项则跨 arch 安装不可用。
pub fn lookup(platform: &str) -> Option<ReleaseAsset> {
    RELEASE_CHECKSUMS
        .iter()
        .find(|entry| entry.0 == platform)
        .map(|(platform, sha256)| ReleaseAsset {
            platform,
            file_name: release_file_name(platform),
            sha256_hex: sha256,
        })
}

/// release 归档内根目录名（与 `file_name` 去 `.tar.gz` 一致）。
pub fn archive_root_dir(asset: &ReleaseAsset) -> String {
    asset
        .file_name
        .strip_suffix(".tar.gz")
        .unwrap_or(&asset.file_name)
        .to_string()
}

fn release_file_name(platform: &str) -> String {
    format!("peri-studio-{PRODUCT_VERSION}-{platform}.tar.gz")
}

fn normalize_os(value: &str) -> String {
    let v = value.to_ascii_lowercase();
    if v.contains("darwin") {
        "darwin".into()
    } else if v.contains("linux") {
        "linux".into()
    } else {
        v
    }
}

fn normalize_arch(value: &str) -> String {
    match value.to_ascii_lowercase().as_str() {
        "x86_64" | "amd64" => "x86_64".into(),
        "aarch64" | "arm64" => "aarch64".into(),
        other => other.into(),
    }
}

/// 锁定 SHA256 表：平台键 → hex digest。
/// 发布 `peri-studio-v{PRODUCT_VERSION}` 时由 release workflow 产物更新。
const RELEASE_CHECKSUMS: &[(&str, &str)] = &[
    (
        "linux-x86_64",
        "0000000000000000000000000000000000000000000000000000000000000000",
    ),
    (
        "linux-aarch64",
        "0000000000000000000000000000000000000000000000000000000000000000",
    ),
    (
        "macos-arm64",
        "0000000000000000000000000000000000000000000000000000000000000000",
    ),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_key_maps_linux_and_macos_targets() {
        assert_eq!(platform_key("Linux", "x86_64"), Some("linux-x86_64"));
        assert_eq!(platform_key("Linux", "aarch64"), Some("linux-aarch64"));
        assert_eq!(platform_key("Darwin", "arm64"), Some("macos-arm64"));
        assert_eq!(platform_key("FreeBSD", "x86_64"), None);
    }

    #[test]
    fn lookup_returns_versioned_asset_names_and_checksums() {
        let asset = lookup("linux-x86_64").expect("linux-x86_64 entry");
        assert_eq!(asset.platform, "linux-x86_64");
        assert_eq!(
            asset.file_name,
            format!("peri-studio-{PRODUCT_VERSION}-linux-x86_64.tar.gz")
        );
        assert_eq!(asset.sha256_hex.len(), 64);

        let arm = lookup("linux-aarch64").expect("linux-aarch64 entry");
        assert!(arm.file_name.contains("linux-aarch64"));

        let mac = lookup("macos-arm64").expect("macos-arm64 entry");
        assert!(mac.file_name.contains("macos-arm64"));

        assert!(lookup("windows-x86_64").is_none());
    }
}

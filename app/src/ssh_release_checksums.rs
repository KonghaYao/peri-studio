//! 跨 OS/arch SSH 安装用的 release 资产目标表（ssh-machine-mount §7.2）。
//!
//! 资产名与公开 release 单二进制契约一致；下载时必须同时取得同名 `.sha256`
//! 并完成校验，不从 GitHub API 解析「最新」版本。

/// 与 workspace `[package].version` 对齐的产品 semver。
pub const PRODUCT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// 单条 release 资产：Rust target triple 与对应文件名。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseAsset {
    pub platform: &'static str,
    pub file_name: String,
}

/// 将远端 `uname` 输出映射为 release 资产平台键。
pub fn platform_key(os: &str, arch: &str) -> Option<&'static str> {
    let os = normalize_os(os);
    let arch = normalize_arch(arch);
    match (os.as_str(), arch.as_str()) {
        ("linux", "x86_64") => Some("x86_64-unknown-linux-gnu"),
        ("darwin", "aarch64") => Some("aarch64-apple-darwin"),
        _ => None,
    }
}

/// 按 Rust target triple 查找发布资产；无表项则跨 arch 安装不可用。
pub fn lookup(platform: &str) -> Option<ReleaseAsset> {
    RELEASE_TARGETS
        .iter()
        .find(|target| **target == platform)
        .map(|platform| ReleaseAsset {
            platform,
            file_name: release_file_name(platform),
        })
}

fn release_file_name(platform: &str) -> String {
    format!("peri-studio-{PRODUCT_VERSION}-{platform}")
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

/// 当前公开 release 提供的 Unix Rust target triple。
const RELEASE_TARGETS: &[&str] = &["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_key_maps_published_targets() {
        assert_eq!(
            platform_key("Linux", "x86_64"),
            Some("x86_64-unknown-linux-gnu")
        );
        assert_eq!(platform_key("Linux", "aarch64"), None);
        assert_eq!(
            platform_key("Darwin", "arm64"),
            Some("aarch64-apple-darwin")
        );
        assert_eq!(platform_key("FreeBSD", "x86_64"), None);
    }

    #[test]
    fn lookup_returns_versioned_asset_names_and_checksums() {
        let asset = lookup("x86_64-unknown-linux-gnu").expect("Linux x86_64 entry");
        assert_eq!(asset.platform, "x86_64-unknown-linux-gnu");
        assert_eq!(
            asset.file_name,
            format!("peri-studio-{PRODUCT_VERSION}-x86_64-unknown-linux-gnu")
        );

        let mac = lookup("aarch64-apple-darwin").expect("macOS ARM64 entry");
        assert!(mac.file_name.contains("aarch64-apple-darwin"));

        assert!(lookup("x86_64-pc-windows-msvc").is_none());
    }
}

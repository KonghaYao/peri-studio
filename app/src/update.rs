//! `peri-studio update`：拉取并执行官方 `install.sh`。

use std::path::{Path, PathBuf};

#[cfg(unix)]
use std::io::Write as _;
#[cfg(unix)]
use std::process::{Command, Stdio};

use anyhow::Context as _;

/// 与 README / `scripts/install.sh` 注释相同的官方安装脚本地址。
const INSTALL_SCRIPT_URL: &str =
    "https://raw.githubusercontent.com/KonghaYao/peri-studio/main/scripts/install.sh";

const INSTALL_DIR_ENV: &str = "PERI_STUDIO_INSTALL_DIR";
const NO_PATH_HINT_ENV: &str = "PERI_STUDIO_NO_PATH_HINT";

#[derive(Debug, Clone, PartialEq, Eq)]
struct InstallerEnv {
    install_dir: Option<PathBuf>,
    skip_path_hint: bool,
}

/// 下载官方安装脚本并交给 bash；沿用脚本既有环境变量。
pub fn run() -> anyhow::Result<()> {
    #[cfg(not(unix))]
    {
        anyhow::bail!("peri-studio update uses the Unix installer; this platform is not supported");
    }
    #[cfg(unix)]
    run_unix()
}

#[cfg(unix)]
fn run_unix() -> anyhow::Result<()> {
    let script = download_installer()?;
    let env = installer_env(
        std::env::var_os(INSTALL_DIR_ENV).is_none(),
        std::env::var_os(NO_PATH_HINT_ENV).is_none(),
        inferred_install_dir(std::env::current_exe().ok().as_deref()),
    );
    let mut bash = Command::new("bash");
    bash.stdin(Stdio::piped());
    apply_installer_env(&mut bash, &env);
    let mut child = bash
        .spawn()
        .context("failed to start bash for the installer")?;
    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow::anyhow!("failed to pipe installer into bash"))?;
        stdin
            .write_all(&script)
            .context("failed to write installer to bash")?;
    }
    let status = child.wait().context("failed to wait for installer")?;
    if !status.success() {
        let code = status.code().unwrap_or(1);
        anyhow::bail!("installer exited with status {code}");
    }
    Ok(())
}

#[cfg(unix)]
fn download_installer() -> anyhow::Result<Vec<u8>> {
    let output = Command::new("curl")
        .args(["-fsSL", INSTALL_SCRIPT_URL])
        .stdin(Stdio::null())
        .output()
        .context("failed to start curl; install curl to update Peri Studio")?;
    if !output.status.success() {
        anyhow::bail!("failed to download installer from {INSTALL_SCRIPT_URL}");
    }
    let script = output.stdout;
    if !script.starts_with(b"#!") {
        anyhow::bail!("downloaded installer is not a shell script");
    }
    Ok(script)
}

fn installer_env(
    inherit_install_dir: bool,
    skip_path_hint: bool,
    inferred_install_dir: Option<PathBuf>,
) -> InstallerEnv {
    InstallerEnv {
        install_dir: if inherit_install_dir {
            inferred_install_dir
        } else {
            None
        },
        skip_path_hint,
    }
}

#[cfg(unix)]
fn apply_installer_env(command: &mut Command, env: &InstallerEnv) {
    if env.skip_path_hint {
        command.env(NO_PATH_HINT_ENV, "1");
    }
    if let Some(dir) = &env.install_dir {
        command.env(INSTALL_DIR_ENV, dir);
    }
}

/// 当前可执行文件位于 `peri-studio-v*/peri-studio` 时，安装根目录为其父目录。
fn inferred_install_dir(current_exe: Option<&Path>) -> Option<PathBuf> {
    let exe = current_exe?;
    let resolved = std::fs::canonicalize(exe).unwrap_or_else(|_| exe.to_path_buf());
    let file_name = resolved.file_name()?.to_str()?;
    if file_name != "peri-studio" && file_name != "peri-studio.exe" {
        return None;
    }
    let version_dir = resolved.parent()?;
    let version_name = version_dir.file_name()?.to_str()?;
    if !version_name.starts_with("peri-studio-v") {
        return None;
    }
    Some(version_dir.parent()?.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installer_url_matches_published_script() {
        let install = include_str!("../../scripts/install.sh");
        assert!(install.contains("KonghaYao/peri-studio"));
        assert!(install
            .contains("raw.githubusercontent.com/KonghaYao/peri-studio/main/scripts/install.sh"));
        assert_eq!(
            INSTALL_SCRIPT_URL,
            "https://raw.githubusercontent.com/KonghaYao/peri-studio/main/scripts/install.sh"
        );
    }

    #[test]
    fn infers_versioned_install_root() {
        let root = tempfile::tempdir().unwrap();
        let version_dir = root.path().join("peri-studio-v0.3.5");
        std::fs::create_dir(&version_dir).unwrap();
        let binary = version_dir.join("peri-studio");
        std::fs::write(&binary, []).unwrap();
        let expected = std::fs::canonicalize(root.path()).unwrap();
        assert_eq!(inferred_install_dir(Some(&binary)), Some(expected));
    }

    #[test]
    fn ignores_unversioned_binaries() {
        let root = tempfile::tempdir().unwrap();
        let binary = root.path().join("peri-studio");
        std::fs::write(&binary, []).unwrap();
        assert_eq!(inferred_install_dir(Some(&binary)), None);
    }

    #[test]
    fn defaults_to_inferred_dir_and_skips_path_hint() {
        assert_eq!(
            installer_env(true, true, Some(PathBuf::from("/custom/peri"))),
            InstallerEnv {
                install_dir: Some(PathBuf::from("/custom/peri")),
                skip_path_hint: true,
            }
        );
    }

    #[test]
    fn keeps_caller_install_dir_and_path_hint() {
        assert_eq!(
            installer_env(false, false, Some(PathBuf::from("/ignored"))),
            InstallerEnv {
                install_dir: None,
                skip_path_hint: false,
            }
        );
    }
}

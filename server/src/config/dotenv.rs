//! 可选 `.env` 加载：不覆盖进程已有变量（与 `dev.sh` 语义一致）。
//!
//! 查找顺序由调用方决定；典型为仓库根 `cwd/.env`（`app` 启动前）与
//! `config_dir/.env`（[`Config::load`](super::Config::load) 内）。

use std::path::Path;

/// 若 `path` 存在则解析 `KEY=VALUE` 行并 `set_var`（仅当键尚未设置）。
pub fn load_file_if_present(path: &Path) {
    if !path.is_file() {
        return;
    }
    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) => {
            tracing::debug!(path = %path.display(), error = %error, "skip dotenv file read");
            return;
        }
    };
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, raw_value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() || !is_valid_env_key(key) {
            continue;
        }
        if std::env::var_os(key).is_some() {
            continue;
        }
        let value = strip_optional_quotes(raw_value.trim());
        std::env::set_var(key, value);
    }
}

/// 当前工作目录下的 `.env`（开发仓库根目录常见）。
pub fn load_cwd_if_present() {
    if let Ok(cwd) = std::env::current_dir() {
        load_file_if_present(&cwd.join(".env"));
    }
}

fn is_valid_env_key(key: &str) -> bool {
    let mut chars = key.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphabetic() || first == '_' => {}
        _ => return false,
    }
    chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

fn strip_optional_quotes(value: &str) -> String {
    if value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
    {
        return value[1..value.len() - 1].to_string();
    }
    value.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::path::PathBuf;

    #[test]
    #[serial]
    fn load_file_if_present_does_not_override_existing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".env");
        std::fs::write(&path, "LANGFUSE_HOST=https://from-dotenv.example\n").unwrap();
        std::env::set_var("LANGFUSE_HOST", "https://already-set.example");
        load_file_if_present(&path);
        assert_eq!(
            std::env::var("LANGFUSE_HOST").unwrap(),
            "https://already-set.example"
        );
        std::env::remove_var("LANGFUSE_HOST");
    }

    #[test]
    #[serial]
    fn load_file_if_present_sets_unset_keys_with_quotes() {
        let dir = tempfile::tempdir().unwrap();
        let path: PathBuf = dir.path().join(".env");
        std::fs::write(
            &path,
            "LANGFUSE_BASE_URL=\"https://jp.cloud.langfuse.com\"\n",
        )
        .unwrap();
        std::env::remove_var("LANGFUSE_BASE_URL");
        load_file_if_present(&path);
        assert_eq!(
            std::env::var("LANGFUSE_BASE_URL").unwrap(),
            "https://jp.cloud.langfuse.com"
        );
        std::env::remove_var("LANGFUSE_BASE_URL");
    }
}

//! Langfuse 配置解析（`config.toml` / CLI env / 进程 env 同源，优先级见 [`Config`]）。

use std::collections::HashMap;

use crate::langfuse::{
    build_langfuse_config, LangfuseConfig, DEFAULT_LANGFUSE_HOST, LANGFUSE_BASE_URL_ENV,
    LANGFUSE_HOST_ENV, LANGFUSE_PUBLIC_KEY_ENV, LANGFUSE_SECRET_KEY_ENV,
};

use super::{CliOverrides, Config, SecretString};

impl Config {
    /// 已配置判定：public + secret 均非空 trim 后。
    pub fn langfuse_enabled(&self) -> bool {
        self.resolved_langfuse_public_key().is_some()
            && self.resolved_langfuse_secret_key().is_some()
    }

    /// Monitor 读路径与 spawn 注入共用的客户端配置。
    pub fn langfuse_client_config(&self) -> Option<LangfuseConfig> {
        let public_key = self.resolved_langfuse_public_key()?;
        let secret_key = self.resolved_langfuse_secret_key()?;
        build_langfuse_config(&public_key, &secret_key, &self.resolved_langfuse_base_url())
    }

    /// Hub spawn：非空 `LANGFUSE_*` 键值（密钥不得入日志）。
    pub fn langfuse_spawn_env(&self) -> HashMap<String, String> {
        if !self.langfuse_enabled() {
            return HashMap::new();
        }
        let mut env = HashMap::new();
        if let Some(value) = self.resolved_langfuse_public_key() {
            env.insert(LANGFUSE_PUBLIC_KEY_ENV.to_string(), value);
        }
        if let Some(value) = self.resolved_langfuse_secret_key() {
            env.insert(LANGFUSE_SECRET_KEY_ENV.to_string(), value);
        }
        if let Some(value) = self.resolved_langfuse_base_url_value() {
            env.insert(LANGFUSE_BASE_URL_ENV.to_string(), value);
        } else if let Some(value) = self.resolved_langfuse_host_value() {
            env.insert(LANGFUSE_HOST_ENV.to_string(), value);
        }
        env
    }

    pub(super) fn merge_langfuse_cli(&mut self, cli: &CliOverrides) {
        if let Some(v) = &cli.langfuse_public_key {
            self.langfuse_public_key = Some(v.clone());
        }
        if let Some(v) = &cli.langfuse_secret_key {
            self.langfuse_secret_key = Some(v.clone());
        }
        if let Some(v) = &cli.langfuse_host {
            self.langfuse_host = Some(v.clone());
        }
        if let Some(v) = &cli.langfuse_base_url {
            self.langfuse_base_url = Some(v.clone());
        }
    }

    fn resolved_langfuse_public_key(&self) -> Option<String> {
        trimmed_secret(self.langfuse_public_key.as_ref())
            .or_else(|| trimmed_process_env(LANGFUSE_PUBLIC_KEY_ENV))
    }

    fn resolved_langfuse_secret_key(&self) -> Option<String> {
        trimmed_secret(self.langfuse_secret_key.as_ref())
            .or_else(|| trimmed_process_env(LANGFUSE_SECRET_KEY_ENV))
    }

    fn resolved_langfuse_base_url_value(&self) -> Option<String> {
        trimmed_string(self.langfuse_base_url.as_deref())
            .or_else(|| trimmed_process_env(LANGFUSE_BASE_URL_ENV))
    }

    fn resolved_langfuse_host_value(&self) -> Option<String> {
        trimmed_string(self.langfuse_host.as_deref())
            .or_else(|| trimmed_process_env(LANGFUSE_HOST_ENV))
    }

    /// `LANGFUSE_BASE_URL` > `LANGFUSE_HOST` > 默认 cloud。
    fn resolved_langfuse_base_url(&self) -> String {
        self.resolved_langfuse_base_url_value()
            .or_else(|| self.resolved_langfuse_host_value())
            .unwrap_or_else(|| DEFAULT_LANGFUSE_HOST.to_string())
    }
}

fn trimmed_secret(value: Option<&SecretString>) -> Option<String> {
    trimmed_string(value.map(SecretString::as_str))
}

fn trimmed_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn trimmed_process_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .and_then(|value| trimmed_string(Some(&value)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::file::load_file;
    use serial_test::serial;
    use tempfile::tempdir;

    fn clear_langfuse_env() {
        for key in [
            LANGFUSE_PUBLIC_KEY_ENV,
            LANGFUSE_SECRET_KEY_ENV,
            LANGFUSE_HOST_ENV,
            LANGFUSE_BASE_URL_ENV,
        ] {
            std::env::remove_var(key);
        }
    }

    #[test]
    #[serial]
    fn langfuse_resolves_base_url_over_host_and_default() {
        clear_langfuse_env();
        let mut cfg = Config::defaults();
        cfg.langfuse_public_key = Some(SecretString::new("pk"));
        cfg.langfuse_secret_key = Some(SecretString::new("sk"));
        cfg.langfuse_base_url = Some("https://base.example".into());
        cfg.langfuse_host = Some("https://host.example".into());
        let client = cfg.langfuse_client_config().expect("configured");
        assert_eq!(client.api_base.as_str(), "https://base.example/");
        clear_langfuse_env();
    }

    #[test]
    #[serial]
    fn langfuse_spawn_env_includes_host_when_set() {
        clear_langfuse_env();
        let mut cfg = Config::defaults();
        cfg.langfuse_public_key = Some(SecretString::new("pk"));
        cfg.langfuse_secret_key = Some(SecretString::new("sk"));
        cfg.langfuse_host = Some("https://lf.example".into());
        let env = cfg.langfuse_spawn_env();
        assert_eq!(
            env.get(LANGFUSE_HOST_ENV),
            Some(&"https://lf.example".to_string())
        );
        assert!(!env.contains_key(LANGFUSE_BASE_URL_ENV));
        clear_langfuse_env();
    }

    #[test]
    #[serial]
    fn langfuse_file_config_merges_like_realtime_voice() {
        clear_langfuse_env();
        let home = tempdir().unwrap();
        let cfg_dir = home.path().join("config");
        std::fs::create_dir_all(&cfg_dir).unwrap();
        std::fs::write(
            cfg_dir.join("config.toml"),
            r#"
langfuse_public_key = "pk-file"
langfuse_secret_key = "sk-file"
langfuse_base_url = "https://from-file.example"
"#,
        )
        .unwrap();
        let mut cfg = Config::defaults();
        cfg.config_dir = cfg_dir.clone();
        let file = load_file(&cfg_dir.join("config.toml")).unwrap();
        cfg.merge_file(&file);
        assert!(cfg.langfuse_enabled());
        let client = cfg.langfuse_client_config().expect("client");
        assert_eq!(client.api_base.as_str(), "https://from-file.example/");
        clear_langfuse_env();
    }
}

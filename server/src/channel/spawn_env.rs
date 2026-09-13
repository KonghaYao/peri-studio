//! ACP 子进程 spawn 默认环境（MCP Apps 开关、Langfuse trace 写路径等）。
//!
//! instance `env_clear()` 后仅继承基集；Hub 必须显式注入 `PERI_MCP_APPS`
//! （空值即可）否则 Peri 永远 `capability_disabled`；已配置的 `LANGFUSE_*`
//! 亦经此路径注入 ACP child（与 Monitor 读 API 同源 [`Config`]）。

use std::collections::HashMap;

use crate::config::Config;

/// 与 instance `ENV_BASE_ALLOWLIST` / server `ENV_ALLOWLIST_BASE` 对齐。
pub const PERI_MCP_APPS_ENV: &str = "PERI_MCP_APPS";

/// 默认 ACP spawn 附加环境：存在 `PERI_MCP_APPS`（空串启用 Apps relay），
/// 以及 server 已配置的非空 `LANGFUSE_*`。
pub fn acp_spawn_env(cfg: &Config) -> Option<HashMap<String, String>> {
    let mut env = HashMap::new();
    env.insert(PERI_MCP_APPS_ENV.to_string(), String::new());
    env.extend(cfg.langfuse_spawn_env());
    Some(env)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::SecretString;
    use crate::langfuse::{LANGFUSE_HOST_ENV, LANGFUSE_PUBLIC_KEY_ENV, LANGFUSE_SECRET_KEY_ENV};
    use serial_test::serial;

    #[test]
    fn acp_spawn_env_includes_peri_mcp_apps() {
        let env = acp_spawn_env(&Config::defaults()).expect("spawn env");
        assert_eq!(env.get(PERI_MCP_APPS_ENV), Some(&String::new()));
    }

    #[test]
    #[serial]
    fn acp_spawn_env_injects_langfuse_when_configured() {
        let mut cfg = Config::defaults();
        cfg.langfuse_public_key = Some(SecretString::new("pk"));
        cfg.langfuse_secret_key = Some(SecretString::new("sk"));
        cfg.langfuse_host = Some("https://lf.example".into());
        let env = acp_spawn_env(&cfg).expect("spawn env");
        assert!(env.contains_key(LANGFUSE_PUBLIC_KEY_ENV));
        assert!(env.contains_key(LANGFUSE_SECRET_KEY_ENV));
        assert!(env.contains_key(LANGFUSE_HOST_ENV));
    }

    #[test]
    fn acp_spawn_env_omits_langfuse_when_unconfigured() {
        let env = acp_spawn_env(&Config::defaults()).expect("spawn env");
        assert!(!env.contains_key(LANGFUSE_PUBLIC_KEY_ENV));
        assert!(!env.contains_key(LANGFUSE_SECRET_KEY_ENV));
    }
}

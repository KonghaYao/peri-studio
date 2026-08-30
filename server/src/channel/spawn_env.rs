//! ACP 子进程 spawn 默认环境（MCP Apps 开关等）。
//!
//! instance `env_clear()` 后仅继承基集；Hub 必须显式注入 `PERI_MCP_APPS`
//! （空值即可）否则 Peri 永远 `capability_disabled`。

use std::collections::HashMap;

/// 与 instance `ENV_BASE_ALLOWLIST` / server `ENV_ALLOWLIST_BASE` 对齐。
pub const PERI_MCP_APPS_ENV: &str = "PERI_MCP_APPS";

/// 默认 ACP spawn 附加环境：存在 `PERI_MCP_APPS`（空串启用 Apps relay）。
pub fn default_acp_spawn_env() -> Option<HashMap<String, String>> {
    let mut env = HashMap::new();
    env.insert(PERI_MCP_APPS_ENV.to_string(), String::new());
    Some(env)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_spawn_env_includes_peri_mcp_apps() {
        let env = default_acp_spawn_env().expect("spawn env");
        assert_eq!(env.get(PERI_MCP_APPS_ENV), Some(&String::new()));
    }
}

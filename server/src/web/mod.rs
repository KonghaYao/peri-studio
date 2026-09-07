//! Web 前端与浏览器认证入口。
//!
//! 定位：gateway 在回环检查（§9.5）之后、配额注册（§8.6）之前分流
//! （`channel/gateway.rs` 连接任务步骤 2）：头部含 `upgrade: websocket`
//! 的请求原样走 WebSocket 握手（ws 时序不变，§4.6），其余普通 HTTP 一律
//! 交给本模块——不进连接配额/注册表，不产生占位连接。HTTP 面只包含两类
//! 路由：内嵌 Vite 静态资源（`static_`），以及同源 `/api/auth/session` 与
//! `/api/auth/session/bootstrap` 的 bounded cookie 认证面（`auth_http`）。
//!
//! 前端是独立 Vite 工程（`web/`，SolidJS），Web 面板为唯一
//! 页面（`/` 即面板入口）；构建产物 `web/dist/` 由 `build.rs` 在编译期
//! 扫描并生成内嵌资源表（`assets.rs`，字节经 include_bytes! 引用，零
//! 运行时文件 IO、零新依赖）。产物文件名带内容 hash，`static_` 按实际
//! 文件清单做路径查表：`/`、`/index.html` 映射面板入口，`/panel.html` 为
//! 旧链接兼容（同样指向面板），`/assets/*` 直接映射产物相对路径，未知
//! 路径与非 GET 方法一律 404。
//!
//! 设计约束：静态资源名不做 URL 解码，取请求行 path 段（去 query）查内嵌
//! 清单。认证端点使用独立的有限 HTTP/1.1 解析（`parse`）：限制头/body/
//! 读取总时长，拒绝 chunked/重复 framing，校验 loopback Host 与同源
//! Origin，并固定 `no-store` 安全头。浏览器 bearer 只出现在登录请求 body；
//! 成功后仅使用 HttpOnly opaque cookie，WebSocket 不持有或重放 bearer。
//!
//! 模块划分：`http`（serve_http 入口 + 响应写出层）、`auth_http`
//! （/api/auth/session 端点）、`static_`（内嵌静态资源路由/缓存策略）、
//! `parse`（有限 HTTP/1.1 解析纯函数）。

mod auth_http;
mod http;
mod local_dialog;
mod parse;
mod pick_directory_http;
mod resource_upload_http;
pub(crate) mod sandbox;
#[path = "static.rs"]
mod static_;

use crate::auth::TOKENS_FILE;
use crate::config::Config;

use peri_studio_proto::schema::GlobalStatus;
use peri_studio_proto::version::PROTOCOL_VERSION;

#[cfg(test)]
pub(crate) use http::serve;
#[cfg(test)]
pub(crate) use http::serve_http;
pub(crate) use http::serve_http_with_resources;
pub(crate) use parse::{cookie_value, header_end, is_ws_upgrade, valid_ws_host, valid_ws_origin};
#[cfg(test)]
pub(crate) use parse::{is_json_content_type, request_path, valid_loopback_host};
#[cfg(test)]
pub(crate) use static_::{cache_headers_for_static, content_type, route, ASSETS};

/// Credential-free machine row for `/api/health` and `status --json`.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthMachineSummary {
    pub instance_id: String,
    pub display_name: String,
    pub phase: String,
    pub kind: String,
}

/// Credential-free local process health. This intentionally excludes paths,
/// identities, counts and degradation reasons.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSnapshot {
    pub status: HealthStatus,
    pub ready: bool,
    pub protocol_version: u32,
    pub server_version: String,
    #[serde(default)]
    pub machines: Vec<HealthMachineSummary>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Restarting,
}

impl HealthStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            HealthStatus::Healthy => "healthy",
            HealthStatus::Degraded => "degraded",
            HealthStatus::Restarting => "restarting",
        }
    }
}

impl HealthSnapshot {
    pub fn from_global_status(status: GlobalStatus) -> Self {
        Self::from_runtime(status, [])
    }

    pub fn from_runtime(
        status: GlobalStatus,
        machines: impl IntoIterator<Item = HealthMachineSummary>,
    ) -> Self {
        let status = match status {
            GlobalStatus::Healthy => HealthStatus::Healthy,
            GlobalStatus::Degraded => HealthStatus::Degraded,
            GlobalStatus::Restarting => HealthStatus::Restarting,
        };
        Self {
            ready: status == HealthStatus::Healthy,
            status,
            protocol_version: PROTOCOL_VERSION,
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            machines: machines.into_iter().collect(),
        }
    }
}

/// Credential-free setup metadata for the loopback login surface.
///
/// This descriptor is derived from the authoritative runtime Config before any
/// auth lock is acquired. It never contains token records, ids or file data.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserAuthSetup {
    token_file: String,
    generate_command: String,
}

impl BrowserAuthSetup {
    pub(crate) fn from_config(cfg: &Config) -> Self {
        let executable = std::env::current_exe()
            .ok()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_else(|| "peri-studio".to_string());
        Self::from_parts(cfg, &executable)
    }

    fn from_parts(cfg: &Config, executable: &str) -> Self {
        let config_dir = cfg.config_dir.to_string_lossy();
        Self {
            token_file: cfg
                .config_dir
                .join(TOKENS_FILE)
                .to_string_lossy()
                .into_owned(),
            generate_command: format!(
                "PERI_STUDIO_CONFIG_DIR={} {} token generate --name web --role full",
                shell_single_quote(&config_dir),
                shell_single_quote(executable),
            ),
        }
    }
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
#[path = "auth_principal_test.rs"]
mod auth_principal_test;

#[cfg(test)]
#[path = "http_test.rs"]
mod http_test;
#[cfg(test)]
#[path = "resource_upload_http_test.rs"]
mod resource_upload_http_test;
#[cfg(test)]
#[path = "static_test.rs"]
mod static_test;
#[cfg(test)]
#[path = "test_util.rs"]
mod test_util;

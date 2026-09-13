//! Langfuse Monitor 配置与 spawn 注入（读路径与 Hub spawn 同源 server 进程 env）。

mod config;
mod session_id;
mod upstream;

pub use config::{
    inject_spawn_env, is_configured, langfuse_env_keys, LangfuseConfig, DEFAULT_LANGFUSE_HOST,
    LANGFUSE_BASE_URL_ENV, LANGFUSE_HOST_ENV, LANGFUSE_PUBLIC_KEY_ENV, LANGFUSE_SECRET_KEY_ENV,
};
pub use session_id::{SessionIdError, validate_session_id};
pub use upstream::{fetch_session_traces, MonitorSessionView, UpstreamError};

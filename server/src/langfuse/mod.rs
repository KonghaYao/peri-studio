//! Langfuse Monitor 配置与 spawn 注入（读路径与 Hub spawn 同源 server 进程 env）。

mod config;
mod session_id;
mod trace_detail;
mod trace_id;
mod upstream;

pub use config::{
    build_langfuse_config, langfuse_env_keys, LangfuseConfig, DEFAULT_LANGFUSE_HOST,
    LANGFUSE_BASE_URL_ENV, LANGFUSE_HOST_ENV, LANGFUSE_PUBLIC_KEY_ENV, LANGFUSE_SECRET_KEY_ENV,
};
pub use session_id::{validate_session_id, SessionIdError};
pub use trace_detail::{fetch_trace_detail, MonitorObservationView, MonitorTraceDetailView};
pub use trace_id::{validate_trace_id, TraceIdError};
pub use upstream::{
    fetch_session_traces, MonitorSessionView, UpstreamError, UPSTREAM_CONNECT_TIMEOUT,
    UPSTREAM_TIMEOUT, UPSTREAM_TOTAL_TIMEOUT,
};

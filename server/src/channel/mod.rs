//! 通道层（Feature F5）：gateway（ws 生命周期）、chat-channel（客户端连接
//! 归一化）、command-coordinator（有界队列 + commandId 去重持久化）、
//! relay-event-handler（instance 入站消费与断链清理）、broadcaster（fan-out +
//! 背压）、connection-registry（配额）（架构 §12 目录结构）。
//!
//! 依赖方向（单向，防环）：`protocol`（纯函数）← `channel`（依赖 protocol +
//! state + persist + auth）← `control`（装配）。模块间句柄经 `Arc<dyn Trait>`
//! /struct 引用注入。
//!
//! 权威：`docs/architecture.md` §4.2–§4.8、§6、§7.4、§8、§9。

mod broadcaster;
mod chat_channel;
mod command_coordinator;
#[cfg(test)]
#[path = "command_coordinator_test.rs"]
mod command_coordinator_test;
mod command_identity;
mod command_outcome_broker;
mod connection_registry;
mod coordinator_assembly;
mod coordinator_helpers;
mod elicitation_response;
mod gateway;
mod gateway_client_loop;
mod gateway_instance_loop;
mod instance_recovery;
mod machine_actions;
mod machine_command_processor;
mod machine_validation;
mod management_actions;
mod mcp_apps_control;
mod mcp_control;
mod metadata_activation;
mod metadata_command_processor;
mod metadata_project_actions;
mod metadata_session_actions;
mod metadata_validation;
mod mutation_admission;
#[cfg(test)]
#[path = "mutation_admission_test.rs"]
mod mutation_admission_test;
mod oauth_command_ledger;
mod oauth_control;
mod permission_resolution;
mod prompt_delivery;
mod prompt_recovery;
mod question_response;
mod queued_actions;
mod queued_submission;
mod relay_buffer_sync;
#[path = "relay_callback.rs"]
mod relay_callback;
mod relay_disconnect;
mod relay_event_handler;
mod relay_events;
mod relay_permission;
#[path = "relay_question.rs"]
mod relay_question;
mod relay_rpc;
mod runtime_closure;
mod runtime_command_ledger;
#[cfg(test)]
#[path = "runtime_command_ledger_test.rs"]
mod runtime_command_ledger_test;
mod runtime_creation;
mod runtime_creation_bind;
mod runtime_creation_cleanup;
mod runtime_creation_exec;
mod session_actions;
mod session_catalog_sync;
mod session_configuration;
#[cfg(test)]
#[path = "session_configuration_test.rs"]
mod session_configuration_test;
mod session_discovery;
mod session_resume;
mod session_rewind;
mod session_runtime_execution;
mod session_runtime_operations;
mod spawn_env;
mod terminal_io;
mod turn_cancellation;
mod voice_proxy;
mod workspace_compatibility;

/// Default locally attached ACP instance.
pub const DEFAULT_INSTANCE_ID: &str = "local";

pub use broadcaster::{
    decide_backpressure, BackpressureAction, Broadcaster, OutboundMsg, SubError,
};
pub use chat_channel::{ChannelDeps, ChatChannel, DispatchOutcome};
pub use command_coordinator::DEFAULT_ACP_CMD;
pub use command_coordinator::{CommandCoordinator, ExecCmd, SubmitAck};
pub use connection_registry::{ConnHandle, ConnId, ConnectionRegistry, RegistryFull};
pub use gateway::{Gateway, GatewayError};
pub use relay_event_handler::{ConsumeResult, PendingRpc, RelayError, RelayEventHandler};

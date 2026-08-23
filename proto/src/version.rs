//! 版本常量（§4.1 / §5.3 / §13.1）。
//!
//! 真相来源以本 crate 实现为准：`CHAT_DOC_SCHEMA_VERSION` 由架构 §5.3 明示，
//! 其余数值为设计决策（原 f1-proto 设计稿 §11，该历史计划文档已删除；
//! 决策依据以 `docs/architecture.md` 为准）。

/// 线协议版本（§13.1：`instance/hello` 携带，版本不匹配拒绝连接）。
///
/// 【决策】数值取 1；版本不匹配时的拒绝语义在 server auth 模块。
pub const PROTOCOL_VERSION: u32 = 2;

/// Chat Doc 结构版本（§5.3 明示，真相来源以本 crate 实现为准）。
pub const CHAT_DOC_SCHEMA_VERSION: u32 = 1;

/// Control Doc 结构版本（§5.4 未给数值，【决策】取 1）。
pub const SESSION_DOC_SCHEMA_VERSION: u32 = 1;

/// Registry Doc 结构版本（§5.5 未给数值，【决策】取 2）。
///
/// v1 → v2 的升级原因：Registry Doc 增加 `projects` / `project_sessions` /
/// `workspaces` 结构（server `state/registry.rs` 写入路径）；本常量是
/// server 侧 registry doc 的 `schema_version` 写入值（功能面），旧快照恢复
/// 时以此判空补结构。
pub const REGISTRY_DOC_SCHEMA_VERSION: u32 = 2;

/// Remote FS/Git resource projection Doc schema version.
pub const RESOURCE_DOC_SCHEMA_VERSION: u32 = 1;

/// y-sync update 编码版本（§4.1「固定 update 编码版本 v1」）。
pub const Y_UPDATE_ENCODING_VERSION: u32 = 1;

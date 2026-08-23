//! Peri Studio instance 角色运行时库（docs/architecture.md §3.2/§12）。
//!
//! 职责：每台机器一个 daemon，outbound 连 server，收 spawn/kill 指令，
//! 管理 ACP 进程树，透明转发 + 断线缓冲。
//!
//! OS signal 与 `connect` CLI 由唯一产品入口 `app/` 拥有。

pub mod auth;
pub mod buffer;
pub mod child;
pub mod error;
pub mod global;
pub mod hub;
pub mod resource;
pub mod router;
pub mod transport;

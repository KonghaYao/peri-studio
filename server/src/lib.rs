//! Peri Studio server 角色运行时库。
//!
//! 进程级 CLI、信号与本地 instance 监督由 `app/` 拥有；本 crate 只暴露
//! 可由唯一 `peri-studio` 二进制装配的中心控制面能力。
//!
//! 模块预声明（占位）：后续并行 feature agent 只写各自文件，不碰 lib.rs。
//! 职责映射见 docs/architecture.md §12 目录结构。

pub mod auth;
pub mod channel;
pub mod config;
pub mod control;
pub mod persist;
pub mod protocol;
pub mod runtime;
pub mod state;
pub mod web;

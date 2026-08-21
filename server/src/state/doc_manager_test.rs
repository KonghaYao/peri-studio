//! DocManager 测试（壳模块）：原 1847 行超限（≤500 行要求），按被测
//! 模块主题一拆为六——事件应用（`apply_event`）、微批次（`batch`）、
//! 命令路由（`command`）、persist 提交与广播（`persist`）、注册表
//! 命令与 gap 恢复（`registry`）；共享构造器在 `util`
//! （`doc_manager_test_util.rs`）。
//!
//! 拆分方式：各子文件经 `#[path]` 声明（`state/mod.rs` 的
//! `mod doc_manager_test` 声明不变），测试代码仅移动 + 文件级 use
//! 调整，断言语义零改动（ClockBlocker 抑制技巧、幂等/拒绝契约不变）。

#[path = "doc_manager_apply_event_test.rs"]
mod apply_event;
#[path = "doc_manager_batch_test.rs"]
mod batch;
#[path = "doc_manager_command_test.rs"]
mod command;
#[path = "doc_manager_persist_test.rs"]
mod persist;
#[path = "doc_manager_registry_test.rs"]
mod registry;
#[path = "doc_manager_test_util.rs"]
mod util;

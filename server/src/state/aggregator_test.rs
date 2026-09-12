//! 聚合器测试（壳模块）：原 2589 行超限（≤500 行要求），按被测模块
//! 主题一拆为九——判定族（`judge`/`stream`）、写入族（`write`）、
//! 投影（`projection`）、权限状态机（`permission`）、tool 卡片
//! （`tool`）、控制扩展（`agent`/`activity`）；共享构造器在 `util`
//! （`aggregator_test_util.rs`）。
//!
//! 拆分方式：各子文件经 `#[path]` 声明（`state/mod.rs` 的
//! `mod aggregator_test` 声明不变），测试代码仅移动 + 文件级 use
//! 调整，断言语义零改动。

#[path = "aggregator_activity_test.rs"]
mod activity;
#[path = "aggregator_agent_test.rs"]
mod agent;
#[path = "aggregator_callback_test.rs"]
mod callback;
#[path = "aggregator_judge_test.rs"]
mod judge;
#[path = "aggregator_permission_test.rs"]
mod permission;
#[path = "aggregator_plan_chat_test.rs"]
mod plan_chat;
#[path = "aggregator_projection_test.rs"]
mod projection;
#[path = "aggregator_question_test.rs"]
mod question;
#[path = "aggregator_stream_test.rs"]
mod stream;
#[path = "aggregator_task_test.rs"]
mod task;
#[path = "aggregator_tool_test.rs"]
mod tool;
#[path = "aggregator_tool_lifecycle_test.rs"]
mod tool_lifecycle;
#[path = "aggregator_tool_patch_test.rs"]
mod tool_patch;
#[path = "aggregator_test_util.rs"]
mod util;
#[path = "aggregator_write_test.rs"]
mod write;

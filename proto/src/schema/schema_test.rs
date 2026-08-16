//! Y.Doc schema 类型结构完整性测试（§12.1 可选）：serde round-trip + 枚举形态。
//!
//! 按 Doc 主题拆分（review 问题 13）：chat / control / registry 各一个测试
//! 文件，跨 Doc 的形状与 round-trip 测试在 `shape`；共享构造器在 `util`。

#[path = "schema_chat_test.rs"]
mod chat;
#[path = "schema_control_test.rs"]
mod control;
#[path = "schema_registry_test.rs"]
mod registry;
#[path = "schema_shape_test.rs"]
mod shape;
#[path = "schema_test_util.rs"]
mod util;

//! 帧模型单元测试（§4.8 向量 6 的 parse 层面 + round-trip + 判别 + 兼容性）。
//!
//! 按主题拆分（review 问题 3）：round-trip/注册表一致性、解析错误分类、
//! legacy 兼容、序列化形态；共享帧构造器在 `util`（[`all_frames`]）。

#[path = "frame_compat_test.rs"]
mod compat;
#[path = "frame_parse_test.rs"]
mod parse;
#[path = "frame_roundtrip_test.rs"]
mod roundtrip;
#[path = "frame_shape_test.rs"]
mod shape;
#[path = "frame_test_util.rs"]
mod util;

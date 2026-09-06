//! instance 侧 PTY 宿主：受控 shell、有界输出、不经 ACP 缓冲。

#[path = "terminal_host.rs"]
mod terminal_host;

pub use terminal_host::{TerminalEvent, TerminalHost};

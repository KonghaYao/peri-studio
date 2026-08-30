use super::pick_directory;

#[test]
fn pick_directory_is_callable_on_host() {
    // 单元测试不弹窗：只验证符号存在且可在宿主平台链接。
    // 交互路径由 HTTP 契约测试覆盖未认证/非 loopback 分支。
    let _ = pick_directory as fn(&str) -> Option<std::path::PathBuf>;
}

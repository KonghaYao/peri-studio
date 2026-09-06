use super::*;

#[test]
fn controlled_shell_is_absolute_on_unix() {
    let shell = controlled_shell();
    #[cfg(not(windows))]
    assert!(shell.starts_with('/'));
}

#[test]
fn open_validation_rejects_bad_dims() {
    let open = InstanceTerminalOpen {
        request_id: "r".into(),
        terminal_id: "t".into(),
        cwd: "/tmp".into(),
        cols: 1,
        rows: 24,
    };
    assert!(validate_open(&open).is_err());
}

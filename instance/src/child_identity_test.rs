//! 进程指纹解析器单测（`linux_process_fingerprint` 与平台无关，全平台可测）。

#[test]
fn test_linux_stat_parser_handles_spaces_and_right_parenthesis_in_comm() {
    let mut fields = vec!["0"; 21];
    fields[0] = "S"; // field 3: state
    fields[1] = "1"; // field 4: ppid
    fields[2] = "42"; // field 5: pgrp
    fields[19] = "777"; // field 22: starttime
    let stat = format!("42 (worker ) name) {}", fields.join(" "));
    let fingerprint =
        crate::child::fingerprint::linux_process_fingerprint(&stat, 42, "boot-id\n").unwrap();
    assert_eq!(fingerprint.birth, "boot-id:777");
}

#[test]
fn test_linux_stat_parser_rejects_non_leader_and_missing_boot_identity() {
    let mut fields = vec!["0"; 21];
    fields[0] = "S";
    fields[1] = "1";
    fields[2] = "41";
    fields[19] = "777";
    let stat = format!("42 (worker) {}", fields.join(" "));
    assert_eq!(
        crate::child::fingerprint::linux_process_fingerprint(&stat, 42, "boot-id"),
        None
    );
    fields[2] = "42";
    let leader = format!("42 (worker) {}", fields.join(" "));
    assert_eq!(
        crate::child::fingerprint::linux_process_fingerprint(&leader, 42, "  "),
        None
    );
}
